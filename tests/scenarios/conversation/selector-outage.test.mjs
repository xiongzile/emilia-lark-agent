import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// src/agent/context-selector.ts、src/memory/tool.ts：选取服务不可用时，按需找回历史。
conversation({
    name: "Jev 故障时照常闲聊，说继续后按需找回任务并执行一次",
    contextUnavailable: true,
    history: [{id: "request", user: "创建 MR，标题 chore: outage test。", assistant: "目标分支用 develop 还是 release？"}],
    tools: ["memory", mockCommand({
        name: "task_cli",
        description: "Create an MR with args [create, target branch, title]. Executes immediately and returns its ID.",
        rules: [{startsWith: ["create", "develop", "chore: outage test"], result: {created: true, id: "MR-OUTAGE-482"}}],
    })],
    events: [
        {user: "晚上好", expect: {
            context: {source: "fallback", excludes: ["request"]},
            notReply: /MR|分支|标题/i,
            noCalls: [{tool: "memory"}, {tool: "task_cli"}],
        }},
        {user: "继续刚才没做完的那个，目标用 develop，直接执行。", expect: {
            context: {source: "fallback", excludes: ["request"]},
            calls: [{tool: "memory"}, {tool: "task_cli", args: ["create", "develop", "chore: outage test"], count: 1}],
            reply: /MR-OUTAGE-482/,
        }},
    ],
});
