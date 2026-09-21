import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// Topic labels are excerpts; actual source messages still carry corrected parameters.
conversation({
    name: "执行前纠正参数，用修正后的分支创建一次 MR",
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, target branch, title].",
        rules: [{startsWith: ["create", "release", "chore: corrected branch"], result: {created: true, id: "MR-CORRECT-731"}}],
    })],
    events: [
        {user: "准备创建 MR，标题 chore: corrected branch，目标分支 develop。先别执行。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "不对，目标分支改成 release，现在创建吧。", expect: {
            calls: [{tool: "task_cli", args: ["create", "release", "chore: corrected branch"], count: 1}], reply: /MR-CORRECT-731/,
        }},
    ],
});
