import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {MemoryStore} from "./store.ts";
import {formatAgentTime} from "../time.ts";

const parameters = Type.Object({
    operation: Type.Union([Type.Literal("search"), Type.Literal("read")]),
    query: Type.Optional(Type.String({description: "Search terms. Required for search."})),
    id: Type.Optional(Type.String({description: "Memory ID. Required for read."})),
});

export function createMemoryTool(store: MemoryStore): AgentTool<typeof parameters, {operation: string}> {
    return {
        name: "memory",
        label: "Memory",
        description: "Retrieve distilled long-term facts and preferences. Results include source turn IDs, readable through context_tree. Use context_tree for recent dialogue and original wording. Do not treat old assistant claims as verified facts.",
        parameters,
        executionMode: "sequential",
        async execute(_toolCallId, {operation, query, id}) {
            let result: unknown;
            if (operation === "read") {
                if (!id) throw new Error("id is required for read");
                const entry = store.get(id);
                result = entry ? {...entry, updatedAt: formatAgentTime(entry.updatedAt)} : {error: "Memory not found"};
            } else {
                if (!query?.trim()) throw new Error("query is required for search");
                result = store.search(query);
            }
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: {operation},
            };
        },
    };
}
