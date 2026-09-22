import {appendFileSync, mkdirSync, readFileSync, rmdirSync, writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";

// Shared by serial test processes and background memory/judge requests. An unfinished
// request keeps its reservation, including process death or a missing usage frame.
export function budgetStatus(path) {
    const [header, ...events] = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const requests = new Map();
    for (const event of events) requests.set(event.id, {...requests.get(event.id), ...event});
    const rows = [...requests.values()];
    return {limit: header.limit, requests: rows,
        accounted: rows.reduce((sum, row) => sum + (row.cost ?? row.reserved), 0),
        actual: rows.filter(row => row.basis === "reported").reduce((sum, row) => sum + row.cost, 0),
        unsettled: rows.filter(row => row.cost === undefined).length};
}

export function createBudget(path, limit) {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("A positive USD budget is required");
    writeFileSync(path, JSON.stringify({limit, createdAt: new Date().toISOString()}) + "\n", {flag: "wx", mode: 0o600});
}

export function budgetFetch(path, model, request = globalThis.fetch) {
    function reserve(reserved) {
        mkdirSync(path + ".lock"); // Contention fails closed; never race a second spender.
        try {
            const status = budgetStatus(path);
            if (status.accounted + reserved > status.limit) throw new Error("Evaluation USD budget exhausted before request");
            const id = randomUUID();
            appendFileSync(path, JSON.stringify({id, model: model.id, provider: model.provider, reserved,
                backend: process.env.AGENT_EVAL_BACKEND, at: new Date().toISOString()}) + "\n");
            return id;
        } finally {rmdirSync(path + ".lock");}
    }
    return async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
        const host = model.provider === "openrouter" ? "openrouter.ai" : model.provider === "jev" ? "api.typesafe.ai" : "api.deepseek.com";
        if (url.hostname !== host) throw new Error("Evaluation transport refused unexpected host");
        const body = typeof init?.body === "string" ? init.body : await new Request(input, init).clone().text();
        const payload = JSON.parse(body);
        const outputLimit = payload.max_tokens ?? payload.max_completion_tokens ?? (model.provider === "jev" ? 0 : undefined);
        if (!Number.isInteger(outputLimit) || outputLimit < 0 || outputLimit > 4096) throw new Error("Evaluation output cap missing or too large");
        const tiers = [model.cost, ...model.cost.tiers ?? []];
        const inputRate = Math.max(...tiers.flatMap(t => [t.input, t.cacheWrite ?? 0]));
        const outputRate = Math.max(...tiers.map(t => t.output));
        // UTF-8 bytes overcount text tokens; padding covers provider chat/tool framing.
        // This text/tool-only evaluator rejects oversized input instead of relying on truncation.
        const inputBound = Buffer.byteLength(body) + 8192;
        if (inputBound > 100_000) throw new Error("Evaluation input exceeds the bounded text workload");
        const reserved = (inputBound * inputRate + outputLimit * outputRate) / 1e6;
        const id = reserve(reserved);
        let usage = {}, generation;
        function observe(value) {
            generation ??= value.id ?? value.message?.id;
            Object.assign(usage, value.message?.usage, value.usage);
        }
        async function settle() {
            let cost = model.provider === "openrouter" ? usage.cost : undefined;
            let basis = "reported";
            if (model.provider === "openrouter" && !Number.isFinite(cost) && generation) {
                try {
                    const response = await request(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generation)}`, {
                        headers: {Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`}, signal: AbortSignal.timeout(5000),
                    });
                    if (response.ok) cost = (await response.json()).data?.total_cost;
                } catch { /* Unknown billing keeps the full reservation. */ }
            }
            if (model.provider !== "openrouter") {
                const tokens = usage.prompt_tokens ?? usage.input_tokens;
                const output = usage.completion_tokens ?? usage.output_tokens;
                if (Number.isFinite(tokens) && (model.provider === "jev" || Number.isFinite(output))) {
                    cost = (tokens * inputRate + (output ?? 0) * outputRate) / 1e6;
                    basis = "list-price upper estimate";
                }
            }
            if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
                appendFileSync(path, JSON.stringify({id, cost, basis, generation, usage}) + "\n");
            }
        }
        // No transport retries. Network errors retain their reservation because billing is unknown.
        const response = await request(input, {...init, redirect: "error"});
        if (!response.ok || !response.body) return response;
        if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
            const text = await response.text();
            observe(JSON.parse(text)); await settle();
            return new Response(text, {status: response.status, headers: response.headers});
        }
        let pending = "";
        const decoder = new TextDecoder();
        const stream = response.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                pending += decoder.decode(chunk, {stream: true});
                const lines = pending.split("\n"); pending = lines.pop();
                for (const line of lines) if (line.startsWith("data:")) {
                    const data = line.slice(5).trim();
                    if (data && data !== "[DONE]") {try {observe(JSON.parse(data));} catch { /* Provider parses malformed events. */ }}
                }
                controller.enqueue(chunk);
            },
            async flush() {await settle();},
        }));
        return new Response(stream, {status: response.status, headers: response.headers});
    };
}
