import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {createModels} from "@earendil-works/pi-ai";
import {deepseekProvider} from "@earendil-works/pi-ai/providers/deepseek";
import {stream} from "../vendor/pi/packages/ai/src/api/openai-completions.ts";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";

// Inspect actual DeepSeek request serialization, stopping before network I/O.
test("连续十二轮、切换办事和讨论、更新记忆均保留前缀；问候仍隔离旧事", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-prefix-"));
    try {
        const models = createModels(); models.setProvider(deepseekProvider());
        const model = models.getModel("deepseek", "deepseek-flash");
        const store = await MemoryStore.open(directory);
        const payloads = [];
        const agent = {
            state: {model, messages: [{role: "system", content: "测试助手", timestamp: 0}]},
            async prompt(message) {
                this.state.messages.push(message);
                const response = await stream(model, {messages: this.state.messages}, {
                    apiKey: "offline-test",
                    onPayload(payload) {payloads.push(structuredClone(payload)); throw new Error("Captured before network");},
                    fetch() {assert.fail("offline test must never access network");},
                }).result();
                this.state.messages.push({...response, content: [{type: "text", text: "已记录 DOC-731。"}], stopReason: "stop", errorMessage: undefined});
            },
        };
        let route = {mode: "task", history: "current", source: "jev", topic: "周报", elapsedMs: 0};
        const session = new AgentSession(agent, store, {schedule() {}}, async () => route);
        for (let i = 0; i < 12; i++) {
            if (i === 8) route = {...route, mode: "chat"};
            if (i === 10) await store.apply([{operation: "upsert", category: "preference", text: "回答简洁", sourceMessageIds: ["turn-0"]}], 10);
            await session.run(`turn-${i}`, i ? `第 ${i} 个补充说明` : "查询 DOC-731");
            if (i) assert.deepEqual(payloads[i].messages.slice(0, payloads[i - 1].messages.length), payloads[i - 1].messages,
                `turn ${i}: previously sent messages must remain byte-for-byte identical`);
        }
        assert.match(JSON.stringify(payloads.at(-1)), /回答简洁/);
        assert.deepEqual(payloads.at(-1).messages[0], payloads[0].messages[0]);
        route = {...route, mode: "greet", history: "new"};
        await session.run("hello", "晚上好");
        assert.doesNotMatch(JSON.stringify(payloads.at(-1)), /DOC-731|补充说明/);
        assert.match(payloads.at(-1).messages[0].content, /只回应一句简短招呼/);
        route = {...route, mode: "chat", history: "current"};
        await session.run("chat", "聊聊今天吧");
        assert.deepEqual(payloads.at(-1).messages[0], payloads[0].messages[0], "greeting-only guidance must not constrain the following chat");
    } finally {await rm(directory, {recursive: true, force: true});}
});
