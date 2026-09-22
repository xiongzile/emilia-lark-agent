import assert from "node:assert/strict";
import {test} from "node:test";
import {createContextCompactor} from "../dist/agent/context.js";

const user = content => ({role: "user", content, timestamp: 1});
const assistant = content => ({role: "assistant", content: [{type: "text", text: content}]});
const old = [user("查询 DOC-OLD"), assistant("a".repeat(16000))];
const recent = [user("改成 DOC-NEW，只读取，不批准"),
    {role: "assistant", content: [{type: "toolCall", id: "lookup-1", name: "lookup", arguments: {id: "DOC-NEW"}}]},
    {role: "toolResult", toolCallId: "lookup-1", toolName: "lookup", content: [{type: "text", text: "DOC-NEW: ready"}]},
    assistant("已读取，还未批准"), user("它现在什么状态？")];
const messages = [{role: "system", content: "persona", toolsAdded: [{name: "lookup"}]}, ...old, ...recent];

test("达到预算才压缩，保留 system、最新纠正和完整工具调用对", async () => {
    let calls = 0;
    const compact = createContextCompactor(async input => {
        calls++;
        assert.equal(input, messages, "summary request can reuse the full original prefix");
        return "对象改成 DOC-NEW。只读已完成，未授权批准。";
    }, {maxTokens: 2000, keepTokens: 500});
    const short = [messages[0], user("你好")];
    assert.equal(await compact(short), short);
    assert.equal(calls, 0);
    const result = await compact(messages);
    assert.equal(calls, 1);
    assert.equal(result[0], messages[0]);
    assert.deepEqual(result.slice(2), recent);
    assert.match(result[1].content, /DOC-NEW.*未授权批准/);
    assert.doesNotMatch(JSON.stringify(result), /a{100}/);
    assert.equal(await compact(result), result, "a compacted short context must not keep generating summaries");
});

test("摘要失败或为空时保留原记录，不把失败压缩当成遗忘依据", async () => {
    for (const summarize of [async () => {throw new Error("timeout");}, async () => ""]) {
        const compact = createContextCompactor(summarize, {maxTokens: 2000, keepTokens: 500});
        assert.equal(await compact(messages), messages);
    }
});

test("单个尚未结束的任务不从中间切断工具结果", async () => {
    const current = [messages[0], user("读取大结果"),
        {role: "assistant", content: [{type: "toolCall", id: "read-1", name: "read", arguments: {}}]},
        {role: "toolResult", toolCallId: "read-1", content: [{type: "text", text: "x".repeat(16000)}]}];
    const compact = createContextCompactor(async () => assert.fail("do not summarize away the active turn"), {maxTokens: 2000, keepTokens: 500});
    assert.equal(await compact(current), current);
    const withSummary = [current[0], user("<conversation_summary>之前的旧事已压缩</conversation_summary>"), ...current.slice(1)];
    assert.equal(await compact(withSummary), withSummary, "do not repeatedly summarize the same summary during a large active turn");
});
