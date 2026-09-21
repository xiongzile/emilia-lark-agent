import {conversation} from "../../support/agent-fixture.mjs";

// src/prompts/emilia.ts、src/tools/workspace-git.ts：有问候也有明确请求时，仍执行请求。
conversation({
    name: "问候中带明确工作请求时，执行工具而不是只陪聊",
    tools: ["git"],
    events: [
        {user: "晚上好呀，顺便帮我查一下 agent 仓库最近一次提交的标题。", expect: {
            reply: /AGENT-MEMORY-731/,
            calls: [{tool: "workspace_git", workspace: "agent", startsWith: ["log"]}],
            noCalls: [{tool: "workspace_git", workspace: "mobile"}],
        }},
    ],
});
