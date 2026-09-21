import {conversation} from "../../support/agent-fixture.mjs";

// src/prompts/emilia.ts、src/tools/workspace-files.ts：纠正目标并验证实际文件落点。
conversation({
    name: "用户纠正仓库后，只修改新指定的 README",
    history: [
        {user: "帮我更新那个 mobile 仓库的 README", assistant: "我会去 mobile 工作区改 README。请说具体内容。"},
    ],
    tools: ["files"],
    events: [
        {user: "纠正一下：不是 mobile，是 pi，也就是当前 agent 工程。请在它的 README.md 末尾加一行 `OWNER-CHECK-731`，直接改。",
            expect: {
                calls: [{tool: "workspace_files", workspace: "agent", operation: "write", path: "README.md", count: 1}],
                noCalls: [{tool: "workspace_files", workspace: "mobile"}],
                files: [
                    {workspace: "agent", path: "README.md", contains: /AGENT-MEMORY-731[\s\S]*OWNER-CHECK-731/},
                    {workspace: "mobile", path: "README.md", notContains: /OWNER-CHECK-731/},
                ],
            }},
    ],
});
