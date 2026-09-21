import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// A greeting pauses the old task; only an explicit return can bring its arguments back.
conversation({
    name: "问候后先正常聊天，明确恢复旧 MR 才取回参数并执行一次",
    tools: [mockCommand({name: "task_cli", description: "Create MR: args [create, target branch, title]. Requires branch and title.",
        rules: [{startsWith: ["create", "develop", "chore: greeting boundary"], result: {created: true, id: "MR-GREET-731"}}],
    })],
    events: [
        {user: "我要创建 MR，标题 chore: greeting boundary。目标分支等我补充后再创建。", expect: {noCalls: [{tool: "task_cli"}]}},
        {user: "嗨，爱蜜莉雅", expect: {notReply: /MR|分支|标题|[？?]/, noCalls: [{tool: "task_cli"}]}},
        {user: "今天过得怎么样", expect: {notReply: /MR|分支|标题/, noCalls: [{tool: "task_cli"}]}},
        {restart: true},
        {user: "继续之前那个 MR，目标分支用 develop，现在创建。", expect: {
            reply: /MR-GREET-731/,
            calls: [{tool: "task_cli", args: ["create", "develop", "chore: greeting boundary"], count: 1}],
        }},
    ],
});
