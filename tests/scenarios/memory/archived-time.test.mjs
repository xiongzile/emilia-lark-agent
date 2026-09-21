import {conversation} from "../../support/agent-fixture.mjs";

// src/time.ts、src/memory/store.ts：原话时间进入上下文。
conversation({
    name: "历史聊天按北京时间回答，纠正旧回复里的时区错误",
    history: [
        {at: "2026-09-21T10:28:54.790Z", user: "R8 和 Redex 有什么区别？", assistant: "它们是不同的 Android 优化工具。"},
        {at: "2026-09-21T11:05:00.000Z", user: "上次讨论是什么时候？", assistant: "我们在上午 10:28 讨论了 R8 和 Redex。"},
    ],
    events: [
        {user: "我们第一次聊 R8 和 Redex 是北京时间几点？只给出 YYYY-MM-DD HH:mm。",
            expect: {reply: /2026-09-21\s+18:28/}},
    ],
});
