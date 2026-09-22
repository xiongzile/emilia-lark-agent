import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {AgentSession} from "../dist/agent/session.js";
import {MemoryStore} from "../dist/memory/store.js";
import {createContextTreeTool} from "../dist/agent/tree-tools.js";
import {scriptedAgent} from "./support/scripted-agent.mjs";

test("所有模式都能找回最近对象；聊天视图不能限制历史工具", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-views-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        await store.recordUser("old", "昨天取消 OLD-482"); await store.recordAssistant("old", "已取消");
        await store.recordUser("new", "查询 CURRENT-731"); await store.recordAssistant("new", "发布完成", {lastMode: "task"});
        const {agent, requests} = scriptedAgent();
        let mode = "greet";
        const session = new AgentSession(agent, store, {schedule() {}}, async () => ({mode, branch: mode === "task" ? "t1" : "current", source: "jev", elapsedMs: 0}));
        await session.run("hello", "下午好");
        for (const next of ["chat", "greet", "task"]) {
            mode = next;
            await session.run(`probe-${mode}`, "刚才那个对象是什么");
            const history = await createContextTreeTool(store).execute("recent", {operation: "recent"});
            assert.match(JSON.stringify(history), /CURRENT-731/);
            if (mode !== "task") assert.doesNotMatch(JSON.stringify(requests.at(-1)), /CURRENT-731|OLD-482/);
            else assert.match(JSON.stringify(requests.at(-1)), /CURRENT-731/);
        }
        assert.deepEqual(store.history.turns.slice(0, 2).map(t => t.messageId), ["old", "new"]);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
