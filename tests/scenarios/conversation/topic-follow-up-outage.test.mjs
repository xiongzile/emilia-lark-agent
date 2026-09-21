import {conversation} from "../../support/agent-fixture.mjs";
import {mockWebSearch} from "../../support/web-search.mjs";

// New topic state survives restart; a failed router must preserve its implicit search subject.
conversation({
    name: "换到 Jev 话题后重启且分类服务故障，它仍指向 Jev 完成搜索",
    history: [{user: "旧任务是等待确认修改 DOC-OLD-731。", assistant: "等待确认后执行。"}],
    tools: [mockWebSearch("Jev", {title: "Introducing Jev", url: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
        content: "TypeSafe AI introduced Jev, a System One model returning typed decisions and probabilities."})],
    events: [
        {user: "换个话题，讨论 Jev 这个 TypeSafe 的分类模型，先聊用途，不用搜索。", expect: {noCalls: [{tool: "web_search"}], notReply: /DOC-OLD|等待确认/}},
        {restart: true},
        {routerUnavailable: true},
        {user: "那你去网上查查它的官方介绍。", expect: {
            calls: [{tool: "web_search", query: /jev/i}], noCalls: [{tool: "web_search", query: /^(?!.*jev).*$/i}], reply: /TypeSafe/i,
        }},
    ],
});
