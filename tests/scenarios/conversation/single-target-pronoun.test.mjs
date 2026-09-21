import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// A unique nearby target can be referenced by a pronoun, without repeating its ID.
conversation({
    name: "只有一个待改对象时，改它吧直接执行，不要求用户重复编号",
    tools: [mockCommand({name: "task_cli", description: "Rename document: args [rename, document id, title].",
        rules: [{startsWith: ["rename", "DOC-ONLY-731", "新周报"], result: {updated: true, id: "DOC-ONLY-731"}}],
    })],
    events: [
        {user: "准备把 DOC-ONLY-731 改名为新周报，先不要执行，等我说改。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "刚喝了杯水，精神好多了。", expect: {noCalls: [{tool: "task_cli"}], notReply: /DOC-ONLY|周报/}},
        {user: "那就改它吧。", expect: {
            calls: [{tool: "task_cli", args: ["rename", "DOC-ONLY-731", "新周报"], count: 1}, {tool: "task_cli", count: 1}], reply: /DOC-ONLY-731|新周报/,
        }},
    ],
});
