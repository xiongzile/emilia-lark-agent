import {routing} from "../../support/route-fixture.mjs";

// Explicit recall is classified by the request, not by whether its source is still recent.
routing({name: "原任务已经不在最近三轮里，仍能识别恢复任务的意图", state: {
    taskContext: {name: "我要创建 MR，标题 chore: routing demo。目标分支还没定，等我补充再创建。", messageIds: ["old-mr"]},
}, history: [
    {user: "聊聊猫吧", assistant: "猫喜欢找暖和的地方待着。"},
    {user: "确实，我的猫最喜欢纸箱", assistant: "纸箱对猫来说很有安全感。"},
    {user: "它现在睡着了", assistant: "那就让它好好睡一觉。"},
], cases: [
    {user: "刚才那个 MR，目标分支用 develop，执行吧。", expect: {mode: "task", history: "recall"}},
]});
