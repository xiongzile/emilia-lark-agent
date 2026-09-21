import {conversation} from "../../support/agent-fixture.mjs";

// agent/conversation.ts: a greeting embedded in a request is not classified by prefix alone.
conversation({
    name: "问候里同时有工作请求时仍执行真实的只读 Git 查询",
    events: [{user: "你好，帮我查一下 agent 仓库最新提交标题。", expect: {
        calls: [{tool: "workspace_git", workspace: "agent", startsWith: ["log"]}], reply: /AGENT-MEMORY-731/,
    }}],
});
