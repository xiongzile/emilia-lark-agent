import {conversation} from "../../support/agent-fixture.mjs";

// src/agent/context-selector.ts：相同短句按最近话题解释，不能被旧任务抢走。
conversation({
    name: "闲聊里的第一个和继续，不会跳回旧 MR",
    requiresJev: true,
    history: [
        {id: "old-task", user: "帮我提 MR", assistant: "分支选哪个？1. develop；2. release。"},
        {id: "chat-options", user: "先聊点别的吧", assistant: "好呀，要聊猫还是电影？1. 猫；2. 电影。"},
    ],
    events: [
        {user: "第一个就行", expect: {
            // The label may be uncertain; the actual selected antecedent and reply must be right.
            context: {includes: ["chat-options"], excludes: ["old-task"]},
            reply: /猫/, notReply: /MR|分支|develop|release/i, noCalls: [{tool: "workspace_git"}],
        }},
        {user: "继续", expect: {
            context: {excludes: ["old-task"]},
            notReply: /MR|分支|develop|release/i, noCalls: [{tool: "workspace_git"}],
        }},
    ],
});
