import assert from "node:assert/strict";
import {test} from "node:test";
import {createTurnRouter, uncertainTurn, contextTurnIds, advanceConversation} from "../dist/agent/conversation.js";

const recent = [{messageId: "jev", user: "你知道 Jev 吗？", assistant: "在哪里看到的？"}];
const modelReply = value => ({stopReason: "stop", content: [{type: "text", text: JSON.stringify(value)}]});
const route = (mode, history = "current", topic = "") => ({...uncertainTurn(), source: "model", mode, history, topic});

test("完整问候和感谢走不同路径，带称呼的问候和带请求的问候交给语义判断", async () => {
    const replies = [route("greet", "new"), route("task", "new", "查询提交")];
    let requests = 0;
    const router = createTurnRouter({completeSimple: async () => modelReply(replies[requests++])}, {});
    assert.deepEqual(contextTurnIds(await router("你好！", {}, recent), {}, recent), []);
    assert.deepEqual(contextTurnIds(await router("谢谢", {}, recent), {}, recent), ["jev"]);
    assert.equal(requests, 0);
    assert.deepEqual(contextTurnIds(await router("晚上好呀爱蜜莉雅", {}, recent), {}, recent), []);
    assert.deepEqual(contextTurnIds(await router("你好，帮我查最新提交", {}, recent), {}, recent), ["jev"]);
});

test("误判为普通聊天不能删掉当前对话中的追问对象", async () => {
    const router = createTurnRouter({completeSimple: async () => modelReply(route("chat", "new", "闲聊"))}, {});
    assert.deepEqual(contextTurnIds(await router("去网上搜搜看，是最近出的 AI", {}, recent), {}, recent), ["jev"]);
});

test("路由超时或格式异常时保留当前段，不能唤醒问候之前的记录", async t => {
    const taskContext = {name: "创建 MR", messageIds: ["original-request"]};
    const failures = {
        invalid: async () => modelReply({mode: "greet"}),
        contradictory: async () => modelReply(route("greet", "recall")),
        permission: async () => {throw new Error("private provider details");},
        timeout: async (_model, _context, {signal}) => new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("test deadline")), 1000);
            signal.addEventListener("abort", () => {clearTimeout(timer); reject(signal.reason);}, {once: true});
        }),
    };
    for (const [name, completeSimple] of Object.entries(failures)) await t.test(name, async () => {
        const fallback = await createTurnRouter({completeSimple}, {}, 15)("继续", {}, recent);
        assert.equal(fallback.source, "fallback");
        assert.deepEqual(contextTurnIds(fallback, {taskContext}, recent), ["jev", "original-request"]);
        assert.deepEqual(contextTurnIds(fallback, {taskContext, segmentStart: "hello"}, []), []);
        assert.doesNotMatch(JSON.stringify(fallback), /private provider details/);
    });
});

test("问候归档旧话题和任务，明确恢复后才能在当前段延续旧出处", () => {
    let state = advanceConversation({}, route("task", "new", "创建 MR"), "mr-request");
    state = advanceConversation(state, route("chat", "new", "Jev 架构"), "jev");
    state = advanceConversation(state, route("greet", "new"), "hello");
    assert.deepEqual(state.taskContext.messageIds, ["mr-request"]);
    assert.deepEqual(contextTurnIds(route("chat"), state, []), []);
    assert.deepEqual(contextTurnIds(route("task"), state, []), []);
    assert.deepEqual(contextTurnIds(route("task", "recall"), state, []), ["jev", "mr-request"]);
    state = advanceConversation(state, route("task", "recall", "创建 MR"), "resume");
    assert.deepEqual(contextTurnIds(route("task"), state, []), ["mr-request", "resume"]);
    state = advanceConversation(state, route("chat", "new", "猫还是电影"), "choices");
    assert.deepEqual(contextTurnIds(route("chat"), state, []), ["choices"]);
});


test("问候后的分类器也看不到已归档的任务线索，避免把普通应答认成旧任务授权", async () => {
    const router = createTurnRouter({completeSimple: async (_model, context) => {
        assert.doesNotMatch(JSON.stringify(context.messages), /删除共享文档|DOC-OLD/);
        return modelReply(route("chat"));
    }}, {});
    await router("好", {segmentStart: "hello", taskContext: {name: "删除共享文档 DOC-OLD", messageIds: ["old"]}},
        [{messageId: "hello", user: "晚上好", assistant: "晚上好呀"}]);
});
