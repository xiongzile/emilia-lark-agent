import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {budgetFetch, budgetStatus, createBudget} from "./support/eval-budget.mjs";

const model = {id: "test", provider: "openrouter", cost: {input: 1, output: 2}};
const input = {method: "POST", body: JSON.stringify({model: "test", max_tokens: 100, messages: [{role: "user", content: "你好"}]})};
async function ledger(t, limit) {
    const dir = await mkdtemp(join(tmpdir(), "eval-budget-"));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const path = join(dir, "budget.jsonl"); createBudget(path, limit); return path;
}

test("慢请求先占预算；另一会话不能在它结算前花掉同一份钱", async t => {
    const path = await ledger(t, 0.012);
    let release, calls = 0;
    const request = budgetFetch(path, model, async () => {calls++; return new Promise(resolve => {release = resolve;});});
    const first = request("https://openrouter.ai/api/v1/chat/completions", input);
    await assert.rejects(request("https://openrouter.ai/api/v1/chat/completions", input), /budget exhausted/);
    assert.equal(calls, 1);
    release(Response.json({usage: {cost: 0.001}})); await first;
    assert.equal(budgetStatus(path).accounted, 0.001);
    assert.equal(budgetStatus(path).unsettled, 0);
});

test("断流没有账单仍占预算，重建客户端也不能把未知费用当成零", async t => {
    const path = await ledger(t, 0.012);
    const request = budgetFetch(path, model, async () => {throw new Error("connection lost");});
    await assert.rejects(request("https://openrouter.ai/api/v1/chat/completions", input), /connection lost/);
    let sent = false;
    const restarted = budgetFetch(path, model, async () => {sent = true;});
    await assert.rejects(restarted("https://openrouter.ai/api/v1/chat/completions", input), /budget exhausted/);
    assert.equal(sent, false);
    assert.equal(budgetStatus(path).unsettled, 1);
});

test("流式账单跨 chunk 到达仍按真实费用结算，文本原样交给 Pi", async t => {
    const path = await ledger(t, 1);
    const text = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"usage":{"cost":0.003}}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    const request = budgetFetch(path, model, async () => new Response(new ReadableStream({start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close();
    }}), {headers: {"content-type": "text/event-stream"}}));
    assert.equal(await (await request("https://openrouter.ai/api/v1/chat/completions", input)).text(), text);
    assert.equal(budgetStatus(path).actual, 0.003);
});

test("未限制输出或错误服务地址在联网前就拒绝", async t => {
    const path = await ledger(t, 1);
    let sent = false;
    const request = budgetFetch(path, model, async () => {sent = true;});
    await assert.rejects(request("https://openrouter.ai/api/v1/chat/completions", {method: "POST", body: "{}"}), /output cap/);
    await assert.rejects(request("https://example.invalid/chat", input), /unexpected host/);
    assert.equal(sent, false);
    assert.equal(budgetStatus(path).requests.length, 0);
});
