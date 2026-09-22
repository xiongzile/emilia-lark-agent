import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {test} from "node:test";
import {createTreeRouter} from "../../dist/agent/tree-router.js";

// Classifier-only cases prevent a fluent main-model reply from hiding a wrong route.
export function routing({name, history = [], state = {}, cases}) {
    test(name, async t => {
        if (!(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY)) throw new Error("JEV_API_KEY is required");
        let provider;
        const router = createTreeRouter({request: async (url, options) => {
            const response = await fetch(url, options);
            provider = {status: response.status, body: await response.clone().json().catch(() => undefined)};
            return response;
        }});
        const results = [];
        for (const {user, expect} of cases) await t.test(user, async () => {
            provider = undefined;
            const route = await router(user, state, history.map((turn, i) => ({messageId: `history-${i}`, ...turn})));
            const result = {user, expect, route, provider, passed: false};
            results.push(result);
            assert.equal(route.source, expect.source ?? "jev");
            assert.equal(route.mode, expect.mode);
            result.passed = true;
        });
        const directory = new URL("../../.private/test-runs/", import.meta.url);
        await mkdir(directory, {recursive: true});
        await writeFile(new URL(`routing-eval-${Date.now()}-${process.pid}.json`, directory),
            JSON.stringify({name, batch: process.env.AGENT_EVAL_BATCH,
                round: Number(process.env.AGENT_EVAL_ROUND ?? 1), results}, null, 2), {mode: 0o600});
    });
}
