import {readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {BACKGROUND_CONTEXT as context, type AgentMessage, type Branch, type JsonValue} from "@earendil-works/pi-agent-core";
import type {Api, Model} from "@earendil-works/pi-ai";
import type {ConversationJournal} from "./journal.ts";

export interface Topic {id: string; title: string}
type Move = {turn: string; from?: string; to: string};
type TreeEvent = {kind: "topic"; topic: Topic} | {kind: "attach"; topic: string; turn: string} |
    {kind: "select"; topic: string} | {kind: "edit"; moves: Move[]; before?: string; after: string} |
    {kind: "undo"; moves: Move[]; active?: string} |
    {kind: "checkpoint"; topic: string; turns: string[]; messages: AgentMessage[]};

// Pi branches hold references to immutable complete turns in the journal. Moving
// a reference changes context membership, never the original messages or effects.
export class ContextTree {
    active?: string;
    revision = 0;
    readonly topics = new Map<string, Topic>();
    private owners = new Map<string, string>();
    private edits: Extract<TreeEvent, {kind: "edit"}>[] = [];
    private checkpoints = new Map<string, Extract<TreeEvent, {kind: "checkpoint"}>>();
    readonly journal: ConversationJournal;
    private control: Branch;
    private directory: string;
    private constructor(journal: ConversationJournal, control: Branch, directory: string) {
        this.journal = journal;
        this.control = control;
        this.directory = directory;
    }

    static async open(journal: ConversationJournal, directory: string): Promise<ContextTree> {
        const session = journal.session;
        const control = await session.branch("context-tree", context) ?? await session.createBranch("context-tree", null, context);
        const tree = new ContextTree(journal, control, directory);
        for (const entry of await session.findEntries({customType: "context-tree", order: "asc"}, context)) {
            if (entry.type === "custom") tree.project(entry.data as unknown as TreeEvent);
        }
        await tree.importUnassigned();
        return tree;
    }

    private project(event: TreeEvent): void {
        if (event.kind === "topic") this.topics.set(event.topic.id, event.topic);
        if (event.kind === "attach") this.owners.set(event.turn, event.topic);
        if (event.kind === "select") this.active = event.topic;
        if (event.kind === "edit" || event.kind === "undo") {
            for (const move of event.moves) {
                const topic = event.kind === "edit" ? move.to : move.from;
                if (topic) this.owners.set(move.turn, topic); else this.owners.delete(move.turn);
            }
            this.active = event.kind === "edit" ? event.after : event.active;
            if (event.kind === "edit") this.edits.push(event); else this.edits.pop();
            this.checkpoints.clear();
        }
        if (event.kind === "checkpoint") this.checkpoints.set(event.topic, event);
        this.revision++;
    }

    private async append(event: TreeEvent, branch = this.control): Promise<void> {
        await branch.appendCustomEntry("context-tree", JSON.parse(JSON.stringify(event)) as JsonValue, context);
        this.project(event);
    }

    private async branch(id: string): Promise<Branch> {
        if (!this.topics.has(id)) throw new Error(`Unknown tree ${id}; use /tree to list IDs`);
        return (await this.journal.session.branch(`topic-${id}`, context))!;
    }

    async create(title: string): Promise<string> {
        const id = `t${this.topics.size + 1}`;
        const session = this.journal.session;
        const branch = await session.branch(`topic-${id}`, context) ?? await session.createBranch(`topic-${id}`, null, context);
        await this.append({kind: "topic", topic: {id, title: title.trim().slice(0, 120) || "新话题"}}, branch);
        return id;
    }

    async select(id: string): Promise<void> {
        await this.branch(id);
        if (this.active !== id) await this.append({kind: "select", topic: id});
    }

    async attach(turn: string, topic: string): Promise<void> {
        if (!this.journal.turns.some(item => item.messageId === turn)) throw new Error(`Unknown turn ${turn}`);
        if (this.owners.get(turn) === topic) return;
        await this.append({kind: "attach", topic, turn}, await this.branch(topic));
    }

    async edit(topic: string, turns: string[] = []): Promise<void> {
        const branch = await this.branch(topic);
        for (const id of turns) if (!this.journal.turns.some(turn => turn.messageId === id)) throw new Error(`Unknown turn ${id}`);
        const moves = [...new Set(turns)].map(turn => ({turn, from: this.owners.get(turn), to: topic}));
        // A single append commits the entire correction, including the active tree.
        await this.append({kind: "edit", moves, before: this.active, after: topic}, branch);
    }

    async undo(): Promise<boolean> {
        const edit = this.edits.at(-1);
        if (!edit) return false;
        await this.append({kind: "undo", moves: edit.moves, active: edit.before});
        return true;
    }

    async importUnassigned(): Promise<void> {
        const turns = this.journal.turns.filter(turn => !this.owners.has(turn.messageId) &&
            (turn.assistant !== undefined || turn.failed) && !/^\/(memory|tree)(?:\s|$)/.test(turn.user.trim()));
        if (!turns.length) return;
        const id = [...this.topics.values()].find(topic => topic.title === "导入的历史记录")?.id ?? await this.create("导入的历史记录");
        for (const turn of turns) await this.attach(turn.messageId, id);
        if (!this.active) await this.select(id);
    }

    turnIds(topic = this.active): string[] {
        return this.journal.turns.filter(turn => this.owners.get(turn.messageId) === topic).map(turn => turn.messageId);
    }

    recent(limit = 10) {
        return this.journal.turns.filter(turn => (turn.assistant !== undefined || turn.failed) &&
            !/^\/(memory|tree)(?:\s|$)/.test(turn.user.trim())).slice(-limit);
    }

    list() {
        return [...this.topics.values()].map(topic => {
            const turns = this.journal.turns.filter(turn => this.owners.get(turn.messageId) === topic.id);
            return {...topic, active: topic.id === this.active, turns: turns.length,
                last: turns.at(-1)?.user, at: turns.at(-1)?.at,
                recent: turns.slice(-3).map(turn => ({id: turn.messageId, user: turn.user.slice(0, 800), assistant: turn.assistant?.slice(0, 800)}))};
        });
    }

    search(query = "") {
        const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_-]+|[\p{Script=Han}]{1,2}/gu) ?? [])];
        return this.list().filter(topic => topic.turns).map(topic => {
            const turns = this.journal.turns.filter(turn => this.owners.get(turn.messageId) === topic.id &&
                (turn.assistant !== undefined || turn.failed));
            const matches = turns.map(turn => ({id: turn.messageId, user: turn.user, at: turn.at,
                hits: terms.filter(term => `${turn.user}\n${turn.assistant ?? ""}\n${JSON.stringify(this.journal.observations(turn.messageId))}`.toLowerCase().includes(term)).length}))
                .sort((a, b) => b.hits - a.hits || b.at.localeCompare(a.at));
            return {id: topic.id, title: topic.title, active: topic.active, at: topic.at,
                matches: matches.slice(0, 3).map(match => ({...match, user: match.user.slice(0, 600)})), score: matches[0]?.hits ?? 0,
                restore: {operation: "switch", id: topic.id}};
        }).sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active) || (b.at ?? "").localeCompare(a.at ?? ""))
            .slice(0, 5);
    }

    messages(model: Model<Api>, topic = this.active, extra: string[] = [], omit?: string): AgentMessage[] {
        const ids = this.turnIds(topic).filter(id => id !== omit);
        const checkpoint = topic && !extra.length ? this.checkpoints.get(topic) : undefined;
        if (checkpoint && checkpoint.turns.every((id, index) => ids[index] === id)) {
            return [...structuredClone(checkpoint.messages), ...this.journal.messages(model, ids.slice(checkpoint.turns.length))];
        }
        return this.journal.messages(model, [...ids, ...extra.filter(id => id !== omit)]);
    }

    async checkpoint(messages: AgentMessage[]): Promise<void> {
        if (this.active) await this.append({kind: "checkpoint", topic: this.active,
            turns: this.turnIds(), messages}, await this.branch(this.active));
    }

    async saveRequest(turn: string, payload: unknown, sources: string[]): Promise<void> {
        const path = join(this.directory, "context-latest.json");
        await writeFile(`${path}.tmp`, JSON.stringify({turn, topic: this.active, sources, payload}, null, 2), {mode: 0o600});
        await rename(`${path}.tmp`, path);
    }

    async lastRequest(): Promise<unknown> {
        try {return JSON.parse(await readFile(join(this.directory, "context-latest.json"), "utf8"));}
        catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return {message: "尚未发送模型请求"}; throw error;}
    }
}
