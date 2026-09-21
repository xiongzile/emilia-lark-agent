import {conversation} from "../../support/agent-fixture.mjs";

// src/tools/configured-cli.ts、native/workspace_search.cpp：真实 CLI 搜索链路。
conversation({
    name: "调用 C++ 搜索工具，找到源码中符号的真实位置",
    files: [{path: "src/native_marker.ts", content: "export const ROUTE_NATIVE_812 = true;\n"}],
    tools: ["search"],
    events: [
        {user: "请在当前 agent 工程源码里查 ROUTE_NATIVE_812 定义在哪个文件。用搜索工具确认，不要猜。",
            expect: {
                reply: /src\/native_marker\.ts/,
                calls: [{tool: "workspace_search", workspace: "agent", startsWith: ["ROUTE_NATIVE_812"]}],
            }},
    ],
});
