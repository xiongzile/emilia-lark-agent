import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {test} from "node:test";
import {createTurnRouter} from "../../dist/agent/conversation.js";

// Classifier-only cases prevent a fluent main-model reply from hiding a wrong route.
export function routing({name, history = [], state = {}, cases}) {
    test(name, async t => {
        if (!(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY)) throw new Error("JEV_API_KEY is required");
        const router = createTurnRouter();
        const results = [];
        for (const {user, expect} of cases) await t.test(user, async () => {
            const route = await router(user, state, history.map((turn, i) => ({messageId: `history-${i}`, ...turn})));
            const result = {user, expect, route, passed: false};
            results.push(result);
            assert.equal(route.source, expect.source ?? "jev");
            assert.equal(route.mode, expect.mode);
            if (expect.history) assert.ok([expect.history].flat().includes(route.history), JSON.stringify(route));
            result.passed = true;
        });
        const directory = new URL("../../.private/test-runs/", import.meta.url);
        await mkdir(directory, {recursive: true});
        await writeFile(new URL(`routing-eval-${Date.now()}-${process.pid}.json`, directory),
            JSON.stringify({name, results}, null, 2), {mode: 0o600});
    });
}
