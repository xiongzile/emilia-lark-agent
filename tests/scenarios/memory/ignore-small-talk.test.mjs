import {conversation} from "../../support/agent-fixture.mjs";

// src/memory/distill.ts：没有长期价值的闲聊不生成记忆。
conversation({
    name: "一次晚饭闲聊不会变成用户偏好或长期记忆",
    events: [
        {user: "今晚吃什么比较好？"},
        {distill: true, expect: {memory: [{absent: true}]}},
    ],
});
