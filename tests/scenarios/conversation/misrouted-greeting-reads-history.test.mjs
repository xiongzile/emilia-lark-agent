import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// A mode hint is not a semantic command; a task can recover from the cleanest view.
conversation({
    name: "实际查询被误判为问候，仍按当前请求找回任务并查询状态",
    history: [{user: "我们看的 MR 是 REVIEW-583，先别批准。", assistant: "好的。"}],
    tools: [mockCommand({name: "reviews", description: "Read MR status: args [status, MR id].",
        rules: [{startsWith: ["status", "REVIEW-583"], result: {id: "REVIEW-583", status: "open", checks: "passed"}}]})],
    events: [{user: "你好，帮我看下刚才那个 MR 的当前状态", route: {mode: "greet", source: "jev", elapsedMs: 0}, expect: {
        calls: [{tool: "context_tree"}, {tool: "reviews", args: ["status", "REVIEW-583"], count: 1}, {tool: "reviews", count: 1}],
        reply: /open|开放|未合并/,
    }}],
});
