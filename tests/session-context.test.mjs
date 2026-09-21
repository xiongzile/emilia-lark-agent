import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";
import {createMemoryTool} from "../dist/memory/tool.js";

test("switching topics preserves paired tool evidence, while restart restores only archived wording", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-session-context-"));
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
        const distiller = {schedule() {}};
        const select = async (text) => ({mode: text === "晚上好" ? "chat" : "task", messageIds: text === "继续文档" ? ["work"] : [], source: "jev", elapsedMs: 1});
        let session = new AgentSession(agent, store, distiller, select);
        await session.run("work", "查文档");
        await session.run("chat", "晚上好");
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /DOC-731|查文档/);
        await session.run("resume", "继续文档");
        const resumed = requests.at(-1);
        assert.equal(resumed.filter(m => m.role === "toolResult").length, 1);
        assert.equal(resumed.find(m => m.role === "toolResult").toolCallId, "call-1");
        assert.equal(resumed.find(m => m.content?.[0]?.type === "toolCall").content[0].id, "call-1");
        assert.doesNotMatch(JSON.stringify(resumed), /晚上好/);
        assert.deepEqual(resumed[0].toolsAdded, [{name: "lookup"}]);

        store = await MemoryStore.open(directory);
        session = new AgentSession(agent, store, distiller, select);
        await session.run("after-restart", "继续文档");
        assert.equal(requests.at(-1).some(m => m.role === "toolResult"), false);
        assert.match(JSON.stringify(requests.at(-1)), /查文档/);
        assert.match(JSON.stringify(requests.at(-1)), /历史助手回复.*未核验/);
    } finally { await rm(directory, {recursive: true, force: true}); }
});

test("a failed generation and a selector exception cannot poison the next turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-session-recovery-"));
    try {
        const store = await MemoryStore.open(directory);
        await store.recordUser("before", "已经确认的对象 DOC-482");
        await store.recordAssistant("before", "收到");
        let attempt = 0;
        const agent = {
            state: {model: {api: "test", provider: "test", id: "test"}, messages: [{role: "system", content: "persona"}]},
            async prompt(message) {
                if (++attempt === 1) {
                    this.state.messages.push(message, {role: "assistant", content: [{type: "text", text: "BROKEN-PARTIAL"}]});
                    throw new Error("generation interrupted");
                }
                assert.doesNotMatch(JSON.stringify(this.state.messages), /BROKEN-PARTIAL/);
                const history = await createMemoryTool(store).execute("recover", {operation: "recent"});
                assert.match(JSON.stringify(history), /DOC-NEW-921/);
                assert.match(JSON.stringify(history), /结果未知/);
                assert.doesNotMatch(JSON.stringify(history), /BROKEN-PARTIAL/);
                this.state.messages.push(message, {role: "assistant", content: [{type: "text", text: "恢复完成"}]});
            },
        };
        const session = new AgentSession(agent, store, {schedule() {}}, async () => { throw new Error("selector unavailable"); });
        await assert.rejects(session.run("failed", "改查新文档 DOC-NEW-921"), /generation interrupted/);
        assert.equal(await session.run("retry", "再试一下"), "恢复完成");
        assert.equal(store.recentTurns().find(turn => turn.messageId === "failed").failed, true);
    } finally { await rm(directory, {recursive: true, force: true}); }
});
