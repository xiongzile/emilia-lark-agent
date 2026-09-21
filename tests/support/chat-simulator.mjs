import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Type} from "@earendil-works/pi-ai";

export function mockCommand({name, description, rules}) {
    return {
        name,
        label: name,
        description,
        parameters: Type.Object({args: Type.Array(Type.String())}),
        async execute(_id, {args}) {
            const rule = rules.find(({startsWith}) => startsWith.every((part, index) => args[index] === part));
            if (!rule) {
                const commands = rules.map(({startsWith}) => startsWith.join(" ")).join(", ");
                throw new Error(`Unknown ${name} command: ${JSON.stringify(args)}. Supported commands: ${commands}`);
            }
            if (rule.error) throw new Error(rule.error);
            return {content: [{type: "text", text: JSON.stringify(rule.result)}]};
        },
    };
}

function matchesCall(call, expected) {
    if (call.tool !== expected.tool) return false;
    const actual = call.args;
    if (expected.workspace && (actual.workspace ?? "agent") !== expected.workspace) return false;
    for (const field of ["operation", "path"]) {
        if (expected[field] !== undefined && actual[field] !== expected[field]) return false;
    }
    if (expected.args && JSON.stringify(actual.args) !== JSON.stringify(expected.args)) return false;
    if (expected.startsWith && !expected.startsWith.every((part, index) => actual.args?.[index] === part)) return false;
    return true;
}

async function checkExpect(expect, {reply, calls, store, workspaces, selection}) {
    if (!expect) return;
    if (expect.reply) assert.match(reply, expect.reply);
    if (expect.notReply) assert.doesNotMatch(reply, expect.notReply);
    if (expect.context) {
        assert.equal(selection?.source, expect.context.source ?? "jev");
        if (expect.context.mode) assert.equal(selection.mode, expect.context.mode);
        for (const id of expect.context.includes ?? []) assert.ok(selection.messageIds.includes(id), `Context missing ${id}`);
        for (const id of expect.context.excludes ?? []) assert.ok(!selection.messageIds.includes(id), `Unrelated context ${id}`);
    }

    for (const expected of expect.calls ?? []) {
        const count = calls.filter((call) => matchesCall(call, expected)).length;
        if (expected.count === undefined) {
            assert.ok(count > 0, `Missing ${expected.tool} call ${JSON.stringify(expected)}; got ${JSON.stringify(calls)}`);
        } else {
            assert.equal(count, expected.count, `Expected ${expected.tool} call ${JSON.stringify(expected)}; got ${JSON.stringify(calls)}`);
        }
    }
    for (const expected of expect.noCalls ?? []) {
        assert.ok(!calls.some((call) => matchesCall(call, expected)), `Unexpected ${expected.tool} call: ${JSON.stringify(calls)}`);
    }
    for (const expected of expect.memory ?? []) {
        const entries = store.list(expected.category).filter((entry) =>
            (expected.status === undefined || entry.status === expected.status) &&
            (expected.text === undefined || expected.text.test(entry.text))
        );
        if (expected.absent) {
            assert.equal(entries.length, 0, `Unexpected memory: ${JSON.stringify(entries)}`);
        } else {
            assert.ok(entries.length > 0, `Missing memory ${JSON.stringify(expected)}; got ${JSON.stringify(store.list())}`);
            if (expected.sources) assert.deepEqual(entries[0].sourceMessageIds, expected.sources);
        }
    }
    for (const expected of expect.files ?? []) {
        const content = await readFile(join(workspaces[expected.workspace ?? "agent"], expected.path), "utf8");
        if (expected.contains) assert.match(content, expected.contains);
        if (expected.notContains) assert.doesNotMatch(content, expected.notContains);
    }
}

export function createChatSimulator({fixture, workspaces, MemoryStore, createDeepSeekAgent, AgentSession, createContextSelector, toolRegistry}) {
    return async function play({history = [], tools = ["memory", "git"], events, contextUnavailable = false}) {
        const directory = await mkdtemp(join(fixture, "memory-"));
        if (history.length) {
            await writeFile(join(directory, "transcript.json"), JSON.stringify({
                version: 1,
                turns: history.map((turn, index) => ({
                    messageId: turn.id ?? `history-${index + 1}`,
                    at: turn.at ?? new Date().toISOString(),
                    user: turn.user,
                    assistant: turn.assistant,
                })),
            }));
        }

        let store = await MemoryStore.open(directory);
        let session;
        let distiller;
        let selection;
        const timeline = history.flatMap(({user, assistant, at}) => [
            {type: "user", text: user, at},
            {type: "assistant", text: assistant},
        ]);
        const calls = [];

        function start() {
            const resolvedTools = tools.map((tool) =>
                typeof tool === "string" ? toolRegistry[tool](store) : tool
            );
            const runtime = createDeepSeekAgent(store, resolvedTools);
            distiller = runtime.distiller;
            const selectContext = createContextSelector(contextUnavailable ? {
                apiKey: "fixture-key", enabled: true,
                request: async () => { throw new Error("simulated selector outage"); },
            } : undefined);
            session = new AgentSession(runtime.agent, store, distiller, async (...args) => {
                selection = await selectContext(...args);
                timeline.push({type: "context", ...selection});
                return selection;
            });
            runtime.agent.subscribe((event) => {
                if (event.type === "tool_execution_start") {
                    calls.push({tool: event.toolName, args: event.args});
                    timeline.push({type: "tool_call", tool: event.toolName, args: event.args});
                }
                if (event.type === "tool_execution_end") {
                    timeline.push({type: "tool_result", tool: event.toolName, error: event.isError,
                        content: event.result?.content});
                }
            });
        }
        start();

        try {
            for (const [index, event] of events.entries()) {
                const before = calls.length;
                let reply = "";
                if (event.user !== undefined) {
                    timeline.push({type: "user", text: event.user});
                    reply = await session.run(event.id ?? `turn-${index + 1}`, event.user);
                    timeline.push({type: "assistant", text: reply});
                } else if (event.distill) {
                    const changes = await distiller.update();
                    timeline.push({type: "distill", changes});
                } else if (event.restart) {
                    await distiller.stop();
                    store = await MemoryStore.open(directory);
                    start();
                    timeline.push({type: "restart"});
                } else if (event.ageRecentTurns) {
                    for (let turn = 0; turn < event.ageRecentTurns; turn += 1) {
                        const id = `filler-${index}-${turn}`;
                        await store.recordUser(id, `无关的日常闲聊 ${turn}`);
                        await store.recordAssistant(id, "收到。");
                    }
                    await store.apply([], store.status().turns);
                    timeline.push({type: "age_recent_turns", count: event.ageRecentTurns});
                } else {
                    throw new Error(`Unknown conversation event: ${JSON.stringify(event)}`);
                }
                await checkExpect(event.expect, {reply, calls: calls.slice(before), store, workspaces, selection});
            }
        } catch (error) {
            error.timeline = timeline;
            throw error;
        } finally {
            await distiller.stop();
        }
        return timeline;
    };
}
