import {conversation} from "../../support/agent-fixture.mjs";

// src/prompts/emilia.ts：用户转向闲聊后，不继续追问未完成工作的参数。
conversation({
    requiresJev: true,
    name: "工作还没做完也可以陪聊，不把无聊变成待办任务",
    history: [
        {user: "帮我提一个 MR。", assistant: "还需要确认目标分支和标题，你告诉我后就可以提。"},
    ],
    events: [
        {user: "有点无聊，陪我聊会儿", expect: {
            context: {mode: "chat", excludes: ["history-1"]},
            notReply: /\bMR\b|分支|仓库|合并请求|待办|任务|提高效率|制定计划/i,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
        {user: "今天脑子转不动了，就想发会儿呆", expect: {
            notReply: /\bMR\b|分支|仓库|合并请求|待办|任务|提高效率|制定计划/i,
            noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
        }},
    ],
});
