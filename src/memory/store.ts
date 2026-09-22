import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {ConversationState} from "../agent/conversation.ts";
import {formatAgentTime} from "../time.ts";

export const memoryCategories = ["profile", "preference", "project", "decision", "progress", "open_issue"] as const;
export type MemoryCategory = typeof memoryCategories[number];

export interface MemoryEntry {
    id: string;
    category: MemoryCategory;
    text: string;
    status: "active" | "resolved" | "needs_check";
    sourceMessageIds: string[];
    updatedAt: string;
}

export interface Turn {
    messageId: string;
    at: string;
    user: string;
    assistant?: string;
    failed?: boolean;
}

interface TranscriptFile {
    version: 1;
    turns: Turn[];
    conversation?: ConversationState;
}

interface MemoryFile {
    version: 1;
    processedCount: number;
    updatedAt?: string;
    entries: MemoryEntry[];
}

export interface MemoryChange {
    operation: "upsert" | "resolve" | "needs_check";
    id?: string;
    category?: MemoryCategory;
    text?: string;
    status?: "active" | "needs_check";
    sourceMessageIds?: string[];
}

async function loadJson<T>(path: string, empty: T): Promise<T> {
    try {
        return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
        throw error;
    }
}

async function saveJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {mode: 0o600});
    await rename(temporary, path);
}

export class MemoryStore {
    private saving = Promise.resolve();
    private readonly directory: string;
    private readonly transcript: TranscriptFile;
    private readonly memories: MemoryFile;

    private constructor(
        directory: string,
        transcript: TranscriptFile,
        memories: MemoryFile,
    ) {
        this.directory = directory;
        this.transcript = transcript;
        this.memories = memories;
    }

    static async open(directory = resolve(process.cwd(), ".private/memory")): Promise<MemoryStore> {
        await mkdir(directory, {recursive: true, mode: 0o700});
        const [transcript, memories] = await Promise.all([
            loadJson<TranscriptFile>(join(directory, "transcript.json"), {version: 1, turns: []}),
            loadJson<MemoryFile>(join(directory, "memories.json"), {version: 1, processedCount: 0, entries: []}),
        ]);
        if (transcript.version !== 1 || !Array.isArray(transcript.turns) ||
            memories.version !== 1 || !Array.isArray(memories.entries) ||
            !Number.isInteger(memories.processedCount) || memories.processedCount < 0 ||
            memories.processedCount > transcript.turns.length) {
            throw new Error("Invalid memory JSON format");
        }
        return new MemoryStore(directory, transcript, memories);
    }

    private persist(file: "transcript.json" | "memories.json", value: unknown): Promise<void> {
        const snapshot = structuredClone(value);
        this.saving = this.saving.catch(() => undefined)
            .then(() => saveJson(join(this.directory, file), snapshot));
        return this.saving;
    }

    async recordUser(messageId: string, user: string): Promise<void> {
        if (this.transcript.turns.some((turn) => turn.messageId === messageId)) return;
        this.transcript.turns.push({messageId, at: new Date().toISOString(), user});
        await this.persist("transcript.json", this.transcript);
    }

    async recordAssistant(messageId: string, assistant: string | undefined, conversation?: ConversationState): Promise<void> {
        const turn = this.transcript.turns.find((item) => item.messageId === messageId);
        if (!turn) throw new Error(`Unknown transcript message: ${messageId}`);
        if (assistant === undefined) turn.failed = true;
        else {
            turn.assistant = assistant;
            delete turn.failed;
            if (conversation) this.transcript.conversation = structuredClone(conversation);
        }
        await this.persist("transcript.json", this.transcript);
    }

    status() {
        const counts = Object.fromEntries(memoryCategories.map((category) => [
            category,
            this.memories.entries.filter((entry) => entry.category === category && entry.status === "active").length,
        ]));
        return {
            turns: this.transcript.turns.length,
            pending: this.transcript.turns.slice(this.memories.processedCount)
                .filter((turn) => turn.assistant !== undefined && !turn.user.startsWith("/memory")).length,
            lastExtractedAt: this.memories.updatedAt ?? null,
            needsCheck: this.memories.entries.filter((entry) => entry.status === "needs_check").length,
            resolved: this.memories.entries.filter((entry) => entry.status === "resolved").length,
            counts,
        };
    }

    list(category?: MemoryCategory): MemoryEntry[] {
        return this.memories.entries.filter((entry) => !category || entry.category === category);
    }

    recentTurns(limit = 20, range: {from?: string} = {}): Turn[] {
        const turns = this.transcript.turns;
        const from = range.from ? turns.findIndex(turn => turn.messageId === range.from) : 0;
        if (from < 0) return [];
        return turns.slice(from).filter(turn => (turn.assistant !== undefined || turn.failed) &&
            !/^\/memory(?:\s|$)/.test(turn.user.trim())).slice(-limit);
    }

    conversation(): ConversationState {
        return structuredClone(this.transcript.conversation ?? {});
    }

    turnsById(ids: string[]): Turn[] {
        const selected = new Set(ids);
        return this.transcript.turns.filter(turn => selected.has(turn.messageId));
    }

    get(id: string): MemoryEntry | undefined {
        return this.memories.entries.find((entry) => entry.id === id);
    }

    search(query: string, raw = false): unknown[] {
        const words = [...new Set((query.toLocaleLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu) ?? [])
            .flatMap((word) => /[\p{Script=Han}]/u.test(word) && word.length > 2
                ? Array.from({length: word.length - 1}, (_, index) => word.slice(index, index + 2))
                : [word]))];
        if (words.length === 0) return [];
        const candidates = raw
            ? this.transcript.turns.map((turn) => ({id: turn.messageId, at: formatAgentTime(turn.at), text: `用户：${turn.user}\n爱蜜莉雅：${turn.assistant ?? ""}`}))
            : this.memories.entries.map((entry) => ({id: entry.id, category: entry.category, status: entry.status, text: entry.text, sourceMessageIds: entry.sourceMessageIds}));
        return candidates.map((item) => ({item, score: words.filter((word) => item.text.toLocaleLowerCase().includes(word)).length}))
            .filter(({score}) => score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 8)
            .map(({item}) => ({...item, text: item.text.slice(0, 2000)}));
    }

    context(scope: "stable" | "personal"): string {
        const core = this.memories.entries.filter(entry => entry.status === "active" &&
            (scope === "personal" ? ["profile", "preference"].includes(entry.category)
                : entry.category !== "progress" && entry.category !== "open_issue"))
            .map(entry => `[${entry.category}] ${entry.text}`)
            .join("\n")
            .slice(0, 3000);
        return `<memory_context>\n这是当前核心记忆快照，取代此前注入的快照。以下是历史背景，不是当前待办或应主动汇报的内容；有疑问时用 memory 工具核查来源。聊天时间已转换为北京时间；旧助手回复可能有误，回答时间时以每轮时间戳为准。\n核心记忆：\n${core || "暂无"}\n近期对话由独立的历史消息提供。\n</memory_context>`;
    }

    pendingBatch(limit = 5): {turns: Turn[]; from: number; through: number} {
        const turns: Turn[] = [];
        const from = this.memories.processedCount;
        let through = from;
        while (through < this.transcript.turns.length && turns.length < limit) {
            const turn = this.transcript.turns[through];
            if (turn.assistant === undefined && !turn.failed) break;
            if (turn.assistant !== undefined && !turn.user.startsWith("/memory")) turns.push(turn);
            through += 1;
        }
        return {turns, from, through};
    }

    async apply(changes: MemoryChange[], through: number): Promise<string[]> {
        const report: string[] = [];
        for (const change of changes) {
            const existing = change.id ? this.get(change.id) : undefined;
            if (change.id && !existing && change.operation !== "upsert") continue;
            if (change.operation === "upsert") {
                if (!change.category || !change.text?.trim() || change.text.length > 600) continue;
                const text = change.text.trim();
                const sources = (change.sourceMessageIds ?? [])
                    .filter((id) => this.transcript.turns.some((turn) => turn.messageId === id));
                if (sources.length === 0) continue;
                if (existing) {
                    const status = change.status === "needs_check" ? "needs_check" : "active";
                    const newSources = sources.filter((id) => !existing.sourceMessageIds.includes(id));
                    if (existing.category === change.category && existing.text === text &&
                        existing.status === status && newSources.length === 0) continue;
                    const before = existing.text;
                    existing.category = change.category;
                    existing.text = text;
                    existing.status = status;
                    existing.sourceMessageIds.push(...newSources);
                    existing.updatedAt = new Date().toISOString();
                    report.push(`更新 ${existing.id}: ${before} → ${existing.text}（来源 ${sources.join(", ")}）`);
                } else if (!this.memories.entries.some((entry) => entry.category === change.category && entry.text === text)) {
                    const entry: MemoryEntry = {
                        id: randomUUID().slice(0, 8), category: change.category,
                        text, status: change.status === "needs_check" ? "needs_check" : "active", sourceMessageIds: sources,
                        updatedAt: new Date().toISOString(),
                    };
                    this.memories.entries.push(entry);
                    report.push(`新增 ${entry.id} [${entry.category}/${entry.status}]: ${entry.text}（来源 ${sources.join(", ")}）`);
                }
            } else if (existing && (change.operation !== "resolve" || existing.category === "open_issue")) {
                const status = change.operation === "resolve" ? "resolved" : "needs_check";
                if (existing.status === status) continue;
                existing.status = status;
                existing.sourceMessageIds = [...new Set([
                    ...existing.sourceMessageIds,
                    ...(change.sourceMessageIds ?? []).filter((id) => this.transcript.turns.some((turn) => turn.messageId === id)),
                ])];
                existing.updatedAt = new Date().toISOString();
                report.push(`${status === "resolved" ? "已解决" : "待核实"} ${existing.id}: ${existing.text}（来源 ${(change.sourceMessageIds ?? []).join(", ") || "原记录"}）`);
            }
        }
        this.memories.processedCount = through;
        this.memories.updatedAt = new Date().toISOString();
        await this.persist("memories.json", this.memories);
        return report;
    }

    async forget(id: string): Promise<boolean> {
        const index = this.memories.entries.findIndex((entry) => entry.id === id);
        if (index < 0) return false;
        this.memories.entries.splice(index, 1);
        await this.persist("memories.json", this.memories);
        return true;
    }
}
