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
            ? {...uncertainTurn(), source: "rule", intent: "SOCIAL", standaloneSocial: true}
            : {...uncertainTurn(), source: "model", intent: "FOLLOW_UP", topic: "文档", task: text === "查文档" ? "start" : "continue"};
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
