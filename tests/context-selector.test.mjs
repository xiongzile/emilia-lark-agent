import assert from "node:assert/strict";
import {test} from "node:test";
import {createContextSelector} from "../dist/agent/context-selector.js";

const turns = Array.from({length: 6}, (_, i) => ({messageId: `m${i}`, user: `问题 ${i}`, assistant: `回复 ${i}`}));

test("Jev failure leaves history for on-demand retrieval and never exposes its error body", async (t) => {
    const failures = {
        permission: async () => new Response("sensitive provider error", {status: 401}),
        unavailable: async () => { throw new Error("network error with sensitive details"); },
        malformed: async () => Response.json({answers: {context: {type: "choice", choice: "chat", confidence: 1}}}),
        timeout: async (_url, {signal}) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
            // Keep this fake request alive, as a real HTTP socket would.
            const timer = setTimeout(() => reject(new Error("test deadline")), 1000);
            signal.addEventListener("abort", () => clearTimeout(timer), {once: true});
        }),
    };
    for (const [name, request] of Object.entries(failures)) await t.test(name, async () => {
        const select = createContextSelector({apiKey: "fixture-key", request, timeoutMs: 20});
        const result = await select("继续", turns);
        assert.equal(result.source, "fallback");
        assert.deepEqual(result.messageIds, []);
        assert.doesNotMatch(JSON.stringify(result), /sensitive|fixture-key/);
        if (name === "timeout") assert.equal(result.reason, "timeout");
    });
});

test("an uncertain short reply keeps its immediate antecedent without reviving every task", async () => {
    const select = createContextSelector({apiKey: "fixture-key", request: async () => Response.json({answers: {
        context: {type: "choice", choice: "chat", confidence: 0.1},
        ...Object.fromEntries(turns.map((_turn, i) => [`turn_${i}`, {type: "noul", noul: 0.1}])),
    }})});
    const result = await select("第一个就行", turns);
    assert.deepEqual(result.messageIds, ["m5"]);
    assert.equal(result.mode, "recent");
    assert.equal(result.reason, "uncertain_keep_latest");
});

test("an installation without Jev, or with the switch off, makes no network request", async () => {
    const request = async () => { throw new Error("must not call the network"); };
    for (const config of [{apiKey: ""}, {apiKey: "fixture-key", enabled: false}]) {
        const result = await createContextSelector({...config, request})("你好", turns);
        assert.equal(result.source, "disabled");
        assert.deepEqual(result.messageIds, ["m2", "m3", "m4", "m5"]);
    }
});

test("a long pasted message uses fallback instead of classifying only its truncated beginning", async () => {
    const select = createContextSelector({apiKey: "fixture-key", request: async () => { throw new Error("must not send truncated text"); }});
    const result = await select("日志内容".repeat(2100) + "继续之前的操作", turns);
    assert.equal(result.reason, "long_message");
    assert.deepEqual(result.messageIds, []);
});
