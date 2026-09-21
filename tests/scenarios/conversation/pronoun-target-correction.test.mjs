import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// session.ts: a current pronoun uses the new subject; an explicit correction recalls the old one.
conversation({
    name: "它指当前文档，不是我说的是刚才那份则恢复旧文档",
    tools: [mockCommand({name: "task_cli", description: "Read document title: args [get, document id]. Rename: args [rename, document id, title].",
        rules: [
            {startsWith: ["get", "DOC-GUIDE-812"], result: {id: "DOC-GUIDE-812", title: "指南-ORANGE"}},
            {startsWith: ["get", "DOC-OLD-731"], result: {id: "DOC-OLD-731", title: "周报-BLUE"}},
        ],
    })],
    events: [
        {user: "准备修改 DOC-OLD-731 的标题，名字等我想好再告诉你，先不要执行。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "换个话题，DOC-GUIDE-812 是另外一份使用指南，我们先聊它的章节结构，不用查资料。", expect: {noCalls: [{tool: "task_cli"}], notReply: /DOC-OLD-731/}},
        {user: "那它现在的标题是什么？你查一下。", expect: {
            calls: [{tool: "task_cli", args: ["get", "DOC-GUIDE-812"], count: 1}, {tool: "task_cli", count: 1}], reply: /指南-ORANGE/,
        }},
        {user: "不是，我说的是刚才准备修改的那份，查一下它现在的标题，不要改。", expect: {
            calls: [{tool: "task_cli", args: ["get", "DOC-OLD-731"], count: 1}, {tool: "task_cli", count: 1}], reply: /周报-BLUE/,
        }},
    ],
});
