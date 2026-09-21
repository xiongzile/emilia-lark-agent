import type {Agent} from "@earendil-works/pi-agent-core";
import {advanceContext, needsContext, type ContextState} from "../channels/context-state.ts";
import {MemoryDistiller} from "../memory/distill.ts";
import {memoryCategories, type MemoryCategory, type MemoryStore} from "../memory/store.ts";
import {promptAgent} from "./turn.ts";
import {formatAgentTime} from "../time.ts";

export function isMemoryCommand(text: string): boolean {
    return /^\/memory(?:\s|$)/.test(text.trim());
}

function memoryStatus(store: MemoryStore): string {
    const status = store.status();
    const counts = Object.entries(status.counts).map(([category, count]) => `${category}: ${count}`).join("，");
    const recent = store.list().filter((entry) => entry.status === "active").slice(-5)
        .map((entry) => `- ${entry.id} [${entry.category}] ${entry.text}`).join("\n");
    return `记忆状态：原话 ${status.turns} 轮，待提炼 ${status.pending} 轮。\n活跃记忆：${counts}；待核实 ${status.needsCheck}，已解决 ${status.resolved}。\n上次提炼：${status.lastExtractedAt ? formatAgentTime(status.lastExtractedAt) : "尚未提炼"}。\n最近的核心记忆：\n${recent || "暂无"}\n使用 /memory list 查看全部条目，/memory update 重新提炼和核对。`;
}

async function memoryCommand(text: string, store: MemoryStore, distiller: MemoryDistiller): Promise<string> {
    const parts = text.trim().split(/\s+/);
    const action = parts[1] ?? "status";
    if (action === "status") return memoryStatus(store);
    if (action === "list") {
        const category = parts[2];
        if (category && !memoryCategories.includes(category as MemoryCategory)) {
            return `未知类别：${category}。可选：${memoryCategories.join("、")}`;
        }
        const entries = store.list(category as MemoryCategory | undefined).slice(-30);
        return entries.length === 0 ? "暂无对应记忆。" : entries
            .map((entry) => `${entry.id} [${entry.category}/${entry.status}] ${entry.text}`)
            .join("\n");
    }
    if (action === "show") {
        const entry = store.get(parts[2] ?? "");
        return entry ? JSON.stringify({...entry, updatedAt: formatAgentTime(entry.updatedAt)}, null, 2) : "找不到这条记忆。";
    }
    if (action === "forget") {
        if (!parts[2]) return "用法：/memory forget <ID>";
        await distiller.update();
        return await store.forget(parts[2]) ? `已删除记忆 ${parts[2]}。原话归档保留。` : "找不到这条记忆。";
    }
    if (action === "update") {
        const changes = await distiller.update(true);
        return `${changes.length ? changes.join("\n") : "没有发现需要修改的记忆。"}\n\n${memoryStatus(store)}\n本次核对依据是本地聊天记录；未访问的外部项目状态不会被当作已验证。`;
    }
    return "可用指令：/memory status、/memory list [类别]、/memory show <ID>、/memory update、/memory forget <ID>。";
}

export class AgentSession {
    private contextState: ContextState = {kind: "reload"};
    private readonly agent: Agent;
    private readonly store: MemoryStore;
    private readonly distiller: MemoryDistiller;

    constructor(
        agent: Agent,
        store: MemoryStore,
        distiller: MemoryDistiller,
    ) {
        this.agent = agent;
        this.store = store;
        this.distiller = distiller;
    }

    async run(messageId: string, text: string, write?: (content: string) => Promise<void>): Promise<string> {
        await this.store.recordUser(messageId, text);
        const command = isMemoryCommand(text);
        try {
            let reply: string;
            if (command) {
                reply = await memoryCommand(text, this.store, this.distiller);
                this.contextState = advanceContext(this.contextState, "command");
            } else {
                const reload = needsContext(this.contextState);
                if (reload) this.agent.state.messages = this.agent.state.messages.slice(0, 1);
                reply = await promptAgent(this.agent, text, write, reload ? this.store.context() : undefined);
                this.contextState = advanceContext(this.contextState, "replied");
            }
            await this.store.recordAssistant(messageId, reply);
            if (!command) {
                this.distiller.schedule(this.store.status().pending >= 5 || /记住|以后都|remember/i.test(text));
            }
            return reply;
        } catch (error) {
            this.contextState = advanceContext(this.contextState, "failed");
            await this.store.recordAssistant(messageId, undefined).catch(console.error);
            throw error;
        }
    }
}
