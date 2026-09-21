import {conversation} from "../../support/agent-fixture.mjs";

// agent/session.ts: greeting does not reactivate old work; a later recall still works.
conversation({
    name: "工作后打招呼不汇报旧事，再问刚才做了什么仍记得",
    history: [{user: "取消任务 DEMO-482 的全部 35 条认领。", assistant: "35 条认领已取消，复查剩余 0 条。"}],
    events: [
        {user: "你好", expect: {
            reply: /你好|嗨/,
            notReply: /认领|复查|35|DEMO|任务|需要.{0,8}帮|有什么.{0,8}(帮|做)/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "刚才我们在处理哪个任务？", expect: {reply: /DEMO-482/}},
    ],
});
