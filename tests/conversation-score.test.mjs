import assert from "node:assert/strict";
import {test} from "node:test";
import {scoreTurn, summarizeScores} from "./support/conversation-score.mjs";

test("回答碰巧正确不能掩盖首轮上下文丢失；后来检索到也单独记录", async () => {
    const score = await scoreTurn({reply: "回答 key 状态", context: [
        {label: "目标", contains: "KEY-731", role: "user", critical: true},
        {label: "业务结果", contains: "未认领", role: "tool", critical: true},
    ]}, {user: "查刚才的 key", reply: "KEY-731 未认领", timeline: [
        {type: "model_request", payload: {messages: [{role: "user", content: "查刚才的 key"}], tools: [{description: "KEY-731 未认领"}]}},
        {type: "model_request", payload: {messages: [{role: "user", content: "目标 KEY-731"}, {role: "tool", content: "未认领"}]}},
    ]}, async () => ({grade: 4, reason: "准确回答", evidence: ["KEY-731 未认领"]}));
    assert.equal(score.response.score, 100);
    assert.equal(score.context.score, 0);
    assert.equal(score.finalContext.score, 100);
    assert.deepEqual(score.critical, ["目标", "业务结果"]);
});

test("裁判伪造证据或超时不算通过，也不能只平均剩下的好样本", async () => {
    const input = {user: "你好", reply: "你好", timeline: [{type: "model_request", payload: {messages: [{role: "user", content: "你好"}]}}]};
    const rubric = {reply: "简短打招呼", context: [{label: "当前消息", contains: "你好"}]};
    const invalid = await scoreTurn(rubric, input, async () => ({grade: 4, reason: "很好", evidence: ["不存在的句子"]}));
    const timeout = await scoreTurn(rubric, input, async () => {throw new Error("timeout");});
    const valid = await scoreTurn(rubric, input, async () => ({grade: 3, reason: "已回应", evidence: ["你好"]}));
    const summary = summarizeScores([{round: 1, results: [{name: "问候", passed: true, timeline: [valid, invalid, timeout]}]}]);
    assert.equal(summary.reply, null);
    assert.equal(summary.context, 100);
    assert.equal(summary.judgeErrors, 2);
    assert.equal(summary.cases[0].reply.n, 0);
});

test("工具返回的 JSON 原文可以作为证据，不会被二次转义误判成伪造", async () => {
    const result = '{"title":"本周周报"}';
    const score = await scoreTurn({reply: "查询标题", context: [{label: "当前请求", contains: "用户当前消息：\n查标题"}]},
        {user: "查标题", reply: "标题是本周周报", timeline: [
            {type: "model_request", payload: {messages: [{role: "user", content: [{type: "text", text: "用户当前消息：\n查标题"}]}]}},
            {type: "tool_result", content: [{type: "text", text: result}]},
        ]}, async () => ({grade: 4, reason: "与实际工具结果一致", evidence: [result]}));
    assert.equal(score.response.score, 100);
    assert.equal(score.context.score, 100);
});
