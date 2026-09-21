import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// src/prompts/emilia.ts：缺少必要信息时澄清，补齐后执行。文档工具为模拟工具。
conversation({
    name: "文档和内容不明确时先澄清，用户补齐信息后执行",
    tools: [mockCommand({
        name: "lark_cli",
        description: "List documents with args: docs +search <query>. Edit with args: docs +replace <doc-id> <old-text> <new-text>.",
        rules: [
            {startsWith: ["docs", "+replace"], result: {docId: "doc-a", updated: true}},
            {startsWith: ["docs", "+search"], result: {documents: [
                {id: "doc-a", title: "工作流搭建手记"},
                {id: "doc-b", title: "项目手记"},
            ]}},
        ],
    })],
    events: [
        {user: "把那篇手记更新一下。", expect: {
                reply: /哪|什么|具体|内容|标题|关键词|链接/,
                noCalls: [{tool: "lark_cli", startsWith: ["docs", "+replace"]}],
            }},
        {user: "文档是 doc-a，把“计划：待补充”替换成“计划：补充本周进展”，直接改。", expect: {
            calls: [{tool: "lark_cli", args: ["docs", "+replace", "doc-a", "计划：待补充", "计划：补充本周进展"], count: 1}],
        }},
    ],
});
