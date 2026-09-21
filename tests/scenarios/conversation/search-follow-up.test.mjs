import {conversation} from "../../support/agent-fixture.mjs";
import {mockWebSearch} from "../../support/web-search.mjs";

// agent/session.ts: an implicit follow-up must carry its subject into the actual search call.
conversation({
    name: "上一句说 Jev，下一句让搜索时查询词仍包含 Jev",
    history: [{user: "你知道 jev 是什么不", assistant: "这个缩写可能有很多含义，你是在哪看到的？"}],
    tools: [mockWebSearch("Jev", {
        title: "Introducing System One Models & Jev", url: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
        content: "TypeSafe AI introduced Jev, its first System One model. It returns typed decisions and probabilities rather than generated text.",
    })],
    events: [{user: "你去网上搜搜看，是最近有人新推出来的 ai 新框架", expect: {
        calls: [{tool: "web_search", query: /jev/i}],
        noCalls: [{tool: "web_search", query: /^(?!.*jev).*$/i}],
        reply: /TypeSafe/i,
        notReply: /没搜到|没有找到|先确认|拼写/,
    }}],
});
