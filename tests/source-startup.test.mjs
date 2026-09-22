import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";

// The launchd service runs src/index.ts directly, not tsc output. Its real context
// modules must load in Node's strip-only mode as well as passing compiled tests.
test("源码启动后，树指令经过真实收发处理器返回文字，不留下空流式卡片", async () => {
    const {AgentSession} = await import("../src/agent/session.ts");
    const {MemoryStore} = await import("../src/memory/store.ts");
    const {createFeishuMessageHandler} = await import("../src/channels/feishu-agent.ts");
    const directory = await mkdtemp(join(tmpdir(), "emilia-source-startup-"));
    let store;
    try {
        store = await MemoryStore.open(directory);
        const session = new AgentSession(undefined, store, {schedule() {}});
        const replies = [];
        const handle = createFeishuMessageHandler(session, {
            processing: () => async () => {},
            reply: async (id, text) => replies.push({id, text}),
            stream: async () => assert.fail("A tree command must reply directly, not create an empty card"),
        });
        await handle({messageId: "new", chatId: "fixture", text: "/tree new 源码启动检查"});
        await handle({messageId: "list", chatId: "fixture", text: "/tree"});
        assert.equal(replies.length, 2);
        assert.match(replies[0].text, /t1 源码启动检查/);
        assert.match(replies[1].text, /→ t1/);
    } finally {await store?.history.close(); await rm(directory, {recursive: true, force: true});}
});
