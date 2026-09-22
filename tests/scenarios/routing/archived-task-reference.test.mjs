import {routing} from "../../support/route-fixture.mjs";

// Both topics are visible; each follow-up identifies the intended topic.
routing({name: "看见旧任务仍能区分明确的任务续接和聊天追问", history: [
    {user: "准备把 DOC-731 改名为周报，暂时不要执行。", assistant: "先放着。"},
    {user: "为什么猫喜欢纸箱？", assistant: "狭小空间给猫安全感。"},
], cases: [
    {user: "继续刚才的任务，按之前说的执行吧", expect: {mode: "task"}},
    {user: "刚才准备改的那份文档，再查一下它的标题", expect: {mode: "task"}},
    {user: "那它们为什么喜欢晒太阳？", expect: {mode: "chat"}},
]});
