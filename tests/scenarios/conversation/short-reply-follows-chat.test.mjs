import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// agent/conversation.ts: short references follow the latest topic, not an older unfinished task.
conversation({
    name: "聊天中说第一个和继续，指向最近的聊天选项而不是旧 MR",
    history: [
        {user: "准备创建一个 MR。", assistant: "目标分支选 develop 还是 release？"},
        {user: "工作先放着，聊点轻松的吧。", assistant: "聊猫咪，还是聊电影？"},
    ],
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, branch].", rules: []})],
    events: [
        {user: "第一个就行", expect: {reply: /猫/, notReply: /MR|develop|release|分支/, noCalls: [{tool: "task_cli"}]}},
        {user: "继续", expect: {notReply: /MR|develop|release|分支/, noCalls: [{tool: "task_cli"}]}},
    ],
});
