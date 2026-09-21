import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// Two equally plausible targets require clarification; a uniquely identifiable prior target does not.
conversation({
    name: "两个候选文档之间的它不猜对象，补齐信息后再执行",
    tools: [mockCommand({name: "task_cli", description: "Rename document: args [rename, document id, title].",
        rules: [{startsWith: ["rename", "DOC-NEW-812", "新计划"], result: {updated: true, id: "DOC-NEW-812"}}],
    })],
    events: [
        {user: "有两份文档准备改名：DOC-OLD-731 改为计划甲，DOC-OLD-732 改为计划乙。两份都先不要执行，等我说具体改哪份。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "先聊点别的，为什么天空是蓝色的？一句话就行。", expect: {notReply: /DOC-OLD|计划甲|计划乙/, noCalls: [{tool: "task_cli"}]}},
        {user: "改一下它。", expect: {reply: /什么|哪个|哪一|哪份|具体|指的|怎么|哪里/, noCalls: [{tool: "task_cli"}]}},
        {user: "我是说 DOC-NEW-812，把标题改成新计划，现在执行。", expect: {
            calls: [{tool: "task_cli", args: ["rename", "DOC-NEW-812", "新计划"], count: 1}, {tool: "task_cli", count: 1}], reply: /DOC-NEW-812|新计划/,
        }},
    ],
});
