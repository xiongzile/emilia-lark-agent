import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// tree search returns candidates when the user explicitly says the target is unknown.
conversation({name: "忘了旧任务名称时列出候选，用户选择后才恢复对应任务",
    tools: [mockCommand({name: "documents", description: "Read document title: args [title, id].",
        rules: [{args: ["title", "DOC-REPORT-731"], result: {title: "本周周报"}}]})],
    events: [
        {user: "/tree new 周报文档"},
        {user: "周报文档是 DOC-REPORT-731，稍后再查标题，现在不用执行。", expect: {noCalls: [{tool: "documents"}]}},
        {user: "/tree new 移动端 MR"},
        {user: "稍后看看 MR-MOBILE-482，现在先不查。", expect: {noCalls: [{tool: "documents"}]}},
        {user: "/tree new 闲聊"},
        {user: "我想继续之前的任务，但忘了叫什么了。请先列出历史任务让我选，不要执行。", expect: {
            reply: /周报|DOC-REPORT-731/, notReply: /已修改|已创建|已批准/, noCalls: [{tool: "documents"}]}},
        {user: "我选周报文档这个话题，请查询它现在的标题。", score: {
            reply: "根据用户选择恢复周报文档 DOC-REPORT-731，查询并回答本周周报，不处理移动端 MR，不重复询问编号。",
            context: [{label: "本轮明确选择", contains: "我选周报文档这个话题", role: "user"},
                {label: "被选话题的原始对象", contains: "DOC-REPORT-731", role: "user", critical: true}],
        }, expect: {calls: [{tool: "documents", args: ["title", "DOC-REPORT-731"], count: 1}], reply: /本周周报/}},
    ],
});
