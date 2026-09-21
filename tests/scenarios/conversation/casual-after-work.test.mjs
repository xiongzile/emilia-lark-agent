import {conversation} from "../../support/agent-fixture.mjs";

// Model-routed social language retains recent context without turning it into an agenda.
conversation({
    name: "不在问候规则里的随口聊天，也不会变成工作汇报",
    history: [
        {user: "取消这 35 条认领。", assistant: "取消完成，复查剩余 0 条。"},
        {user: "把任务编号记下来，DEMO-482。", assistant: "记下了，任务编号 DEMO-482。"},
    ],
    events: [
        {user: "忙了一天，终于能躺会儿了", expect: {
            notReply: /认领|35|DEMO-482|复查|需要.{0,8}帮|有什么.{0,8}(帮|做)/,
            noCalls: [{tool: "workspace_git"}, {tool: "memory"}],
        }},
        {user: "就是想随便说两句，没什么要办的", expect: {
            notReply: /认领|35|DEMO-482|复查|需要.{0,8}帮|有什么.{0,8}(帮|做)/,
            noCalls: [{tool: "workspace_git"}, {tool: "memory"}],
        }},
    ],
});
