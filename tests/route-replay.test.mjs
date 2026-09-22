import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {routingTape, replayRouter} from "./support/route-replay.mjs";

test("固定分类器保留第一轮失败样本，不把历史答案或成功重试塞给新模型", async t => {
    const dir = await mkdtemp(join(tmpdir(), "route-replay-"));
    t.after(() => rm(dir, {recursive: true, force: true}));
    for (const round of [1, 2]) await writeFile(join(dir, `agent-eval-${round}.json`), JSON.stringify({round, results: [
        {name: "恢复文档", passed: round === 2, timeline: [
            {type: "user", text: "继续文档"}, {type: "route", mode: "task", branch: round === 1 ? "t1" : "t2", source: "jev"},
            {type: "assistant", text: "不能把这个答案泄漏给被测模型"},
        ]},
    ]}));
    const tape = routingTape(dir);
    assert.ok(!JSON.stringify(tape).includes("这个答案"));
    const route = await replayRouter(tape, "恢复文档")("继续文档", {topics: [{id: "t1"}, {id: "t2"}]});
    assert.equal(route.branch, "t1");
    assert.equal(route.replayed, true);
    await assert.rejects(replayRouter(tape, "恢复文档")("继续文档", {topics: [{id: "t2"}]}), /does not exist/);
    await assert.rejects(replayRouter(tape, "恢复文档")("未知消息", {}), /No recorded route/);
});
