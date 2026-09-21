import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";
import {uncertainTurn} from "../dist/agent/conversation.js";

// Session orchestration: preserve actual tool evidence, not an invented summary.
test("暂停、窗口过期和重启不丢任务来源，存活会话保留完整工具结果", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-session-"));
    try {
        let store = await MemoryStore.open(directory);
        const requests = [];
        const agent = {
            state: {model: {api: "test", provider: "test", id: "test"}, messages: [{role: "system", content: "persona", toolsAdded: [{name: "lookup"}]}]},
            async prompt(message) {
                requests.push(structuredClone(this.state.messages));
                this.state.messages.push(message);
                if (message.content.at(-1).text.includes("查文档")) this.state.messages.push(
                    {role: "assistant", content: [{type: "toolCall", id: "call-1", name: "lookup", arguments: {}}]},
                    {role: "toolResult", toolCallId: "call-1", toolName: "lookup", content: [{type: "text", text: "DOC-731"}]},
                );
                this.state.messages.push({role: "assistant", content: [{type: "text", text: "答复"}]});
            },
        };
        const router = async text => text === "你好"
            ? {...uncertainTurn(), source: "rule", mode: "greet", history: "new"}
            : {...uncertainTurn(), source: "jev", mode: "task", topic: "文档", history: text === "查文档" ? "new" : "recall"};
        let session = new AgentSession(agent, store, {schedule() {}}, router);
        await session.run("work", "查文档");
        await session.run("hello", "你好");
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /DOC-731|查文档/);
        for (let i = 0; i < 8; i++) {await store.recordUser(`chat-${i}`, "闲聊"); await store.recordAssistant(`chat-${i}`, "好呀");}
        await session.run("resume", "继续文档");
        assert.equal(requests.at(-1).filter(m => m.role === "toolResult").length, 1);
        assert.equal(requests.at(-1).find(m => m.role === "toolResult").toolCallId, "call-1");
        assert.deepEqual(requests.at(-1)[0].toolsAdded, [{name: "lookup"}]);
        const beforeRestart = store.conversation();
        store = await MemoryStore.open(directory);
        assert.deepEqual(store.conversation(), beforeRestart);
        session = new AgentSession(agent, store, {schedule() {}}, router);
        await session.run("restart", "继续文档");
        assert.match(JSON.stringify(requests.at(-1)), /查文档/);
        assert.match(JSON.stringify(requests.at(-1)), /历史助手回复.*未核验/);
        assert.equal(requests.at(-1).some(m => m.role === "toolResult"), false);
    } finally {await rm(directory, {recursive: true, force: true});}
});

test("生成中断和路由故障后再试，保留新对象而不复用半截回复", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-recovery-"));
    try {
        const store = await MemoryStore.open(directory);
        await store.recordUser("before", "旧对象 DOC-OLD-482");
        await store.recordAssistant("before", "收到");
        let attempt = 0;
        const agent = {
            state: {model: {api: "test", provider: "test", id: "test"}, messages: [{role: "system", content: "persona"}]},
            async prompt(message) {
                if (++attempt === 1) {
                    this.state.messages.push(message, {role: "assistant", content: [{type: "text", text: "BROKEN-PARTIAL"}]});
                    throw new Error("generation interrupted");
                }
                assert.match(JSON.stringify(this.state.messages), /DOC-NEW-921/);
                assert.match(JSON.stringify(this.state.messages), /结果未知/);
                assert.doesNotMatch(JSON.stringify(this.state.messages), /BROKEN-PARTIAL/);
                this.state.messages.push(message, {role: "assistant", content: [{type: "text", text: "恢复完成"}]});
            },
        };
        const session = new AgentSession(agent, store, {schedule() {}}, async () => {throw new Error("router unavailable");});
        await assert.rejects(session.run("failed", "改查新文档 DOC-NEW-921"), /generation interrupted/);
        assert.equal(await session.run("retry", "再试一下"), "恢复完成");
        assert.ok(store.recentTurns().find(t => t.messageId === "failed").failed);
    } finally {await rm(directory, {recursive: true, force: true});}
});

// The reset is durable and also applies to memory injection, not just one greeting.
test("带称呼的问候建立持久边界，重启和路由故障都不会把旧事带回闲聊", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-greeting-"));
    try {
        let store = await MemoryStore.open(directory);
        await store.recordUser("old", "昨天讨论 Jev，并取消 DEMO-482 的 35 条认领。");
        await store.recordAssistant("old", "处理完成。");
        await store.apply([{operation: "upsert", category: "project", text: "Jev 项目 DEMO-482", sourceMessageIds: ["old"]}], 1);
        assert.match(store.context(), /Jev 项目 DEMO-482/);
        const requests = [];
        const agent = {
            state: {model: {api: "test", provider: "test", id: "test"}, messages: [{role: "system", content: "persona"}]},
            async prompt(message) {
                requests.push(structuredClone(this.state.messages));
                this.state.messages.push(message, {role: "assistant", content: [{type: "text", text: "好呀"}]});
            },
        };
        let session = new AgentSession(agent, store, {schedule() {}}, async () => ({
            ...uncertainTurn(), source: "jev", mode: "greet", history: "new",
        }));
        await session.run("hello", "晚上好呀爱蜜莉雅");
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /Jev|DEMO-482|35/);
        store = await MemoryStore.open(directory);
        assert.equal(store.conversation().segmentStart, "hello");
        session = new AgentSession(agent, store, {schedule() {}}, async () => {throw new Error("router unavailable");});
        await session.run("day", "今天过得怎么样");
        assert.match(JSON.stringify(requests.at(-1)), /晚上好呀爱蜜莉雅/);
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /Jev|DEMO-482|35/);
        assert.equal(store.turnsById(["old"]).length, 1);
        session = new AgentSession(agent, store, {schedule() {}}, async () => ({
            ...uncertainTurn(), source: "jev", mode: "chat", history: "recall", topic: "Jev",
        }));
        await session.run("recall", "昨天那个 Jev，我们说到哪了？");
        assert.match(JSON.stringify(requests.at(-1)), /Jev/);
    } finally {await rm(directory, {recursive: true, force: true});}
});
