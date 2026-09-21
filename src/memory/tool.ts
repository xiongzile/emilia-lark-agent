import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {MemoryStore} from "./store.ts";
import {formatAgentTime} from "../time.ts";

const parameters = Type.Object({
    operation: Type.Union([Type.Literal("search"), Type.Literal("read")]),
    query: Type.Optional(Type.String({description: "Search terms. Required for search."})),
    id: Type.Optional(Type.String({description: "Memory ID. Required for read."})),
    source: Type.Optional(Type.Union([Type.Literal("memories"), Type.Literal("transcript")], {
        description: "Search curated memories first; use transcript for older exact wording.",
    })),
});

export function createMemoryTool(store: MemoryStore): AgentTool<typeof parameters, {operation: string}> {
    return {
        name: "memory",
        label: "Memory",
        description: "Search curated long-term memories or archived chat wording when the small automatic context lacks an older detail. Results include source IDs. Do not treat old assistant claims as verified facts.",
        parameters,
        executionMode: "sequential",
        async execute(_toolCallId, {operation, query, id, source}) {
            let result: unknown;
            if (operation === "read") {
                if (!id) throw new Error("id is required for read");
                const entry = store.get(id);
                result = entry ? {...entry, updatedAt: formatAgentTime(entry.updatedAt)} : {error: "Memory not found"};
            } else {
                if (!query?.trim()) throw new Error("query is required for search");
                result = store.search(query, source === "transcript");
            }
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: {operation},
            };
        },
    };
}
