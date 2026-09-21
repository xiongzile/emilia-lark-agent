import {conversation} from "../../support/agent-fixture.mjs";

// src/agent/context-selector.ts、session.ts：任务里的短句要保留选项并执行真实只读工具。
conversation({
    name: "查仓库时说第一个，能带回选项并查对仓库",
    requiresJev: true,
    history: [{id: "repo-options", user: "帮我看最近的提交", assistant: "查哪个仓库？1. agent；2. mobile。"}],
    events: [{user: "第一个就行", expect: {
        context: {mode: "task", includes: ["repo-options"]},
        reply: /AGENT-MEMORY-731/,
        calls: [{tool: "workspace_git", workspace: "agent", startsWith: ["log"], count: 1}],
        noCalls: [{tool: "workspace_git", workspace: "mobile"}],
    }}],
});
