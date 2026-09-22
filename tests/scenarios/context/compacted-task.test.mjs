import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// context.ts: the corrected target is in the summarized portion, not the retained tail.
conversation({
    name: "压缩旧记录后，执行最新对象和参数，已完成操作不重做",
    contextBudget: {maxTokens: 2500, keepTokens: 300},
    tools: [mockCommand({name: "document_cli", description: "Document operations: args [rename, id, title] or [publish, id].",
        rules: [{startsWith: ["rename", "DOC-NEW-921", "秋季周报"], result: {updated: true, id: "DOC-NEW-921"}}],
    })],
    history: [
        {user: "把 DOC-OLD-482 改成周报，先别执行。", assistant: "等你确认。"},
        {user: "纠正：目标是 DOC-NEW-921，标题是秋季周报，只改标题，不发布。附件已经上传成功，不要再传。等我确认。", assistant: "待确认后改名，已上传附件不再处理。"},
        {user: "我贴一些与这次改名无关的旧日志，供排查格式：", assistant: "旧日志：" + "ignored formatting detail, no action needed; ".repeat(130)},
        {user: "这些旧日志不用处理，继续等我确认。", assistant: "日志副本：" + "irrelevant old diagnostic, keep waiting; ".repeat(130)},
    ],
    events: [
        {user: "确认，按纠正后的对象和标题执行改名。", expect: {
            compacted: true,
            calls: [{tool: "document_cli", args: ["rename", "DOC-NEW-921", "秋季周报"], count: 1}, {tool: "document_cli", count: 1}],
            noCalls: [{tool: "document_cli", startsWith: ["publish"]}],
        }},
        {user: "它现在叫什么？只回答标题。", expect: {reply: /秋季周报/, noCalls: [{tool: "document_cli"}]}},
        {user: "晚上好", expect: {reply: /晚上好/, notReply: /DOC-|秋季周报|附件|改名/, noCalls: [{tool: "document_cli"}]}},
    ],
});
