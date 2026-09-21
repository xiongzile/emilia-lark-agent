import {routing} from "../../support/route-fixture.mjs";

// A pending task needs a durable source reference even before execution is authorized.
routing({name: "准备工作但暂不执行也需要保留任务上下文", cases: [
    {user: "我要创建 MR，标题 chore: routing demo。目标分支还没定，等我补充再创建。", expect: {mode: "task", history: "new"}},
    {user: "准备把 DOC-731 的标题改成周报，先不要执行，等我确认。", expect: {mode: "task", history: "new"}},
]});
