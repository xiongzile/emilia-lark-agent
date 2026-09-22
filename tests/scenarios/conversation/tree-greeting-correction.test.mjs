import {conversation} from "../../support/agent-fixture.mjs";

// A user's context correction creates a clean branch that persists after restart.
conversation({name: "指出只想打招呼后新开闲聊树，重启仍不带出旧工作",
    history: [{user: "刚处理的任务是 OLD-WORK-482，35 条认领已经取消。", assistant: "已经处理完了。"}],
    events: [
        {user: "我现在只是在打招呼，不是继续工作。请新开一个闲聊话题。", expect: {noCalls: [{tool: "workspace_git"}]}},
        {restart: true},
        {user: "今天过得怎么样", score: {reply: "自然回应日常闲聊，不带出 OLD-WORK-482、35 条认领或取消任务。",
            context: [{label: "本轮闲聊", contains: "今天过得怎么样", role: "user"},
                {label: "用户对话题的明确纠正", contains: "请新开一个闲聊话题", role: "user", critical: true}]},
            expect: {notReply: /OLD-WORK|35|认领|取消任务/, noCalls: [{tool: "workspace_git"}]}},
    ],
});
