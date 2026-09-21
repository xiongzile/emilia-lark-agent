import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// src/agent/session.ts、context-selector.ts：社交回应保留指代的操作，下一次问候不继续带它。
conversation({
    name: "做完事收到感谢时记得刚做的事，晚安时放下工作",
    requiresJev: true,
    tools: [mockCommand({
        name: "task_cli",
        description: "Create an MR with args [create, target branch, title]. Executes immediately and returns its ID.",
        rules: [{startsWith: ["create", "develop", "chore: demo"], result: {created: true, id: "MR-DEMO-731"}}],
    })],
    events: [
        {id: "create-mr", user: "帮我创建 MR，目标分支 develop，标题 chore: demo。直接执行。", expect: {
            calls: [{tool: "task_cli", args: ["create", "develop", "chore: demo"], count: 1}],
            reply: /MR-DEMO-731/,
        }},
        {id: "thanks", user: "谢谢，辛苦啦", expect: {
            context: {mode: "chat", includes: ["create-mr"]},
            notReply: /没干什么|没做什么|什么也没做|还没.{0,5}(做|开始)/,
            noCalls: [{tool: "task_cli"}],
        }},
        {user: "刚才建的 MR 编号是多少？", expect: {reply: /MR-DEMO-731/, noCalls: [{tool: "task_cli"}]}},
        {user: "晚安啦", expect: {
            context: {mode: "chat", excludes: ["create-mr"]},
            notReply: /MR|develop|任务|还有.{0,8}(处理|需要|帮忙)/i,
            noCalls: [{tool: "task_cli"}],
        }},
    ],
});
