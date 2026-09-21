import assert from "node:assert/strict";
import {test} from "node:test";
import {createTurnRouter, uncertainTurn, contextTurnIds, advanceConversation} from "../dist/agent/conversation.js";

const recent = [{messageId: "jev", user: "你知道 Jev 吗？", assistant: "在哪里看到的？"}];
const modelReply = value => ({stopReason: "stop", content: [{type: "text", text: JSON.stringify(value)}]});

test("纯问候可以省略背景，感谢保留背景，问候加请求必须进入模型判断", async () => {
    let requests = 0;
    const router = createTurnRouter({completeSimple: async () => {
        requests++;
        return modelReply({intent: "NEW_TOPIC", topic: "查询提交", task: "start"});
    }}, {});
    const greeting = await router("你好！", {}, recent);
    assert.deepEqual(contextTurnIds(greeting, {}, recent), []);
    const thanks = await router("谢谢", {}, recent);
    assert.deepEqual(contextTurnIds(thanks, {}, recent), ["jev"]);
    assert.equal(requests, 0);
    const request = await router("你好，帮我查最新提交", {}, recent);
    assert.equal(requests, 1);
    assert.deepEqual(contextTurnIds(request, {}, recent), ["jev"]);
});

test("模型错误判断为闲聊，也不能删掉紧邻追问的对象", async () => {
    const router = createTurnRouter({completeSimple: async () => modelReply({
        intent: "SOCIAL", topic: "闲聊", task: "none", standaloneSocial: true,
    })}, {});
    const route = await router("去网上搜搜看，是最近出的 AI", {}, recent);
    assert.equal(route.standaloneSocial, false);
    assert.deepEqual(contextTurnIds(route, {}, recent), ["jev"]);
});

test("路由超时或格式异常时仍保留近期记录与任务出处", async t => {
    const state = {taskContext: {name: "创建 MR", messageIds: ["original-request"]}};
    const failures = {
        invalid: async () => modelReply({intent: "SOCIAL"}),
        permission: async () => {throw new Error("private provider details");},
        timeout: async (_model, _context, {signal}) => new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("test deadline")), 1000);
            signal.addEventListener("abort", () => {clearTimeout(timer); reject(signal.reason);}, {once: true});
        }),
    };
    for (const [name, completeSimple] of Object.entries(failures)) await t.test(name, async () => {
        const route = await createTurnRouter({completeSimple}, {}, 15)("继续", state, recent);
        assert.equal(route.source, "fallback");
        assert.deepEqual(contextTurnIds(route, state, recent), ["jev", "original-request"]);
        assert.doesNotMatch(JSON.stringify(route), /private provider details/);
    });
});

test("社交和新话题不抹掉任务，短指代选择当前话题，明确恢复任务才补旧出处", () => {
    const route = (intent, topic, task = "none") => ({...uncertainTurn(), source: "model", intent, topic, task});
    let state = advanceConversation({}, route("NEW_TOPIC", "创建 MR", "start"), "mr-request");
    state = advanceConversation(state, route("SOCIAL", "问候"), "hello");
    assert.deepEqual(state.taskContext.messageIds, ["mr-request"]);
    state = advanceConversation(state, route("NEW_TOPIC", "猫还是电影"), "choices");
    const shortReply = route("FOLLOW_UP", "猫咪");
    assert.deepEqual(contextTurnIds(shortReply, state, []), ["choices"]);
    const resume = route("FOLLOW_UP", "创建 MR", "continue");
    assert.ok(contextTurnIds(resume, state, []).includes("mr-request"));
});
