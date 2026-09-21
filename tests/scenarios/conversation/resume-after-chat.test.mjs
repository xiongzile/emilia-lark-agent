import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// src/agent/session.ts、context-selector.ts：闲聊、记忆命令和重启后，从原话恢复任务参数。
conversation({
    name: "任务暂停去闲聊，重启后只补目标分支就能接着执行",
    requiresJev: true,
    history: [{id: "request", user: "创建 MR，标题 chore: demo。", assistant: "目标分支用 develop 还是 release？"}],
    tools: [mockCommand({
        name: "task_cli",
        description: "Create an MR with args [create, target branch, title]. Executes immediately and returns its ID.",
        rules: [{startsWith: ["create", "develop", "chore: demo"], result: {created: true, id: "MR-RESUMED-482"}}],
    })],
    events: [
        {user: "先陪我聊一会儿吧，今天有点累", expect: {
            context: {mode: "chat", excludes: ["request"]}, noCalls: [{tool: "task_cli"}],
        }},
        {user: "/memory status"},
        {restart: true},
        {user: "刚才那个 MR，目标分支用 develop，执行吧。", expect: {
            context: {mode: "task", includes: ["request"]},
            calls: [{tool: "task_cli", args: ["create", "develop", "chore: demo"], count: 1}],
            reply: /MR-RESUMED-482/,
        }},
    ],
});
