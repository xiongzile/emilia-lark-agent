import type {Agent, AgentMessage} from "@earendil-works/pi-agent-core";
import {advanceConversation, contextTurnIds, startsNewSegment, turnGuidance, uncertainTurn, type TurnRouter} from "./conversation.ts";
import {restoreTurn} from "./history.ts";
import type {MemoryDistiller} from "../memory/distill.ts";
import type {MemoryStore} from "../memory/store.ts";
import {isMemoryCommand, memoryCommand} from "../memory/commands.ts";
import {promptAgent} from "./turn.ts";

export class AgentSession {
    private readonly turnMessages = new Map<string, AgentMessage[]>();
    private readonly router: TurnRouter;
    private readonly agent: Agent;
    private readonly store: MemoryStore;
    private readonly distiller: MemoryDistiller;

    constructor(
        agent: Agent,
        store: MemoryStore,
        distiller: MemoryDistiller,
        router: TurnRouter = async () => uncertainTurn(),
    ) {
        this.agent = agent;
        this.store = store;
        this.distiller = distiller;
        this.router = router;
    }

    async run(messageId: string, text: string, write?: (content: string) => Promise<void>): Promise<string> {
        await this.store.recordUser(messageId, text);
        const command = isMemoryCommand(text);
        try {
            let reply: string;
            let state = this.store.conversation();
            if (command) {
                reply = await memoryCommand(text, this.store, this.distiller);
            } else {
                const recent = this.store.recentTurns(6, {from: state.segmentStart});
                const routingRecent = this.store.recentTurns(10);
                const route = await this.router(text, state, routingRecent).catch(() => uncertainTurn());
                const archived = route.history === "recall" ? routingRecent : [];
                const ids = contextTurnIds(route, state, recent, archived);
                const memoryScope = startsNewSegment(route) ||
                    (state.segmentStart && route.mode === "chat" && route.history !== "recall") ? "personal" : "stable";
                console.log("[Turn route]", {...route, topic: undefined, messageIds: ids});
                const system = this.agent.state.messages[0];
                if (system?.role !== "system") throw new Error("Agent system message missing");
                this.agent.state.messages = [
                    {...system, sections: {...system.sections, memory: this.store.context(memoryScope), turn: turnGuidance(route)}},
                    ...this.store.turnsById(ids).flatMap(turn =>
                        this.turnMessages.get(turn.messageId) ?? restoreTurn(turn, this.agent.state.model)),
                ];
                const start = this.agent.state.messages.length;
                reply = await promptAgent(this.agent, text, write, {includeRuntime: route.mode !== "greet"});
                this.turnMessages.set(messageId, this.agent.state.messages.slice(start));
                state = advanceConversation(state, route, messageId);
                const retained = new Set([messageId, ...recent.slice(-5).map(turn => turn.messageId),
                    ...(state.currentTopic?.messageIds ?? []), ...(state.taskContext?.messageIds ?? [])]);
                for (const id of this.turnMessages.keys()) if (!retained.has(id)) this.turnMessages.delete(id);
            }
            await this.store.recordAssistant(messageId, reply, state);
            if (!command) {
                this.distiller.schedule(this.store.status().pending >= 5 || /记住|以后都|remember/i.test(text));
            }
            return reply;
        } catch (error) {
            this.turnMessages.delete(messageId);
            await this.store.recordAssistant(messageId, undefined).catch(console.error);
            throw error;
        }
    }
}
