import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {test} from "node:test";
import {Type} from "@earendil-works/pi-ai";
import {BACKGROUND_CONTEXT} from "@earendil-works/pi-agent-core";
import {MemoryStore} from "../dist/memory/store.js";
import {AgentSession} from "../dist/agent/session.js";
import {createContextTreeTool} from "../dist/agent/tree-tools.js";
import {scriptedAgent} from "./support/scripted-agent.mjs";

test("查看树、纠正整轮归属、重启撤销：原话和工具证据都保留，操作不重做", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-tree-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        let operations = 0;
        const lookup = {name: "lookup", description: "lookup", label: "lookup", parameters: Type.Object({}),
            async execute() {operations++; return {content: [{type: "text", text: "KEY-731 claim_count=0"}]};}};
        const {agent} = scriptedAgent((_context, n) => n === 1
            ? {content: [{type: "toolCall", id: "read-1", name: "lookup", arguments: {}}]} : "查好了", [lookup]);
        const session = new AgentSession(agent, store, {schedule() {}});
        await session.run("key", "检查这个 key 的状态");
        assert.match(await session.run("inspect", "/tree"), /t1.*检查这个 key/);
        assert.match(await session.run("input", "/tree context"), /KEY-731.*claim_count/);
        await session.run("chat", "/tree new 闲聊");
        assert.equal(store.tree.active, "t2");
        const source = store.history.observations("key");
        await session.run("repair", "/tree move key t2");
        assert.deepEqual(store.tree.turnIds("t1"), []);
        assert.deepEqual(store.tree.turnIds("t2"), ["key"]);
        assert.match(await session.run("show", "/tree show t2"), /KEY-731/);
        const branch = await store.history.session.branch("topic-t2", BACKGROUND_CONTEXT);
        assert.ok((await branch.findEntries(undefined, BACKGROUND_CONTEXT)).some(entry => entry.data?.kind === "edit"));
        await store.history.close(); store = await MemoryStore.open(directory);
        const afterRestart = new AgentSession(agent, store, {schedule() {}});
        await afterRestart.run("undo", "/tree undo");
        assert.deepEqual(store.tree.turnIds("t1"), ["key"]);
        assert.deepEqual(store.tree.turnIds("t2"), []);
        assert.deepEqual(store.history.observations("key"), JSON.parse(JSON.stringify(source)));
        assert.equal(operations, 1);
        assert.equal(store.tree.search("KEY-731")[0].id, "t1");
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("用户指出丢上下文后，切树工具在本轮立即恢复证据，保留工具配对", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-tree-repair-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        await store.recordUser("original", "目标是 CURRENT-731"); await store.recordAssistant("original", "已确认目标");
        await store.tree.importUnassigned();
        await store.tree.select(await store.tree.create("闲聊"));
        const {agent, requests} = scriptedAgent((_context, n) => n === 1
            ? {content: [{type: "toolCall", id: "switch-1", name: "context_tree", arguments: {operation: "switch", id: "t1"}}]}
            : "已经回到 CURRENT-731", [createContextTreeTool(store)]);
        const router = async () => ({mode: "chat", branch: "current", source: "jev", elapsedMs: 0});
        await new AgentSession(agent, store, {schedule() {}}, router).run("correction", "你丢了上下文，请回到先前的目标");
        assert.doesNotMatch(JSON.stringify(requests[0]), /CURRENT-731/);
        assert.match(JSON.stringify(requests[1]), /CURRENT-731/);
        assert.equal(requests[1].messages.filter(message => message.role === "toolResult" && message.toolCallId === "switch-1").length, 1);
        assert.equal(store.tree.active, "t1");
        assert.deepEqual(store.tree.turnIds("t1"), ["original", "correction"]);
        const sent = await store.tree.lastRequest();
        assert.match(JSON.stringify(sent.payload), /CURRENT-731/);
        assert.equal(sent.topic, "t1");
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("当前闲聊树找不到任务时返回历史候选，不猜测执行", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-tree-candidates-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        for (const title of ["周报改名", "移动端 MR"]) {
            const id = await store.tree.create(title);
            await store.recordUser(id, `准备处理${title}，先不要执行`);
            await store.recordAssistant(id, "等待确认");
            await store.tree.attach(id, id);
        }
        await store.tree.select(await store.tree.create("闲聊"));
        const {agent, requests} = scriptedAgent(() => assert.fail("Candidate listing must not execute the agent"));
        const reply = await new AgentSession(agent, store, {schedule() {}}, async () =>
            ({mode: "task", branch: "search", source: "jev", elapsedMs: 0})).run("resume", "继续之前那个任务，但我忘了具体叫什么");
        assert.match(reply, /周报改名/); assert.match(reply, /移动端 MR/);
        assert.equal(requests.length, 0);
        assert.equal(store.tree.active, "t3");
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("只有一个历史话题时直接恢复原话供回答，不再机械要求用户选择", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-tree-single-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        await store.recordUser("original", "我们在处理任务 DEMO-731");
        await store.recordAssistant("original", "记下了");
        await store.tree.importUnassigned();
        await store.tree.select(await store.tree.create("闲聊"));
        const {agent, requests} = scriptedAgent(() => "刚才在处理 DEMO-731");
        const reply = await new AgentSession(agent, store, {schedule() {}}, async () =>
            ({mode: "chat", branch: "search", source: "jev", elapsedMs: 0})).run("recall", "刚才在处理哪个任务？");
        assert.match(reply, /DEMO-731/);
        assert.match(JSON.stringify(requests[0]), /DEMO-731/);
        assert.equal(store.tree.active, "t1");
        assert.deepEqual(store.tree.turnIds(), ["original", "recall"]);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});

test("路由误选旧树仍保留紧邻原话核对指代，随后新问候不携带跨树内容", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-tree-handoff-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        for (const [id, text] of [["old", "稍后修改 DOC-OLD"], ["new", "换个话题，先聊 DOC-GUIDE 的结构"]]) {
            const topic = await store.tree.create(text);
            await store.recordUser(id, text); await store.recordAssistant(id, "好的");
            await store.tree.attach(id, topic); await store.tree.select(topic);
        }
        const {agent, requests} = scriptedAgent(() => "答复");
        let route = {mode: "task", branch: "t1", source: "jev", elapsedMs: 0};
        const session = new AgentSession(agent, store, {schedule() {}}, async () => route);
        await session.run("pronoun", "它的标题是什么？");
        const context = JSON.stringify(requests[0]);
        assert.match(context, /DOC-GUIDE/);
        assert.ok(context.indexOf("DOC-GUIDE") > context.indexOf("DOC-OLD"));
        assert.deepEqual(store.tree.turnIds("t2"), ["new"]);
        route = {mode: "greet", branch: "new", source: "jev", elapsedMs: 0};
        await session.run("greeting", "你好");
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /DOC-GUIDE|DOC-OLD/);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
