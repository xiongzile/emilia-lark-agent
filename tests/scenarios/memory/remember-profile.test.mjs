import {conversation} from "../../support/agent-fixture.mjs";

// src/memory/distill.ts、store.ts、src/agent/session.ts：提炼、持久化和自动回忆。
conversation({
    name: "记住工作职责，重启后仍能回答并保留来源",
    events: [
        {id: "profile-1", user: "请记住：我负责 Android 构建性能优化。",
            expect: {notReply: /没有.{0,8}持久化|没有.{0,8}保存|只在.{0,12}(本轮|当前对话)/}},
        {distill: true, expect: {memory: [{category: "profile", status: "active", text: /Android.*构建|构建.*Android/, sources: ["profile-1"]}]}},
        {restart: true},
        {user: "我主要负责什么工作？", expect: {reply: /Android.*构建|构建.*Android/}},
    ],
});
