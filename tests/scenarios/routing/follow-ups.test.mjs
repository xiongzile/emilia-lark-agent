import {routing} from "../../support/route-fixture.mjs";

// The omitted subject comes from the immediately preceding exchange.
routing({name: "省略名称的追问仍承接当前话题", history: [
    {user: "你知道 Jev 是什么不？", assistant: "你是在什么地方看到的？"},
], cases: [
    {user: "你去网上搜搜看，是最近有人新推出来的 AI 新框架", expect: {mode: "task"}},
    {user: "那它能做什么呢？", expect: {mode: "chat"}},
    {user: "帮我查一下它的官方文档", expect: {mode: "task"}},
]});
