import {conversation} from "../../support/agent-fixture.mjs";

// src/prompts/emilia.ts、src/agent/session.ts：有近期工作记录，也按当前问候自然回应。
conversation({
    requiresJev: true,
    name: "完成工作后的一句晚上好，不触发旧任务汇报或工作邀约",
    history: [
        {user: "我确认，取消同事名下这 35 条认领。", assistant: "35 条认领已取消，复查剩余 0 条。"},
    ],
    events: [
        {user: "晚上好", expect: {
            context: {mode: "chat", excludes: ["history-1"]},
            reply: /晚上好|晚好/,
            notReply: /认领|复查|35|任务|有什么想做|有什么.{0,12}(帮|处理)|需要.{0,12}(帮忙|处理)|有.{0,8}(事要办|要办的)/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "路过看看你在不在，哈哈", expect: {
            context: {mode: "chat", excludes: ["history-1"]},
            notReply: /认领|复查|35|任务|有什么想做|有什么.{0,12}(帮|处理)|需要.{0,12}(帮忙|处理)|有.{0,8}(事要办|要办的)/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
    ],
});
