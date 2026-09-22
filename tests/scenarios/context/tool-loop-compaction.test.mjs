import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// session.ts prepareNextTurn: compact between tool iterations, then continue
// with paired results and retain the actual revision for the next authorized write.
conversation({
    name: "工具返回触发压缩仍能完成回复，下一轮按已查到的 revision 写一次",
    contextBudget: {maxTokens: 2500, keepTokens: 300},
    tools: [mockCommand({name: "document_cli", description: "Read document: args [read, id]. Rename with optimistic revision check: args [rename, id, title, revision].",
        rules: [
            {startsWith: ["read", "DOC-EVIDENCE-731"], result: {id: "DOC-EVIDENCE-731", revision: 17,
                diagnostics: "legacy trace detail; ".repeat(800)}},
            {startsWith: ["rename", "DOC-EVIDENCE-731", "本周记录", "17"], result: {updated: true, revision: 18}},
        ],
    })],
    history: [{user: "当前在处理文档 DOC-EVIDENCE-731，暂时只查看。", assistant: "还没读取这篇文档。"}],
    events: [
        {user: "读取它的当前 revision，只回复 revision 数字，不要修改。", expect: {
            compacted: true, reply: /17/,
            calls: [{tool: "document_cli", args: ["read", "DOC-EVIDENCE-731"], count: 1}],
            noCalls: [{tool: "document_cli", startsWith: ["rename"]}],
        }},
        {user: "用刚才查到的 revision，把它改名为本周记录。", expect: {
            calls: [{tool: "document_cli", args: ["rename", "DOC-EVIDENCE-731", "本周记录", "17"], count: 1}],
            noCalls: [{tool: "document_cli", startsWith: ["read"]}],
        }},
    ],
});
