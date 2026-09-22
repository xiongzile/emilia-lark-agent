import assert from "node:assert/strict";
import {test} from "node:test";
import {createTreeRouter} from "../dist/agent/tree-router.js";

const answer = (choice, confidence = 1) => ({answers: {mode: {type: "choice", choice, confidence}, branch: {type: "choice", choice: "current", confidence}}});
test("树路由读取最近十轮原话，区分回应方式与话题归属", async () => {
    let body;
    const router = createTreeRouter({apiKey: "fixture", request: async (_url, options) => {
        body = JSON.parse(options.body); return Response.json(answer("task"));
    }});
    const turns = Array.from({length: 12}, (_, i) => ({messageId: `t${i}`, user: `问题 ${i}`, assistant: `答复 ${i}`}));
    turns[2].user = "背景".repeat(700) + "DOC-731";
    const route = await router("接着刚才那个", {active: "t1"}, turns);
    assert.deepEqual(Object.keys(body.questions), ["mode", "branch"]);
    assert.equal(body.state.recentDialogue.length, 10);
    assert.equal(body.state.recentDialogue[0].user, turns[2].user);
    assert.equal(route.mode, "task");
    assert.equal("history" in route, false);
    const low = await createTreeRouter({apiKey: "fixture", request: async () => Response.json(answer("chat", 0.2))})("第一个", {}, turns);
    assert.equal(low.mode, "chat");
    assert.equal(low.source, "jev");
});
test("模式服务故障和不确定只降级提示，不抛异常或暴露凭据", async t => {
    const failures = {
        uncertain: async () => Response.json(answer("uncertain")),
        missing: async () => Response.json({}),
        invalid: async () => Response.json(answer("greet", 2)),
        denied: async () => new Response("private provider details", {status: 401}),
        rateLimit: async () => new Response("private provider details", {status: 429}),
        malformed: async () => new Response("not JSON"),
        network: async () => {throw new Error("private provider details");},
        timeout: async (_url, {signal}) => new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("test deadline")), 1000);
            signal.addEventListener("abort", () => {clearTimeout(timer); reject(signal.reason);}, {once: true});
        }),
    };
    for (const [name, request] of Object.entries(failures)) await t.test(name, async () => {
        const route = await createTreeRouter({apiKey: "fixture-key", request, timeoutMs: 15})("继续", {}, []);
        assert.equal(route.source, "fallback");
        assert.equal(route.branch, "current");
        assert.doesNotMatch(JSON.stringify(route), /private provider|fixture-key/);
    });
    const request = () => assert.fail("must not send");
    assert.equal((await createTreeRouter({apiKey: "", request})("查询", {}, [])).reason, "not_configured");
    assert.equal((await createTreeRouter({apiKey: "fixture", request})("字".repeat(8001), {}, [])).reason, "long_message");
});
