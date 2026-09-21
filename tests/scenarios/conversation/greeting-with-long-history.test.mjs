import {conversation} from "../../support/agent-fixture.mjs";

// src/agent/context-selector.ts：完整近期窗口里有大量工作，也不因问候汇报旧事。
conversation({
    name: "近期窗口塞满工作记录，晚上好仍然只是问候",
    requiresJev: true,
    history: Array.from({length: 20}, (_, index) => ({
        user: `检查项目 ${index} 的构建配置、依赖和提交记录。`,
        assistant: `项目 ${index} 已检查。${"依赖版本一致，构建配置已核对，提交记录可追溯。".repeat(15)}还需要确认是否创建合并请求。`,
    })),
    events: [{user: "晚上好", expect: {
        context: {mode: "chat", excludes: Array.from({length: 20}, (_, i) => `history-${i + 1}`)},
        notReply: /构建|依赖|提交|合并|项目|任务|有什么.{0,12}(帮|处理)|需要.{0,12}(帮忙|处理)/,
        noCalls: [{tool: "memory"}, {tool: "workspace_git"}],
    }}],
});
