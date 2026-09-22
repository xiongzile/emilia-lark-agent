import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {stream} from "../vendor/pi/packages/ai/src/api/openai-completions.ts";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";
import {scriptedAgent} from "./support/scripted-agent.mjs";
import {emiliaSystemPrompt} from "../dist/prompts/emilia.js";

test("连续会话及记忆更新保留实际请求前缀；闲聊视图结束后恢复原工作前缀", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-prefix-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        const payloads = [];
        const {agent} = scriptedAgent(async context => {
            await stream(agent.state.model, context, {apiKey: "offline-test",
                onPayload(payload) {payloads.push(structuredClone(payload)); throw new Error("Captured before network");},
                fetch() {assert.fail("offline test must not access network");},
            }).result();
            return "收到。";
        });
        let mode = "task", branch = "current";
        const session = new AgentSession(agent, store, {schedule() {}}, async () => ({mode, branch, source: "jev", elapsedMs: 0}));
        for (let i = 0; i < 12; i++) {
            if (i === 10) await store.apply([{operation: "upsert", category: "preference", text: "回答简洁", sourceMessageIds: ["turn-0"]}], 10);
            await session.run(`turn-${i}`, i ? `第 ${i} 个补充说明` : "查询 DOC-731");
            if (i) assert.deepEqual(payloads[i].messages.slice(0, payloads[i - 1].messages.length), payloads[i - 1].messages);
        }
        const work = payloads.at(-1);
        mode = "greet"; await session.run("hello", "晚上好");
        assert.doesNotMatch(JSON.stringify(payloads.at(-1)), /DOC-731|补充说明/);
        mode = "chat"; await session.run("chat", "今天过得怎么样");
        assert.doesNotMatch(JSON.stringify(payloads.at(-1)), /DOC-731|补充说明/);
        mode = "task"; branch = "t1"; await session.run("resume", "接着刚才的工作");
        assert.deepEqual(payloads.at(-1).messages.slice(0, work.messages.length), work.messages);
        for (const payload of payloads) assert.ok(payload.messages.some(message =>
            message.role === "system" && message.content.includes(emiliaSystemPrompt)),
        "Mode changes and restart must preserve the actual persona/authorization instructions");
        await store.history.close(); store = await MemoryStore.open(directory);
        await new AgentSession(agent, store, {schedule() {}}).run("restart", "再查一下");
        assert.deepEqual(payloads.at(-1).messages.slice(0, work.messages.length), work.messages);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
