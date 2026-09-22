import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// tree-tools.ts: even a wrong topic selection can recover the exact recent correction.
conversation({
    name: "追问被误分为闲聊，仍可读取最近原话并查询纠正后的文档",
    history: [
        {user: "上次我用过 DOC-OLD-482", assistant: "记下了。"},
        {user: "这次需要查看 DOC-FIRST-731", assistant: "好的。"},
        {user: "不对，这次对象改成 DOC-CORRECT-926。", assistant: "这次以 DOC-CORRECT-926 为准。"},
    ],
    tools: [mockCommand({name: "documents", description: "Read current document title: args [title, document id].",
        rules: [{startsWith: ["title", "DOC-CORRECT-926"], result: {id: "DOC-CORRECT-926", title: "本周事项"}}]})],
    events: [
        {user: "晚上好呀", route: {mode: "greet", source: "jev", elapsedMs: 0}, expect: {notReply: /DOC-|文档/}},
        {restart: true},
        {user: "刚才最后确定的那份文档，它现在叫什么？", route: {mode: "chat", source: "jev", elapsedMs: 0}, expect: {
            calls: [{tool: "context_tree"}, {tool: "documents", args: ["title", "DOC-CORRECT-926"], count: 1}, {tool: "documents", count: 1}],
            reply: /本周事项/, notReply: /请.*(?:提供|告诉).*ID/,
        }},
    ],
});
