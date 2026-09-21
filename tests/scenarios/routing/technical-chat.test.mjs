import {routing} from "../../support/route-fixture.mjs";

// Talking about architecture or tools is not itself an instruction to execute them.
routing({name: "讨论工具和技术架构仍然是聊天", cases: [
    {user: "Jev 适合拿来做对话模式分类吗？", expect: {mode: "chat", history: "new"}},
    {user: "R8 和 Redex 有什么区别？", expect: {mode: "chat", history: "new"}},
    {user: "如果把 agent 写成 C++，你觉得架构会怎样？先讨论，不改代码。", expect: {mode: "chat", history: "new"}},
    {user: "用 CLI 提 MR 和手动提，设计上有什么不同？", expect: {mode: "chat", history: "new"}},
]});
