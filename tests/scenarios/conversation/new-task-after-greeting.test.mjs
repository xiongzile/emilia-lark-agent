import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// New work after a greeting must not inherit the old task's arguments.
conversation({
    name: "问候后开始新任务，不把旧任务的对象或参数带进工具调用",
    tools: [mockCommand({name: "task_cli", description: "Rename document: args [rename, document id, new title].",
        rules: [{startsWith: ["rename", "DOC-NEW-812", "新周报"], result: {updated: true, id: "DOC-NEW-812"}}],
    })],
    events: [
        {user: "准备把 DOC-OLD-731 的标题改成旧周报，先不要执行，等我确认。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "哈喽爱蜜莉雅", expect: {notReply: /DOC-OLD|旧周报|确认/, noCalls: [{tool: "task_cli"}]}},
        {user: "新任务：把 DOC-NEW-812 的标题改成新周报，现在执行。", expect: {
            calls: [{tool: "task_cli", args: ["rename", "DOC-NEW-812", "新周报"], count: 1}],
            noCalls: [{tool: "task_cli", startsWith: ["rename", "DOC-OLD-731"]}], reply: /DOC-NEW-812|新周报/,
        }},
    ],
});
