import {routing} from "../../support/route-fixture.mjs";

// Similar-looking continuation words can refer to conversation rather than execution.
routing({name: "聊天里的指代词和比较继续当前话题", history: [
    {user: "Jev 是 TypeSafe 做结构化判断的模型。", assistant: "它适合分类；我们可以聊延迟，也可以聊上下文边界。"},
], cases: [
    {user: "那它有什么限制？", expect: {mode: "chat"}},
    {user: "第一个吧", expect: {mode: "chat"}},
    {user: "继续", expect: {mode: "chat"}},
    {user: "那和 DeepSeek 比呢？", expect: {mode: "chat"}},
    {user: "帮我查查它的官方说明", expect: {mode: "task"}},
]});
