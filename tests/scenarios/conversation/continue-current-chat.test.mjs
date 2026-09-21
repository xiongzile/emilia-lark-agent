import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// Unqualified continuation stays on the current chat, without resuming an archived task.
conversation({
    name: "任务暂停后聊猫，说第一个和继续只延续聊天",
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, branch, title].", rules: []})],
    events: [
        {user: "准备创建 MR，标题 chore: pending，目标分支 develop。先不要执行，等我明确说创建。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "换个话题，给我两个可聊的话题：第一个猫咪，第二个电影。先只列选项。", expect: {reply: /猫/, notReply: /MR|develop|分支/, noCalls: [{tool: "task_cli"}]}},
        {user: "第一个就行", expect: {reply: /猫/, notReply: /MR|develop|分支/, noCalls: [{tool: "task_cli"}]}},
        {user: "继续", expect: {reply: /猫|它们|它/, notReply: /MR|develop|分支/, noCalls: [{tool: "task_cli"}]}},
    ],
});
