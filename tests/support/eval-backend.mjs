import {readFileSync} from "node:fs";
import {replayRouter} from "./route-replay.mjs";
import {createModelBackend} from "../../dist/agent/models.js";
import {createTreeRouter} from "../../dist/agent/tree-router.js";
import {budgetFetch} from "./eval-budget.mjs";

export function evaluationBackend({judge = false} = {}) {
    const provider = judge ? "deepseek" : process.env.AGENT_EVAL_PROVIDER || "deepseek";
    const modelId = judge ? process.env.AGENT_EVAL_JUDGE_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash"
        : process.env.AGENT_EVAL_MODEL;
    const backend = createModelBackend(provider, modelId);
    const ledger = process.env.AGENT_EVAL_BUDGET_FILE;
    if (provider === "openrouter" && !ledger) throw new Error("OpenRouter evaluations require a shared USD budget; use eval:backends");
    if (ledger) {
        const stream = backend.models.streamSimple.bind(backend.models);
        // completeSimple also calls streamSimple: memory, compaction and judge spend
        // cannot escape this guard. maxTokens includes provider reasoning output.
        backend.models.streamSimple = (model, context, options) => stream(model, context, {
            ...options, maxTokens: Math.min(options?.maxTokens ?? 2048, 2048),
            maxRetries: 0, timeoutMs: 60_000,
            fetch: budgetFetch(ledger, model),
            onPayload: async (payload, selected) => {
                if (selected.provider === "openrouter") payload = {...payload, provider: {
                    allow_fallbacks: false, max_price: {prompt: selected.cost.input, completion: selected.cost.output, request: 0},
                }};
                return await options?.onPayload?.(payload, selected) ?? payload;
            },
        });
    }
    return backend;
}

export function evaluationRouter(name) {
    if (process.env.AGENT_EVAL_ROUTES) return replayRouter(JSON.parse(readFileSync(process.env.AGENT_EVAL_ROUTES, "utf8")), name);
    const ledger = process.env.AGENT_EVAL_BUDGET_FILE;
    return createTreeRouter(ledger ? {request: budgetFetch(ledger,
        {id: "jev-1.13.0", provider: "jev", cost: {input: 0.042, output: 0}})} : {});
}
