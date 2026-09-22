import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {test} from "node:test";
import {MemoryStore} from "../dist/memory/store.js";
import {AgentSession} from "../dist/agent/session.js";
import {createContextTreeTool} from "../dist/agent/tree-tools.js";
import {scriptedAgent} from "./support/scripted-agent.mjs";

test("旧 JSON 一次迁入 Pi，保留原始 ID、时区和记忆来源，不伪造工具证据", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-import-"));
    let store;
    try {
        const legacy = {version: 1, turns: [{messageId: "original", at: "2026-09-20T08:00:00Z", user: "记住项目 DEMO-731", assistant: "已完成发布"}]};
        await writeFile(join(directory, "transcript.json"), JSON.stringify(legacy));
        store = await MemoryStore.open(directory);
        await store.apply([{operation: "upsert", category: "project", text: "项目 DEMO-731", sourceMessageIds: ["original"]}], 1);
        await store.history.close();
        // Once imported, the old file is not a second source of truth.
        await writeFile(join(directory, "transcript.json"), "obsolete");
        store = await MemoryStore.open(directory);
        assert.equal(store.status().turns, 1);
        assert.equal(store.status().pending, 0);
        assert.deepEqual(store.list()[0].sourceMessageIds, ["original"]);
        assert.deepEqual(store.history.observations("original"), []);
        assert.deepEqual(JSON.parse(await readFile(join(directory, "transcript.legacy.json"), "utf8")), legacy);
        assert.equal(store.history.turns[0].at, legacy.turns[0].at);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("近期原话按时间翻页；长内容可完整展开，助手陈述始终带来源", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-history-read-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        for (let i = 0; i < 23; i++) {
            await store.recordUser(`t${i}`, i === 12 ? "这是原话🦄".repeat(4000) : `讨论 ${i}`);
            await store.recordAssistant(`t${i}`, `助手当时说 ${i}`);
        }
        const tool = createContextTreeTool(store);
        const call = async args => JSON.parse((await tool.execute("test", args)).content[0].text);
        const newest = await call({operation: "recent"});
        assert.deepEqual(newest.turns.map(t => t.id), Array.from({length: 10}, (_, i) => `t${i + 13}`));
        const older = await call({operation: "recent", before: newest.nextBefore});
        assert.equal(older.turns.at(-1).id, "t12");
        let text = "", offset = 0;
        do {const page = await call({operation: "read", id: "t12", offset}); text += page.text; offset = page.nextOffset;} while (offset !== null);
        assert.equal(JSON.parse(text).user, store.history.turns[12].user);
        assert.equal(JSON.parse(text).assistant.source, "historical_assistant_statement");
        await assert.rejects(call({operation: "read", id: "invented"}), /not found/);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("压缩检查点跨重启保留连续上下文，压缩前原话仍能直接读取", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-checkpoint-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        const {agent} = scriptedAgent(() => "等待下一步");
        const session = new AgentSession(agent, store, {schedule() {}}, undefined, async messages => messages.length > 3
            ? [messages[0], {role: "user", content: "<conversation_summary>对象已经纠正为 DOC-NEW，尚未修改</conversation_summary>", timestamp: 1}, messages.at(-1)] : messages);
        await session.run("first", "原对象 DOC-OLD");
        await session.run("correction", "纠正：对象是 DOC-NEW，先别执行");
        await store.history.close(); store = await MemoryStore.open(directory);
        const restarted = scriptedAgent();
        await new AgentSession(restarted.agent, store, {schedule() {}}).run("next", "继续聊这个对象");
        const payload = JSON.stringify(restarted.requests[0]);
        assert.match(payload, /conversation_summary/);
        assert.match(payload, /DOC-NEW/);
        assert.doesNotMatch(payload, /DOC-OLD/);
        assert.equal(restarted.requests[0].messages.filter(m => JSON.stringify(m).includes("用户当前消息：\\n继续聊这个对象")).length, 1);
        const record = await createContextTreeTool(store).execute("read", {operation: "read", id: "first"});
        assert.match(JSON.stringify(record), /DOC-OLD/);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
