import {chmod, copyFile, mkdir} from "node:fs/promises";
import {constants} from "node:fs";
import {join, resolve} from "node:path";
import {BACKGROUND_CONTEXT as context, JsonlSessionRepo, type AgentMessage, type Branch, type Entry,
    type JsonValue, type Session} from "@earendil-works/pi-agent-core";
import {NodeExecutionEnv} from "@earendil-works/pi-agent-core/harness/env/nodejs";
import type {Api, Model} from "@earendil-works/pi-ai";
import type {Turn} from "../memory/store.ts";
import {restoreTurn} from "./history.ts";

type Event = {kind: "user"; turn: Turn} |
    {kind: "reply"; messageId: string; assistant?: string};

// Pi owns append-only persistence. Turns and working context are projections of
// the same record; neither a view change nor compaction deletes source messages.
export class ConversationJournal {
    readonly turns: Turn[] = [];
    private entries: Entry[];
    private pending = Promise.resolve();
    readonly session: Session;
    private branch: Branch;

    private constructor(session: Session, branch: Branch, entries: Entry[]) {
        this.session = session;
        this.branch = branch;
        this.entries = entries;
        for (const entry of entries) if (entry.type === "custom" && entry.customType === "conversation") {
            this.project(entry.data as unknown as Event);
        }
        // Interrupted requests remain readable, but must never be replayed as actions.
        for (const turn of this.turns) if (turn.assistant === undefined) turn.failed = true;
    }

    static async open(directory: string, loadLegacy: () => Promise<Turn[]>): Promise<ConversationJournal> {
        directory = resolve(directory);
        const root = join(directory, "sessions");
        await mkdir(root, {recursive: true, mode: 0o700});
        const repo = new JsonlSessionRepo({sessionsRoot: root, fileSystem: new NodeExecutionEnv({cwd: directory})});
        const metadata = (await repo.list({cwd: directory}, context)).find(item => item.id === "conversation");
        const session = metadata ? await repo.open(metadata, context) : await repo.create({cwd: directory, id: "conversation"}, context);
        await chmod(session.metadata.path, 0o600);
        try {
            const branch = await session.branch("main", context) ?? await session.createBranch("main", null, context);
            const journal = new ConversationJournal(session, branch, await session.findEntries({order: "asc"}, context));
            // The import marker is written last, so an interrupted import resumes by ID.
            const imported = await session.getName(context);
            if (imported !== "conversation-v1") {
                const legacy = await loadLegacy();
                if (legacy.length) await copyFile(join(directory, "transcript.json"), join(directory, "transcript.legacy.json"), constants.COPYFILE_EXCL)
                    .catch(error => {if (error.code !== "EEXIST") throw error;});
                for (const turn of legacy) {
                    const existing = journal.turns.find(item => item.messageId === turn.messageId);
                    if (!existing) await journal.record({kind: "user", turn: {messageId: turn.messageId, at: turn.at, user: turn.user}});
                    if (existing?.assistant === undefined) await journal.record({kind: "reply", messageId: turn.messageId, assistant: turn.assistant});
                }
                await session.setName("conversation-v1", context);
            }
            // A process can disappear between a tool result and recordAssistant.
            // Close that turn in the journal without retrying its side effects.
            const replied = new Set<string>();
            for (const entry of journal.entries) if (entry.type === "custom" && entry.customType === "conversation") {
                const event = entry.data as unknown as Event;
                if (event.kind === "reply") replied.add(event.messageId);
            }
            for (const turn of journal.turns) if (!replied.has(turn.messageId)) {
                await journal.record({kind: "reply", messageId: turn.messageId});
            }
            return journal;
        } catch (error) {
            await session.close(context);
            throw error;
        }
    }

    private project(event: Event): void {
        if (event.kind === "user") this.turns.push(structuredClone(event.turn));
        if (event.kind === "reply") {
            const turn = this.turns.find(item => item.messageId === event.messageId);
            if (!turn) throw new Error(`Missing conversation turn ${event.messageId}`);
            if (event.assistant === undefined) turn.failed = true;
            else {turn.assistant = event.assistant; delete turn.failed;}
        }
    }

    private enqueue(write: () => Promise<void>): Promise<void> {
        this.pending = this.pending.then(write);
        // Observe immediately; flush still propagates persistence errors to the caller.
        void this.pending.catch(() => undefined);
        return this.pending;
    }

    record(event: Event): Promise<void> {
        const snapshot = JSON.parse(JSON.stringify(event)) as Event;
        return this.enqueue(async () => {
            const id = await this.branch.appendCustomEntry("conversation", snapshot as unknown as JsonValue, context);
            this.entries.push((await this.session.getEntry(id, context))!);
            this.project(snapshot);
        });
    }

    appendMessage(message: AgentMessage): Promise<void> {
        const snapshot = structuredClone(message);
        return this.enqueue(async () => {
            const id = await this.branch.appendMessage(snapshot, context);
            this.entries.push((await this.session.getEntry(id, context))!);
        });
    }

    flush(): Promise<void> {return this.pending;}
    async close(): Promise<void> {await this.flush(); await this.session.close(context);}

    messages(model: Model<Api>, ids: string[]): AgentMessage[] {
        const result: AgentMessage[] = [];
        const selected = new Set(ids);
        let active = false;
        let turn: Turn | undefined;
        let hasMessages = false;
        for (const entry of this.entries) {
            if (entry.type === "custom" && entry.customType === "conversation") {
                const event = entry.data as unknown as Event;
                if (event.kind === "user") {
                    turn = event.turn;
                    hasMessages = false;
                    active = selected.has(turn.messageId);
                } else if (event.kind === "reply" && active && turn && !/^\/(memory|tree)(?:\s|$)/.test(turn.user.trim())) {
                    if (!hasMessages) result.push(...restoreTurn({...turn, assistant: event.assistant, failed: event.assistant === undefined}, model));
                    else if (event.assistant === undefined) result.push({role: "user", timestamp: Date.parse(turn.at),
                        content: "[上一轮中断；已记录的工具结果仍有效，未取得的结果未知。不要自动重做历史操作。]"});
                }
            } else if (entry.type === "message") {
                hasMessages = true;
                const message = entry.message;
                if (active && message.role !== "system" && !(message.role === "assistant" &&
                    ["error", "aborted"].includes(message.stopReason))) result.push(structuredClone(message));
            }
        }
        return result;
    }

    observations(messageId: string): AgentMessage[] {
        let active = false;
        const result: AgentMessage[] = [];
        for (const entry of this.entries) {
            if (entry.type === "custom" && entry.customType === "conversation") {
                const event = entry.data as unknown as Event;
                if (event.kind === "user") active = event.turn.messageId === messageId;
            } else if (active && entry.type === "message" && (entry.message.role === "toolResult" ||
                (entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall")))) {
                result.push(entry.message);
            }
        }
        return result;
    }
}
