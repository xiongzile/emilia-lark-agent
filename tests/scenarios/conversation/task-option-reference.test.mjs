import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// conversation.ts: short choices and corrections preserve task context and use the latest choice.
conversation({
    name: "第一个先别执行，然后改口第二个，按最新选择执行一次",
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, target branch, title].",
        rules: [{startsWith: ["create", "release", "chore: option reference"], result: {created: true, id: "MR-OPTION-731"}}],
    })],
    events: [
        {user: "准备创建 MR，标题 chore: option reference。目标分支有两个选项：第一个 develop，第二个 release，等我选好并说执行再创建。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "第一个，先别执行。", expect: {noCalls: [{tool: "task_cli"}]}},
        {restart: true},
        {user: "不是，我说的是第二个，现在执行吧。", expect: {
            calls: [{tool: "task_cli", args: ["create", "release", "chore: option reference"], count: 1}, {tool: "task_cli", count: 1}], reply: /MR-OPTION-731/,
        }},
    ],
});
