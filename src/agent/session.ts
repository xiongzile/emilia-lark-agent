import type {Agent, AgentMessage} from "@earendil-works/pi-agent-core";
import {uncertainTurn, type TreeRouter} from "./tree-router.ts";
import {isTreeCommand, treeCommand, recoveryCandidates} from "./tree-tools.ts";
import type {MemoryDistiller} from "../memory/distill.ts";
import type {MemoryStore} from "../memory/store.ts";
import {isMemoryCommand, memoryCommand} from "../memory/commands.ts";
import {promptAgent} from "./turn.ts";
import type {CompactContext} from "./context.ts";

export class AgentSession {
    private system?: Extract<AgentMessage, {role: "system"}>;
    private agent: Agent;
    private store: MemoryStore;
    private distiller: MemoryDistiller;
    private router: TreeRouter;
    private compact?: CompactContext;
    constructor(agent: Agent, store: MemoryStore, distiller: MemoryDistiller,
        router: TreeRouter = async () => uncertainTurn(), compact?: CompactContext) {
        this.agent = agent;
        this.store = store;
        this.distiller = distiller;
        this.router = router;
        this.compact = compact;
    }

    async run(messageId: string, text: string, write?: (content: string) => Promise<void>): Promise<string> {
        const {agent, store} = this;
        const tree = store.tree;
        await store.recordUser(messageId, text);
        let unsubscribe: (() => void) | undefined;
        const previousPayload = agent?.onPayload;
        let checkpoint: AgentMessage[] | undefined;
        try {
            let reply: string;
            if (isTreeCommand(text)) reply = await treeCommand(text, store);
            else if (isMemoryCommand(text)) reply = await memoryCommand(text, store, this.distiller);
            else {
                await tree.importUnassigned();
                const previousTopic = tree.active;
                const route = await this.router(text, {active: tree.active, topics: tree.list()}, store.recentTurns(10))
                    .catch(() => uncertainTurn());
                if (route.branch === "search") {
                    const candidates = tree.search(text).filter(topic => topic.id !== tree.active && topic.matches.length);
                    // A single historical topic can be inspected directly. Multiple candidates
                    // remain a choice; finding a topic never authorizes its old operations.
                    if (candidates.length === 1) route.branch = candidates[0].id;
                }
                const fresh = route.branch === "new" || route.mode === "greet" || !tree.active;
                if (fresh) {
                    await tree.select(await tree.create(text));
                } else if (route.branch && tree.topics.has(route.branch)) await tree.select(route.branch);
                await tree.attach(messageId, tree.active!);
                if (route.branch === "search") reply = recoveryCandidates(tree, text);
                else {
                    if (!this.system) {
                        const system = agent.state.messages[0];
                        if (system?.role !== "system") throw new Error("Agent system message missing");
                        this.system = structuredClone(system);
                    }
                    // A topic selection is fallible. Keep the immediately preceding turn
                    // across automatic switches so the model can check a pronoun's referent.
                    // Explicit new topics/greetings remain clean; outages retain ten turns.
                    const nearby = route.source === "fallback" ? 10 : !fresh && previousTopic !== tree.active ? 1 : 0;
                    let extra = nearby ? tree.recent(nearby).map(turn => turn.messageId)
                        .filter(id => !tree.turnIds().includes(id)) : [];
                    let revision = tree.revision;
                    let sources = [...new Set([...tree.turnIds(), ...extra])];
                    const history = tree.messages(agent.state.model, tree.active, extra, messageId);
                    agent.state.messages = [this.system, ...history];
                    console.log("[Tree route]", {...route, active: tree.active, sources});
                    agent.onPayload = async (payload, model) => {
                        const changed = await previousPayload?.(payload, model);
                        await tree.saveRequest(messageId, changed ?? payload, sources);
                        return changed;
                    };
                    unsubscribe = agent.subscribe(event => {
                        if (event.type === "message_end") void store.history.appendMessage(event.message).catch(() => undefined);
                    });
                    let compacted = false;
                    const compact = async (messages: AgentMessage[], signal?: AbortSignal) => {
                        const next = this.compact ? await this.compact(messages, signal) : messages;
                        if (next !== messages) compacted = true;
                        return next;
                    };
                    agent.prepareNextTurnWithContext = async ({context}, signal) => {
                        await store.history.flush();
                        let messages = context.messages;
                        if (revision !== tree.revision) {
                            // Apply context repairs in this turn, retaining its live tool pair.
                            let start = messages.length - 1;
                            while (start > 0 && messages[start].role !== "user") start--;
                            extra = [];
                            messages = [this.system!, ...tree.messages(agent.state.model, tree.active, [], messageId), ...messages.slice(start)];
                            revision = tree.revision;
                            sources = tree.turnIds();
                        }
                        const next = await compact(messages, signal);
                        if (next === context.messages) return;
                        agent.state.messages = next;
                        return {context: {...context, messages: next}};
                    };
                    const memory = store.context(route.mode === "task" ? "stable" : "personal");
                    const previousMemory = [...history].reverse().flatMap(message => message.role === "user" && Array.isArray(message.content)
                        ? message.content.flatMap(part => part.type === "text" && part.text.startsWith("<memory_context>") ? [part.text] : []) : [])[0];
                    reply = await promptAgent(agent, text, write, {includeRuntime: route.mode !== "greet",
                        context: memory !== previousMemory ? memory : undefined,
                        treeContext: `<context_tree>${JSON.stringify({active: tree.active, turn: messageId, tool: "context_tree"})}</context_tree>`, compact});
                    await store.history.flush();
                    if (compacted && !extra.length) checkpoint = agent.state.messages.slice(1);
                }
            }
            await store.recordAssistant(messageId, reply);
            if (checkpoint) await tree.checkpoint(checkpoint);
            if (!/^\/(tree|memory)(?:\s|$)/.test(text.trim())) {
                this.distiller.schedule(store.status().pending >= 5 || /记住|以后都|remember/i.test(text));
            }
            return reply;
        } catch (error) {
            await store.recordAssistant(messageId, undefined).catch(console.error);
            throw error;
        } finally {unsubscribe?.(); if (agent) agent.onPayload = previousPayload;}
    }
}
