import {conversation} from "../../support/agent-fixture.mjs";

// conversation.ts + session.ts: greeting creates a durable boundary, not a one-turn hint.
conversation({
    name: "晚上好呀爱蜜莉雅后问今天过得怎么样，不再带出问候之前的事",
    history: [
        {user: "我们刚才聊的是 Jev 和 agent 架构，实验编号 JEV-731。", assistant: "对，刚才在研究 Jev，实验编号 JEV-731。"},
        {user: "我这是在测试你有没有记住。", assistant: "被你抓着猜了几回心思。昨天这个时间你也还没睡。"},
    ],
    events: [
        {user: "晚上好呀爱蜜莉雅", expect: {
            reply: /晚上好/,
            notReply: /Jev|JEV-731|架构|测试|考我|猜|昨天|熬夜|[？?]/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "今天过得怎么样", expect: {
            notReply: /Jev|JEV-731|架构|测试|考我|猜心|昨天|被你抓|早睡的人/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {restart: true},
        {user: "我也挺好的，刚吃完晚饭", expect: {
            notReply: /Jev|JEV-731|架构|测试|考我|猜心|昨天|被你抓/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "晚上好，之前讨论 Jev 的实验编号是什么来着？", expect: {reply: /JEV-731/}},
    ],
});
