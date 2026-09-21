import {routing} from "../../support/route-fixture.mjs";

// The user's explicit agreement gives a short reply a task meaning; do not force it into chat.
routing({name: "用户约定说继续就执行时，短回复遵守该约定", state: {segmentStart: "history-1"}, history: [
    {user: "准备把 DOC-731 改名为周报，等我说继续再执行。", assistant: "等你确认后修改。"},
    {user: "为什么猫喜欢纸箱？", assistant: "狭小空间给猫安全感。"},
], cases: [
    {user: "继续", expect: {mode: "task", history: "recall"}},
]});
