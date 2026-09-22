import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// memory/store.ts + agent/context-tree.ts: durable task references survive chat and a restart.
conversation({
    name: "暂停任务去聊天，近期窗口过期和重启后仍能补齐参数执行",
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, target branch, title]. Requires both branch and title.",
        rules: [{startsWith: ["create", "develop", "chore: routing demo"], result: {created: true, id: "MR-RESUME-482"}}],
    })],
    events: [
        {user: "我要创建 MR，标题 chore: routing demo。目标分支还没定，等我补充再创建。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "先不弄工作了，有点累，陪我聊会儿。", expect: {noCalls: [{tool: "task_cli"}], notReply: /确认.{0,8}分支|分支.{0,8}确认/}},
        {ageRecentTurns: 21},
        {restart: true},
        {user: "刚才那个 MR，目标分支用 develop，执行吧。", expect: {
            calls: [{tool: "task_cli", args: ["create", "develop", "chore: routing demo"], count: 1}], reply: /MR-RESUME-482/,
        }},
    ],
});
