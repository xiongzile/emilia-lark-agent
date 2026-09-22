import {conversation} from "../../support/agent-fixture.mjs";

// agent/session.ts: greeting does not reactivate old work; a later recall still works.
conversation({
    name: "工作后打招呼不汇报旧事，再问刚才做了什么仍记得",
    history: [{user: "取消任务 DEMO-482 的全部 35 条认领。", assistant: "35 条认领已取消，复查剩余 0 条。"}],
    events: [
        {user: "你好", score: {reply: "用户只打招呼，简短亲切回应即可，不延伸工作、不主动询问需求。",
            context: [{label: "当前招呼", contains: "用户当前消息：\n你好", role: "user"}]}, expect: {
            reply: /你好|嗨/,
            notReply: /认领|复查|35|DEMO|任务|需要.{0,8}帮|有什么.{0,8}(帮|做)/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "刚才我们在处理哪个任务？", score: {reply: "根据已经发生的聊天，直接回答任务 DEMO-482；这是回顾聊天，不需要重新做任务或要求外部授权。",
            context: [{label: "本轮回顾请求", contains: "刚才我们在处理哪个任务", role: "user"},
                {label: "之前的用户原话", contains: "DEMO-482", role: "user", critical: true}]}, expect: {reply: /DEMO-482/}},
    ],
});
