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
        {user: "今天过得怎么样", score: {reply: "自然闲聊今天过得如何，不提之前的 Jev 实验、测试、昨天熬夜或用户曾考验助手的事情。",
            context: [{label: "本轮闲聊", contains: "今天过得怎么样", role: "user"},
                {label: "刚才的问候", contains: "晚上好呀爱蜜莉雅", role: "user"}]}, expect: {
            notReply: /Jev|JEV-731|架构|测试|考我|猜心|昨天|被你抓|早睡的人/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {restart: true},
        {user: "我也挺好的，刚吃完晚饭", expect: {
            notReply: /Jev|JEV-731|架构|测试|考我|猜心|昨天|被你抓/,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "晚上好，之前讨论 Jev 的实验编号是什么来着？", score: {reply: "用户询问聊天里提过的编号，直接回答 JEV-731。无需用户再次提供出处来证明自己之前说过的话。",
            context: [{label: "本轮明确回顾", contains: "实验编号是什么", role: "user"},
                {label: "用户之前给出的编号", contains: "JEV-731", role: "user", critical: true}]}, expect: {reply: /JEV-731/}},
    ],
});
