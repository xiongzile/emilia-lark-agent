import {routing} from "../../support/route-fixture.mjs";

// The earlier three-turn window hid this request; the ten-turn window includes it.
routing({name: "任务移出最近三轮后，十轮窗口仍能识别恢复任务", state: {
    segmentStart: "history-1",
    taskContext: {name: "创建 MR", messageIds: ["history-0"]},
}, history: [
    {user: "我要创建 MR，标题 chore: routing demo。目标分支等我补充后再创建。", assistant: "等你提供目标分支。"},
    {user: "聊聊猫吧", assistant: "猫喜欢找暖和的地方待着。"},
    {user: "确实，我的猫最喜欢纸箱", assistant: "纸箱对猫来说很有安全感。"},
    {user: "它现在睡着了", assistant: "那就让它好好睡一觉。"},
], cases: [
    {user: "刚才那个 MR，目标分支用 develop，执行吧。", expect: {mode: "task", history: "recall"}},
]});
