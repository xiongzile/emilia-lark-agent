import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Type} from "@earendil-works/pi-ai";
import {createReplyJudge, scoreTurn} from "./conversation-score.mjs";

export function mockCommand({name, description, rules}) {
    return {
        name,
        label: name,
        description,
        parameters: Type.Object({args: Type.Array(Type.String())}),
        async execute(_id, {args}) {
            const rule = rules.find(({args: exact, startsWith}) => exact
                ? JSON.stringify(args) === JSON.stringify(exact)
                : startsWith.every((part, index) => args[index] === part));
            if (!rule) {
                const commands = rules.map(rule => (rule.args ?? rule.startsWith).join(" ")).join(", ");
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
    if (expected.query && !expected.query.test(actual.query ?? "")) return false;
    if (expected.workspace && (actual.workspace ?? "agent") !== expected.workspace) return false;
    for (const field of ["operation", "path"]) {
        if (expected[field] !== undefined && actual[field] !== expected[field]) return false;
    }
    if (expected.args && JSON.stringify(actual.args) !== JSON.stringify(expected.args)) return false;
    if (expected.startsWith && !expected.startsWith.every((part, index) => actual.args?.[index] === part)) return false;
    return true;
}

async function checkExpect(expect, {reply, calls, store, workspaces, compactions}) {
    if (!expect) return;
    if (expect.compacted !== undefined) assert.equal(compactions > 0, expect.compacted, "context compaction expectation");
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
    if (expect.reply) assert.match(reply, expect.reply);
    if (expect.notReply) assert.doesNotMatch(reply, expect.notReply);
}

export function createChatSimulator({fixture, workspaces, MemoryStore, createDeepSeekAgent, AgentSession, toolRegistry}) {
    return async function play({history = [], tools = ["memory", "git"], events, routerUnavailable = false, contextBudget}) {
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
        let routingUnavailable = routerUnavailable;
        let forcedRoute;
        const timeline = history.flatMap(({user, assistant, at}) => [
            {type: "user", text: user, at},
            {type: "assistant", text: assistant},
        ]);
        const calls = [];
        const failures = [];
        let compactions = 0;
        const judge = process.env.AGENT_EVAL_SCORE === "1" && events.some(event => event.score)
            ? await createReplyJudge() : undefined;

        function recordCompaction(before, after) {
            if (after === before) return;
            compactions++;
            timeline.push({type: "compaction", before: before.length, after: after.length});
        }

        function start() {
            const resolvedTools = tools.map((tool) =>
                typeof tool === "string" ? toolRegistry[tool](store) : tool
            );
            const runtime = createDeepSeekAgent(store, resolvedTools, contextBudget);
            // The provider hook sees the serialized request, after context selection
            // and conversion. Observe only: never change what the model receives.
            runtime.agent.onPayload = payload => {
                timeline.push({type: "model_request", payload: structuredClone(payload)});
            };
            distiller = runtime.distiller;
            session = new AgentSession(runtime.agent, store, distiller, async (...args) => {
                if (routingUnavailable) throw new Error("simulated router outage");
                const route = forcedRoute ?? await runtime.router(...args);
                timeline.push({type: "route", ...route});
                return route;
            }, async (messages, signal) => {
                const result = await runtime.compact(messages, signal);
                recordCompaction(messages, result);
                return result;
            });
            runtime.agent.subscribe((event) => {
                if (event.type === "message_end" && event.message.role === "assistant") {
                    timeline.push({type: "usage", ...event.message.usage});
                }
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
                const compactionsBefore = compactions;
                let reply = "";
                if (event.user !== undefined) {
                    forcedRoute = event.route;
                    const turnStart = timeline.length;
                    timeline.push({type: "user", text: event.user});
                    let failure;
                    try {reply = await session.run(event.id ?? `turn-${index + 1}`, event.user);}
                    catch (error) {failure = error;}
                    timeline.push({type: "assistant", text: reply});
                    timeline.push({type: "conversation_state", active: store.tree.active, topics: store.tree.list()});
                    if (judge && event.score) timeline.push(await scoreTurn(event.score,
                        {user: event.user, reply, timeline: timeline.slice(turnStart)}, judge));
                    if (failure) throw failure;
                } else if (event.routerUnavailable !== undefined) {
                    routingUnavailable = event.routerUnavailable;
                    timeline.push({type: "router_availability", unavailable: routingUnavailable});
                } else if (event.distill) {
                    const changes = await distiller.update();
                    timeline.push({type: "distill", changes});
                } else if (event.restart) {
                    await distiller.stop();
                    await store.history.close();
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
                try {
                    await checkExpect(event.expect, {reply, calls: calls.slice(before), store, workspaces,
                        compactions: compactions - compactionsBefore});
                } catch (error) {
                    // Finish the scripted conversation so wording failures do not hide
                    // later context recovery or tool behavior. Every failure still fails the test.
                    failures.push(error);
                    timeline.push({type: "expectation_failure", event: index + 1, message: error.message});
                }
            }
            if (failures.length) throw new AggregateError(failures, `${failures.length} conversation expectation(s) failed`);
        } catch (error) {
            error.timeline = timeline;
            throw error;
        } finally {
            await distiller.stop();
            await store.history.close();
        }
        return timeline;
    };
}
