import {routing} from "../../support/route-fixture.mjs";

// A greeting prefix must not hide the actual request.
routing({name: "问候加实质请求按请求处理", cases: [
    {user: "晚上好呀爱蜜莉雅，帮我查一下 agent 仓库最新提交。", expect: {mode: "task"}},
    {user: "嗨，把 DOC-731 的标题改成周报。", expect: {mode: "task"}},
    {user: "你好，你知道 R8 和 Redex 有什么区别吗？", expect: {mode: "chat"}},
    {user: "晚上好，继续之前那个 MR，目标分支用 develop，现在创建。", expect: {mode: "task"}},
]});
