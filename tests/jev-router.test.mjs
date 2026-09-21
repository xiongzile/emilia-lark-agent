import assert from "node:assert/strict";
import {test} from "node:test";
import {createTurnRouter, contextTurnIds} from "../dist/agent/conversation.js";

const answer = (mode, history, confidence = 1) => ({answers: {
    mode: {type: "choice", choice: mode, confidence}, history: {type: "choice", choice: history, confidence},
}});
const recent = [{messageId: "jev", user: "你知道 Jev 吗？", assistant: "在哪里看到的？"}];

test("完整问候和感谢免费走规则，带称呼或请求才调用 Jev，一次请求判断两个字段", async () => {
    const replies = [answer("greet", "new"), answer("task", "new")];
    let requests = 0;
    const router = createTurnRouter({apiKey: "fixture-key", request: async (url, options) => {
        assert.equal(url, "https://api.typesafe.ai/v1/systemone");
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body.questions), ["mode", "history"]);
        assert.equal(body.state.recentDialogue[0].user, "你知道 Jev 吗？");
        return Response.json(replies[requests++]);
    }});
    assert.deepEqual(contextTurnIds(await router("你好！", {}, recent), {}, recent), []);
    assert.deepEqual(contextTurnIds(await router("谢谢", {}, recent), {}, recent), ["jev"]);
    assert.equal(requests, 0);
    const greeting = await router("晚上好呀爱蜜莉雅", {}, recent);
    assert.equal(greeting.source, "jev");
    assert.deepEqual(contextTurnIds(greeting, {}, recent), []);
    const task = await router("你好，帮我查最新提交", {}, recent);
    assert.equal(task.mode, "task");
    assert.deepEqual(contextTurnIds(task, {}, recent), ["jev"]);
    assert.equal(requests, 2);
});

test("Jev 不确定、故障或响应异常时不清除当前追问，也不恢复问候前的旧任务", async t => {
    const failures = {
        lowConfidence: async () => Response.json(answer("greet", "new", 0.1)),
        uncertain: async () => Response.json(answer("uncertain", "uncertain")),
        inconsistent: async () => Response.json(answer("greet", "recall")),
        missingAnswer: async () => Response.json({answers: {mode: {type: "choice", choice: "greet", confidence: 1}}}),
        invalidConfidence: async () => Response.json(answer("greet", "new", 2)),
        rateLimit: async () => new Response("private details", {status: 429}),
        denied: async () => new Response("private details", {status: 401}),
        malformed: async () => new Response("not JSON"),
        network: async () => {throw new Error("private provider details");},
        timeout: async (_url, {signal}) => new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("test deadline")), 1000);
            signal.addEventListener("abort", () => {clearTimeout(timer); reject(signal.reason);}, {once: true});
        }),
    };
    const taskContext = {name: "创建 MR", messageIds: ["original-request"]};
    for (const [name, request] of Object.entries(failures)) await t.test(name, async () => {
        const fallback = await createTurnRouter({apiKey: "fixture-key", request, timeoutMs: 15})("上网搜搜看", {}, recent);
        assert.equal(fallback.source, "fallback");
        assert.deepEqual(contextTurnIds(fallback, {taskContext}, recent), ["jev", "original-request"]);
        assert.deepEqual(contextTurnIds(fallback, {taskContext, segmentStart: "hello"}, []), []);
        assert.doesNotMatch(JSON.stringify(fallback), /private details|private provider|fixture-key/);
    });
});

test("缺少密钥和超长消息不会发送请求或清空已有上下文", async () => {
    const request = async () => {throw new Error("must not call provider");};
    const missing = await createTurnRouter({apiKey: "", request})("去搜一下", {}, recent);
    const long = await createTurnRouter({apiKey: "fixture-key", request})("查".repeat(8001), {}, recent);
    assert.equal(missing.reason, "not_configured");
    assert.equal(long.reason, "long_message");
    assert.deepEqual(contextTurnIds(long, {}, recent), ["jev"]);
});

test("只发送当前段的线索，新话题用原话作名称，续聊不被短句覆盖", async () => {
    const requests = [];
    const router = createTurnRouter({apiKey: "fixture-key", request: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return Response.json(answer("chat", "current"));
    }});
    const state = {segmentStart: "hello", taskContext: {name: "删除文档 DOC-OLD", messageIds: ["old"]},
        currentTopic: {name: "Jev 的架构", messageIds: ["new"], segmentStart: "hello"}};
    const result = await router("然后呢", state, []);
    assert.doesNotMatch(JSON.stringify(requests), /DOC-OLD|删除文档/);
    assert.equal(result.topic, "Jev 的架构");
    const fresh = await router("来聊聊 C++ 内存模型", {segmentStart: "hello"}, []);
    assert.equal(fresh.topic, "来聊聊 C++ 内存模型");
});


test("chat 和 task 分不清时，仍保留明确的历史回顾请求", async () => {
    const data = answer("task", "recall");
    data.answers.mode.confidence = 0.44;
    data.answers.history.confidence = 0.52;
    const router = createTurnRouter({apiKey: "fixture-key", request: async () => Response.json(data)});
    const result = await router("刚才我们在处理哪个任务？", {segmentStart: "hello"}, []);
    assert.equal(result.mode, "chat");
    assert.equal(result.history, "recall");
    assert.equal(result.reason, "uncertain_mode");
    assert.deepEqual(contextTurnIds(result, {segmentStart: "hello"}, [{messageId: "hello"}], [{messageId: "old-task"}]), ["hello", "old-task"]);
});
