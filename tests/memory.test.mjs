import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {MemoryStore} from "../dist/memory/store.js";
import {MemoryDistiller} from "../dist/memory/distill.js";

test("raw turns survive restart and only distilled facts enter core memory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-memory-"));
    try {
        const store = await MemoryStore.open(directory);
        await store.recordUser("m1", "记住：pi 是我的 agent 工程");
        await store.recordAssistant("m1", "好，我记住了。");
        const models = {
            async completeSimple(_model, context) {
                const input = JSON.parse(context.messages[0].content);
                assert.equal(input.turns[0].messageId, "m1");
                return {
                    stopReason: "stop",
                    content: [{type: "text", text: JSON.stringify({changes: [{
                        operation: "upsert", id: "invented-id", category: "project", text: "pi 指用户的 agent 工程",
                        sourceMessageIds: ["m1"],
                    }]})}],
                };
            },
        };
        const distiller = new MemoryDistiller(store, models, {});
        const report = await distiller.update();
        assert.equal(report.length, 1);
        assert.equal(store.status().pending, 0);
        assert.match(store.context(), /pi 指用户的 agent 工程/);
        assert.match(store.context(), /记住：pi 是我的 agent 工程/);

        const reopened = await MemoryStore.open(directory);
        assert.equal(reopened.list("project").length, 1);
        assert.equal(reopened.search("agent 工程").length, 1);
        assert.equal(reopened.search("记住 pi", true).length, 1);
        assert.deepEqual(JSON.parse(await readFile(join(directory, "transcript.json"), "utf8")).turns[0].user,
            "记住：pi 是我的 agent 工程");
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("updates correct existing facts and do not duplicate delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-memory-"));
    try {
        const store = await MemoryStore.open(directory);
        await store.recordUser("m1", "我负责 Android");
        await store.recordAssistant("m1", "收到");
        await store.recordUser("m1", "重复事件");
        assert.equal(store.status().turns, 1);
        await store.apply([{operation: "upsert", category: "profile", text: "用户负责 Android", sourceMessageIds: ["m1"]}], 1);
        const id = store.list()[0].id;
        await store.recordUser("m2", "更准确地说，我负责 Android 构建");
        await store.recordAssistant("m2", "了解");
        await store.apply([{operation: "upsert", id, category: "profile", text: "用户负责 Android 构建", sourceMessageIds: ["m2"]}], 2);
        assert.equal(store.list().length, 1);
        assert.deepEqual(store.get(id).sourceMessageIds, ["m1", "m2"]);
        assert.equal(store.get(id).text, "用户负责 Android 构建");
        assert.equal(await store.forget(id), true);
        assert.equal(store.list().length, 0);
        assert.equal(store.search("Android", true).length, 2);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("failed extraction keeps the original turn pending for retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-memory-"));
    try {
        const store = await MemoryStore.open(directory);
        await store.recordUser("m1", "以后默认使用当前 agent 仓库");
        await store.recordAssistant("m1", "好的");
        let attempts = 0;
        const models = {
            async completeSimple() {
                attempts += 1;
                if (attempts === 1) throw new Error("temporary model error");
                return {stopReason: "stop", content: [{type: "text", text: '{"changes":[]}'}]};
            },
        };
        const distiller = new MemoryDistiller(store, models, {});
        await assert.rejects(distiller.update(), /temporary model error/);
        assert.equal(store.status().pending, 1);
        await distiller.update();
        assert.equal(store.status().pending, 0);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
