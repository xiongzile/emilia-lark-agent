import {conversation} from "../../support/agent-fixture.mjs";

// A provider failure cannot bypass the durable greeting boundary.
conversation({
    name: "问候后 Jev 故障仍正常聊天，恢复后能主动查回旧事",
    history: [{user: "之前的 Jev 实验编号是 JEV-OUTAGE-731。", assistant: "记下这个实验编号了。"}],
    events: [
        {user: "晚上好呀爱蜜莉雅", expect: {notReply: /Jev|JEV-OUTAGE|实验|[？?]/, noCalls: [{tool: "memory"}, {tool: "workspace_git"}]}},
        {routerUnavailable: true},
        {restart: true},
        {user: "今天过得怎么样", expect: {notReply: /Jev|JEV-OUTAGE|实验/, noCalls: [{tool: "memory"}, {tool: "workspace_git"}]}},
        {routerUnavailable: false},
        {user: "之前的 Jev 实验编号是什么？", expect: {reply: /JEV-OUTAGE-731/}},
    ],
});
