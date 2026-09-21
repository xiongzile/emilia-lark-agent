import {conversation} from "../../support/agent-fixture.mjs";

// agent/conversation.ts: a discourse-like prefix is not enough to assume continuation.
conversation({
    name: "为什么开头也可以是新话题，不把天空问题当成工作追问",
    history: [{user: "创建一个 MR。", assistant: "你需要先提供目标分支。"}],
    events: [{user: "为什么天空是蓝色的？", expect: {
        reply: /散射/, notReply: /MR|目标分支|确认|提供分支/,
        noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
    }}],
});
