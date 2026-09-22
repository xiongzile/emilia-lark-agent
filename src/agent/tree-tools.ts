import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {MemoryStore} from "../memory/store.ts";
import type {ContextTree} from "./context-tree.ts";
import {formatAgentTime} from "../time.ts";

export function isTreeCommand(text: string): boolean {return /^\/tree(?:\s|$)/.test(text.trim());}

const parameters = Type.Object({
    operation: Type.Union([Type.Literal("list"), Type.Literal("recent"), Type.Literal("read"), Type.Literal("search"),
        Type.Literal("new"), Type.Literal("switch"), Type.Literal("move"), Type.Literal("undo")]),
    id: Type.Optional(Type.String({description: "Tree ID for switch/move, tree or turn ID for read. Use returned IDs."})),
    query: Type.Optional(Type.String({description: "Search terms; omit to find recent candidate topics."})),
    title: Type.Optional(Type.String({description: "Short title for a new topic."})),
    turns: Type.Optional(Type.Array(Type.String(), {description: "Complete turn IDs to reassign with move. Originals and tool results stay intact."})),
    before: Type.Optional(Type.String({description: "Exclusive turn ID cursor for recent."})),
    offset: Type.Optional(Type.Integer({minimum: 0})),
});

function page(value: unknown, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    const text = JSON.stringify(value, null, 2);
    let end = Math.min(text.length, offset + 6000);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    return {text: text.slice(offset, end), nextOffset: end < text.length ? end : null};
}

export function renderTree(tree: ContextTree): string {
    const topics = tree.list();
    return `上下文树（原话与工具结果永久保留）\n${topics.length ? topics.map(topic =>
        `${topic.active ? "→" : "├"} ${topic.id} ${topic.title} [${topic.turns} 轮]\n  ${topic.at ? formatAgentTime(topic.at) : "尚无对话"}${topic.last ? ` · ${topic.last.slice(0, 100)}` : ""}`).join("\n") : "暂无话题"}\n\n/tree show <树ID> 查看原话；/tree context 查看实际输入；/tree help 查看全部指令。`;
}

export function recoveryCandidates(tree: ContextTree, query: string): string {
    const candidates = tree.search(query).filter(topic => topic.id !== tree.active).slice(0, 3);
    return candidates.length ? `当前话题中没有确定的对应对象，我找到了这些历史话题：\n${candidates.map((topic, index) =>
        `${index + 1}. ${topic.id} ${topic.title}\n   ${topic.matches[0]?.user.slice(0, 160) ?? ""}`).join("\n")}\n你指哪一个？可以说话题名称，或 /tree use <树ID> 切换。`
        : "当前树和历史树中还没有找到可确定的对象。可以补充话题名称，或用 /tree 检查现有记录。";
}

export function createContextTreeTool(store: MemoryStore): AgentTool<typeof parameters> {
    return {name: "context_tree", label: "Context tree", parameters, executionMode: "sequential",
        description: "Inspect and repair conversation topics. list shows trees; recent lists original turns across trees; read opens full wording and recorded tool results; search ranks candidate trees by identifiers, text and recency (ranking is not certainty). When a reference is missing, search before claiming it was lost; present candidates if ambiguous. new starts a clean topic; switch restores a specific tree; move corrects complete-turn membership; undo reverses the last correction. Use these operations when the user corrects context, not just a verbal promise. Historical assistant statements are not verified facts; switching context never repeats past operations.",
        async execute(_callId, {operation, id, query, title, turns, before, offset = 0}) {
            const tree = store.tree;
            let result: unknown;
            if (operation === "list") result = tree.list();
            else if (operation === "search") result = {candidates: tree.search(query), note: "Candidate matches, not verified current business state."};
            else if (operation === "recent") {
                const records = tree.recent(Number.MAX_SAFE_INTEGER);
                const end = before ? records.findIndex(turn => turn.messageId === before) : records.length;
                if (end < 0) throw new Error("Unknown before cursor");
                const start = Math.max(0, end - 10);
                result = {turns: records.slice(start, end).map(turn => ({id: turn.messageId, at: formatAgentTime(turn.at),
                    user: turn.user.slice(0, 800), assistant: {source: "historical_assistant_statement", text: turn.assistant?.slice(0, 800)}})),
                    nextBefore: start > 0 ? records[start].messageId : null};
            } else if (operation === "read") {
                const ids = id && tree.topics.has(id) ? tree.turnIds(id) : [id];
                const records = store.history.turns.filter(turn => ids.includes(turn.messageId));
                if (!records.length) throw new Error("Tree or conversation turn not found; use list/recent/search.");
                const values = records.map(turn => ({id: turn.messageId, at: formatAgentTime(turn.at), user: turn.user,
                    assistant: {source: "historical_assistant_statement", text: turn.assistant}, interrupted: turn.failed ?? false,
                    observations: store.history.observations(turn.messageId)}));
                result = page(values.length === 1 ? values[0] : values, offset);
            } else if (operation === "undo") result = {undone: await tree.undo(), active: tree.active};
            else {
                const current = store.history.turns.at(-1)?.messageId;
                if (operation === "new") {
                    if (!title?.trim()) throw new Error("new requires a title");
                    id = await tree.create(title);
                }
                if (!id) throw new Error("A tree ID is required");
                if (operation === "move" && !turns?.length) throw new Error("move requires complete turn IDs");
                await tree.edit(id, operation === "move" ? turns : current ? [current] : []);
                result = {active: tree.active, moved: operation === "move" ? turns : [current], originalRecordsPreserved: true};
            }
            return {content: [{type: "text", text: JSON.stringify(result)}], details: {operation}};
        }};
}

export async function treeCommand(text: string, store: MemoryStore): Promise<string> {
    const [, action = "list", ...args] = text.trim().split(/\s+/);
    const tree = store.tree;
    if (action === "list") return renderTree(tree);
    if (action === "new") {await tree.edit(await tree.create(args.join(" ") || "新话题")); return renderTree(tree);}
    if (action === "use") {await tree.edit(args[0]); return renderTree(tree);}
    if (action === "move") {await tree.edit(args[1], [args[0]]); return renderTree(tree);}
    if (action === "undo") return `${await tree.undo() ? "已撤销上次上下文调整。" : "没有可撤销的调整。"}\n${renderTree(tree)}`;
    if (action === "search") return JSON.stringify(tree.search(args.join(" ")), null, 2);
    if (action === "show") {
        const result = await createContextTreeTool(store).execute("command", {operation: "read", id: args[0] ?? tree.active, offset: Number(args[1] ?? 0)});
        return result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    }
    if (action === "context") {
        const snapshot = await tree.lastRequest();
        return JSON.stringify(page(snapshot, Number(args[0] ?? 0)), null, 2);
    }
    return "/tree：查看树；/tree show <树或消息ID> [offset]：查看原话与工具结果；/tree context [offset]：查看最近一次实际模型请求；/tree search <关键词>：搜索候选；/tree new [标题]：新建；/tree use <树ID>：切换；/tree move <消息ID> <树ID>：纠正归属；/tree undo：撤销。分页使用返回的 nextOffset。";
}
