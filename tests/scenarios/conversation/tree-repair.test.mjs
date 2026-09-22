import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// context_tree: user feedback searches original branches, not a verbal promise to remember.
conversation({
    name: "用户指出丢上下文，沿树找回先前文档并完成只读查询",
    tools: [mockCommand({name: "documents", description: "Read document title: args [title, id].",
        rules: [{args: ["title", "DOC-TREE-731"], result: {id: "DOC-TREE-731", title: "团队周报"}}]})],
    events: [
        {user: "/tree new 文档标题"},
        {user: "这次要看的文档是 DOC-TREE-731，先记下，还不用查询。", expect: {noCalls: [{tool: "documents"}]}},
        {user: "/tree new 闲聊"},
        {user: "你好呀", expect: {notReply: /DOC-TREE-731|团队周报/}},
        {user: "你把刚才文档的上下文弄丢了，去树里找回来，再查一下那份文档现在的标题。",
            route: {mode: "task", branch: "current", source: "jev", elapsedMs: 0},
            score: {reply: "用户明确要求恢复上下文并查询。通过上下文树找回 DOC-TREE-731，实际查询标题并回答团队周报，不要求用户重新提供 ID。",
                context: [{label: "恢复指令完整可见", contains: ["去树里找回来", "现在的标题"], role: "user"}]},
            expect: {calls: [{tool: "context_tree"}, {tool: "documents", args: ["title", "DOC-TREE-731"], count: 1}], reply: /团队周报/}},
    ],
});
