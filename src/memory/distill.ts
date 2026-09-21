import type {Api, Model, Models} from "@earendil-works/pi-ai";
import {memoryCategories, type MemoryChange, type MemoryStore} from "./store.ts";

const instructions = `你负责从私人聊天中维护精炼记忆。只返回 JSON：{"changes":[...]}，没有变化则返回 {"changes":[]}。
每项为 {"operation":"upsert|resolve|needs_check","id":"仅更新已有记忆时填写现有 ID；新增时不要填写","category":"profile|preference|project|decision|progress|open_issue","text":"一句具体事实","status":"active|needs_check","sourceMessageIds":["消息 ID"]}。
仅记录稳定身份/职责、偏好、项目约定、重要决策、重要完成事项和未解决问题；闲聊与一次性请求不要存。更新已有事实而非重复新增。
用户明确纠正已有记忆时，必须用该记忆的 id 执行 upsert，以纠正后的事实替换旧内容，sourceMessageIds 填本次纠正消息的 ID；不能同时保留互相矛盾的 active 事实。助手自己声称完成的操作不等于已核实；若值得保留，status 必须是 needs_check。不要保存密钥、令牌或其他凭据。
历史完成事项不会因时间流逝而过期。没有新证据时不得猜测问题已解决，也不得仅凭时间修改稳定事实。
sourceMessageIds 必须来自提供的聊天记录。单条 text 不超过 600 字，最多返回 8 项。`;

function parseChanges(text: string): MemoryChange[] {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const result: unknown = JSON.parse(cleaned);
    if (!result || typeof result !== "object" || !Array.isArray((result as {changes?: unknown}).changes)) {
        throw new Error("Memory extraction returned invalid JSON");
    }
    return (result as {changes: unknown[]}).changes.slice(0, 8).filter((value): value is MemoryChange => {
        if (!value || typeof value !== "object") return false;
        const item = value as Record<string, unknown>;
        return ["upsert", "resolve", "needs_check"].includes(String(item.operation)) &&
            (item.id === undefined || typeof item.id === "string") &&
            (item.category === undefined || memoryCategories.includes(item.category as typeof memoryCategories[number])) &&
            (item.text === undefined || typeof item.text === "string") &&
            (item.status === undefined || item.status === "active" || item.status === "needs_check") &&
            (item.sourceMessageIds === undefined ||
                (Array.isArray(item.sourceMessageIds) && item.sourceMessageIds.every((id) => typeof id === "string")));
    });
}

export class MemoryDistiller {
    private timer?: NodeJS.Timeout;
    private running?: Promise<string[]>;
    private readonly store: MemoryStore;
    private readonly models: Models;
    private readonly model: Model<Api>;

    constructor(
        store: MemoryStore,
        models: Models,
        model: Model<Api>,
    ) {
        this.store = store;
        this.models = models;
        this.model = model;
    }

    schedule(immediate = false): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.update().catch((error) => console.error("Memory extraction failed:", error));
        }, immediate ? 0 : 30_000);
        this.timer.unref();
    }

    async update(audit = false): Promise<string[]> {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        if (this.running) {
            const previous = await this.running;
            return audit || this.store.status().pending > 0
                ? [...previous, ...await this.update(audit)]
                : previous;
        }
        this.running = this.run(audit).finally(() => { this.running = undefined; });
        return this.running;
    }

    private async extract(turns: Array<{messageId: string}>, audit: boolean): Promise<MemoryChange[]> {
        const response = await this.models.completeSimple(this.model, {
            systemPrompt: instructions,
            messages: [{
                role: "user",
                content: JSON.stringify({
                    task: audit ? "仅核对近期聊天是否明确纠正或否定现有记忆。没有新证据就不要修改任何条目；无法访问外部状态本身不是过期证据。" : "提炼新增聊天",
                    existing: this.store.list(),
                    turns,
                }),
                timestamp: Date.now(),
            }],
        }, {temperature: 0, maxTokens: 1600});
        if (response.stopReason !== "stop") throw new Error(`Memory extraction stopped: ${response.stopReason}`);
        const ids = new Set(turns.map((turn) => turn.messageId));
        return parseChanges(response.content.filter((part) => part.type === "text").map((part) => part.text).join(""))
            .map((change) => ({...change, sourceMessageIds: change.sourceMessageIds?.filter((id) => ids.has(id))}))
            .filter((change) => (change.sourceMessageIds?.length ?? 0) > 0);
    }

    private async run(audit: boolean): Promise<string[]> {
        const report: string[] = [];
        while (true) {
            const batch = this.store.pendingBatch();
            if (batch.through === batch.from) break;
            if (batch.turns.length > 0) {
                const changes = await this.extract(batch.turns, false);
                report.push(...await this.store.apply(changes, batch.through));
            } else {
                await this.store.apply([], batch.through);
            }
            if (batch.through >= this.store.status().turns) break;
        }
        if (audit && this.store.list().length > 0) {
            const changes = (await this.extract(this.store.recentTurns(), true))
                .filter((change) => change.operation !== "upsert" || (change.id && this.store.get(change.id)));
            report.push(...await this.store.apply(changes, this.store.pendingBatch(0).through));
        }
        return report;
    }
}
