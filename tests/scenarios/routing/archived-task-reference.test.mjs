import {routing} from "../../support/route-fixture.mjs";

// The classifier can see earlier work, but unqualified continuation stays on current chat.
routing({name: "看见旧任务仍区分继续聊天和恢复刚才的任务", state: {segmentStart: "history-1",
    taskContext: {name: "准备修改文档", messageIds: ["history-0"]}}, history: [
    {user: "准备把 DOC-731 改名为周报，暂时不要执行。", assistant: "先放着。"},
    {user: "为什么猫喜欢纸箱？", assistant: "狭小空间给猫安全感。"},
], cases: [
    {user: "继续刚才的任务，按之前说的执行吧", expect: {mode: "task", history: "recall"}},
    {user: "刚才准备改的那份文档，再查一下它的标题", expect: {mode: "task", history: "recall"}},
    {user: "那它们为什么喜欢晒太阳？", expect: {mode: "chat", history: "current"}},
    {user: "继续", expect: {mode: "chat", history: "current"}},
]});
