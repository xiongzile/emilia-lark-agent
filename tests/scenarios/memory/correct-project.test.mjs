import {conversation} from "../../support/agent-fixture.mjs";

// src/memory/distill.ts、store.ts、src/agent/session.ts：纠正后自动回忆；workspace-git.ts：工作区参数映射。
conversation({
    name: "仓库别名纠正后，旧对话移出近期窗口也不会记错",
    events: [
        {user: "记住：pi 是 mobile 仓库。"},
        {distill: true},
        {user: "纠正一下，我刚才说错了：pi 指当前 agent 工程，不是 mobile 仓库。以后按这个理解。"},
        {distill: true},
        {ageRecentTurns: 20},
        {restart: true, expect: {memory: [
            {category: "project", status: "active", text: /pi.*agent/i},
            {category: "project", status: "active", text: /^pi\s*(是|指)\s*mobile/i, absent: true},
        ]}},
        {user: "pi 是 mobile 仓库吗？只回答“是”或“否”。", expect: {reply: /^否[。.!！\s]*$/}},
        {user: "请只读查看 pi 仓库最近一次 Git 提交的标题，告诉我标题里的标记。不要猜。",
            expect: {
                reply: /AGENT-MEMORY-731/i,
                calls: [{tool: "workspace_git", workspace: "agent", startsWith: ["log"]}],
                noCalls: [{tool: "workspace_git", workspace: "mobile"}],
            }},
    ],
});
