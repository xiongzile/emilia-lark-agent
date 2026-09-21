import {conversation} from "../../support/agent-fixture.mjs";
import {mockWebSearch} from "../../support/web-search.mjs";

// agent/session.ts: routing errors cannot cut the referent out of the main model's input.
conversation({
    name: "路由服务故障，隐含追问仍带上之前的名称完成搜索",
    routerUnavailable: true,
    history: [{user: "OrionBench-731 是什么？", assistant: "还不确定，需要查询资料。"}],
    tools: [mockWebSearch("OrionBench", {
        title: "OrionBench-731", url: "https://example.org/orionbench-731",
        content: "OrionBench-731 is a task scheduling benchmark maintained by Demo Lab.",
    })],
    events: [{user: "那上网搜一下吧", expect: {
        calls: [{tool: "web_search", query: /OrionBench-731/i}],
        noCalls: [{tool: "web_search", query: /^(?!.*OrionBench).*$/i}], reply: /Demo Lab|调度/,
    }}],
});
