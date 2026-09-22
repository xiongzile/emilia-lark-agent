import {routing} from "../../support/route-fixture.mjs";

// Choosing, correcting and confirming parameters must not start an unrelated conversation.
routing({name: "任务里的短指代和纠正保留参数上下文", history: [
    {user: "准备创建 MR，标题 chore: reference。第一个目标分支 develop，第二个 release，等我确认再执行。", assistant: "你选哪个目标分支？"},
], cases: [
    {user: "第一个，执行吧", expect: {mode: "task"}},
    {user: "不是，我说的是第二个", expect: {mode: "task"}},
    {user: "继续刚才的任务，目标分支选第二个", expect: {mode: "task"}},
    {user: "先别执行，等我确认", expect: {mode: "task"}},
]});
