import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {Type} from "@earendil-works/pi-ai";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";
import {createContextTreeTool} from "../dist/agent/tree-tools.js";
import {scriptedAgent} from "./support/scripted-agent.mjs";

const hint = mode => ({mode, source: "jev", elapsedMs: 0});
test("查询证据经历问候、记忆指令和重启后仍可读取，恢复不重复工具操作", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-session-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        let lookups = 0;
        const lookup = {name: "lookup", label: "lookup", description: "Query a document", parameters: Type.Object({}),
            async execute() {lookups++; return {content: [{type: "text", text: "DOC-731 revision=17"}]};}};
        const {agent, requests} = scriptedAgent((_ctx, i) => i === 1
            ? {content: [{type: "toolCall", id: "call-1", name: "lookup", arguments: {}}]} : "答复", [lookup]);
        let selected = hint("task");
        let session = new AgentSession(agent, store, {schedule() {}}, async () => selected);
        await session.run("work", "查文档");
        await session.run("memory-status", "/memory status");
        assert.equal(requests.length, 2);
        selected = hint("greet");
        await session.run("hello", "下午好");
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /DOC-731|revision=17/);
        const read = await createContextTreeTool(store).execute("read", {operation: "read", id: "work"});
        assert.match(JSON.stringify(read), /revision=17/);
        await store.history.close(); store = await MemoryStore.open(directory);
        session = new AgentSession(agent, store, {schedule() {}}, async () => {throw new Error("router outage");});
        await session.run("follow", "接着刚才的文档");
        assert.match(JSON.stringify(requests.at(-1)), /DOC-731 revision=17/);
        assert.equal(requests.at(-1).messages.filter(m => m.role === "toolResult").length, 1);
        assert.equal(lookups, 1);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("工具执行后模型中断，重启保留实际结果而不恢复半截答复", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-interrupted-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        let mutations = 0;
        const tool = {name: "rename", label: "rename", description: "Rename", parameters: Type.Object({}),
            async execute() {mutations++; return {content: [{type: "text", text: "DOC-NEW renamed revision=18"}]};}};
        const {agent} = scriptedAgent((_ctx, i) => i === 1 ? {content: [{type: "toolCall", id: "rename-1", name: "rename", arguments: {}}]}
            : {stopReason: "error", errorMessage: "interrupted", content: [{type: "text", text: "BROKEN-PARTIAL"}]}, [tool]);
        await assert.rejects(new AgentSession(agent, store, {schedule() {}}).run("failed", "重命名 DOC-NEW"));
        await store.history.close(); store = await MemoryStore.open(directory);
        const restored = scriptedAgent();
        await new AgentSession(restored.agent, store, {schedule() {}}).run("retry", "看看刚才做到哪了");
        const request = JSON.stringify(restored.requests[0]);
        assert.match(request, /DOC-NEW renamed revision=18/);
        assert.doesNotMatch(request, /BROKEN-PARTIAL/);
        assert.equal(mutations, 1);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("进程未记录最终回复就退出，重启标记未完成但不重做已记录的操作", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-process-exit-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        let writes = 0;
        const tool = {name: "write", label: "write", description: "Write once", parameters: Type.Object({}),
            async execute() {writes++; return {content: [{type: "text", text: "DOC-731 revision=42"}]};}};
        const first = scriptedAgent((_ctx, i) => i === 1
            ? {content: [{type: "toolCall", id: "write-1", name: "write", arguments: {}}]} : "写好了", [tool]);
        await store.recordUser("interrupted", "写 DOC-731");
        const unsubscribe = first.agent.subscribe(event => {
            if (event.type === "message_end") void store.history.appendMessage(event.message);
        });
        await first.agent.prompt("写 DOC-731");
        unsubscribe();
        // No recordAssistant: the process disappeared before committing its final reply.
        await store.history.close(); store = await MemoryStore.open(directory);
        assert.equal(store.history.turns[0].failed, true);
        const restarted = scriptedAgent();
        await new AgentSession(restarted.agent, store, {schedule() {}}).run("after", "刚才做到哪里？");
        const context = JSON.stringify(restarted.requests[0]);
        assert.match(context, /DOC-731 revision=42/);
        assert.match(context, /上一轮中断/);
        assert.equal(writes, 1);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
