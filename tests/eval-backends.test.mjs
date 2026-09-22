import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {evaluationBackend} from "./support/eval-backend.mjs";
import {createBudget, budgetStatus} from "./support/eval-budget.mjs";
import {scoreContext} from "./support/conversation-score.mjs";

test("四种真实 Pi 序列化入口共用限额，Anthropic 与 Chat Completions 都保留费用", async t => {
    const dir = await mkdtemp(join(tmpdir(), "eval-backends-"));
    const path = join(dir, "budget.jsonl"); createBudget(path, 1);
    const env = {...process.env}, originalFetch = globalThis.fetch;
    t.after(async () => {process.env = env; globalThis.fetch = originalFetch; await rm(dir, {recursive: true, force: true});});
    Object.assign(process.env, {AGENT_EVAL_BUDGET_FILE: path, OPENROUTER_API_KEY: "offline", DEEPSEEK_API_KEY: "offline"});
    const payloads = [];
    globalThis.fetch = async (url, init) => {
        const address = typeof url === "string" ? url : url.url;
        const payload = JSON.parse(init.body); payloads.push(payload);
        assert.ok((payload.max_tokens ?? payload.max_completion_tokens) <= 2048);
        if (address.includes("openrouter")) assert.equal(payload.provider.allow_fallbacks, false);
        const events = new URL(address).pathname.endsWith("/messages") ? [
            {type: "message_start", message: {id: "offline", type: "message", role: "assistant", model: payload.model,
                content: [], usage: {input_tokens: 10, output_tokens: 0}}},
            {type: "content_block_start", index: 0, content_block: {type: "text", text: ""}},
            {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "OK"}},
            {type: "content_block_stop", index: 0},
            {type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 2, cost: 0.001}},
            {type: "message_stop"},
        ] : [
            {id: "offline", choices: [{index: 0, delta: {role: "assistant", content: "OK"}, finish_reason: null}]},
            {id: "offline", choices: [{index: 0, delta: {}, finish_reason: "stop"}], usage: {prompt_tokens: 10, completion_tokens: 2, cost: 0.001}},
        ];
        return new Response(events.map(e => `${e.type ? `event: ${e.type}\n` : ""}data: ${JSON.stringify(e)}\n\n`).join(""),
            {headers: {"content-type": "text/event-stream"}});
    };
    for (const [provider, modelId] of [["deepseek", "deepseek-flash"], ["openrouter", "anthropic/claude-sonnet-5"],
        ["openrouter", "openai/gpt-5.4"], ["openrouter", "google/gemini-3.8-flash"]]) {
        Object.assign(process.env, {AGENT_EVAL_PROVIDER: provider, AGENT_EVAL_MODEL: modelId});
        const {model, models} = evaluationBackend();
        const result = await models.completeSimple(model, {systemPrompt: "Say OK", messages: [{role: "user", content: "你好", timestamp: 0}]});
        assert.equal(result.stopReason, "stop", result.errorMessage);
        assert.equal(result.content.find(p => p.type === "text")?.text, "OK");
    }
    assert.equal(payloads.length, 4);
    assert.equal(budgetStatus(path).requests.length, 4);
    assert.equal(budgetStatus(path).unsettled, 0);
    assert.equal(budgetStatus(path).actual, 0.003);
});

test("同一工具证据不会因 Anthropic 用 user/tool_result 就被误判为丢上下文", () => {
    const criteria = [{label: "查询证据", role: "tool", contains: ["DOC-731", "title"]}];
    const content = '{"id":"DOC-731","title":"周报"}';
    assert.equal(scoreContext(criteria, {messages: [{role: "tool", content}]}).score, 100);
    assert.equal(scoreContext(criteria, {messages: [{role: "user", content: [{type: "tool_result", tool_use_id: "a", content: [{type: "text", text: content}]}]}]}).score, 100);
    assert.equal(scoreContext([{...criteria[0], role: "user"}], {messages: [{role: "user", content: [{type: "tool_result", content}]}]}).score, 0);
});
