import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// conversation.ts: the classifier sees the task within ten turns, across topic boundaries.
conversation({
    name: "最近十轮内换话题并重启后，继续刚才的任务恢复对象和参数",
    tools: [mockCommand({name: "task_cli", description: "Rename document: args [rename, document id, title].",
        rules: [{startsWith: ["rename", "DOC-RESUME-731", "路由回归周报"], result: {updated: true, id: "DOC-RESUME-731"}}],
    })],
    events: [
        {user: "准备把 DOC-RESUME-731 改名为路由回归周报，先别执行，等我说继续。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "聊点别的，为什么树叶是绿色的？一句话就行。", expect: {notReply: /DOC-RESUME|周报|改名/, noCalls: [{tool: "task_cli"}]}},
        {user: "再换个话题，猫为什么喜欢纸箱？一句话就行。", expect: {notReply: /DOC-RESUME|周报|改名/, noCalls: [{tool: "task_cli"}]}},
        {ageRecentTurns: 5},
        {restart: true},
        {user: "继续刚才的任务，按之前说的执行吧。", expect: {
            calls: [{tool: "task_cli", args: ["rename", "DOC-RESUME-731", "路由回归周报"], count: 1}, {tool: "task_cli", count: 1}],
            reply: /DOC-RESUME-731|路由回归周报/,
        }},
    ],
});
