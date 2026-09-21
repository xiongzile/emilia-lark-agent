import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// agent/session.ts: acknowledgements retain the completed result without repeating the action.
conversation({
    name: "创建任务后感谢只回应感谢，稍后仍能给出结果且不重复创建",
    tools: [mockCommand({name: "task_cli", description: "Create a task: args [create, title]. Returns the created task ID.",
        rules: [{startsWith: ["create", "demo"], result: {created: true, id: "TASK-731"}}],
    })],
    events: [
        {user: "创建标题为 demo 的任务，直接执行。", expect: {
            calls: [{tool: "task_cli", args: ["create", "demo"], count: 1}], reply: /TASK-731/,
        }},
        {user: "谢谢", expect: {notReply: /还没|没做|继续创建|再创建|需要.{0,8}帮|有什么.{0,8}(帮|做)/, noCalls: [{tool: "task_cli"}]}},
        {user: "刚才的任务编号再给我一下", expect: {reply: /TASK-731/, noCalls: [{tool: "task_cli"}]}},
    ],
});
