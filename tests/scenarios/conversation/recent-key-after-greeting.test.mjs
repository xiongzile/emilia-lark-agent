import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// session.ts: an uncertain mode must not hide the latest key behind a greeting.
conversation({
    name: "旧取消任务干扰下，查询新 key、问候、重启及路由故障后仍查询新 key 的认领",
    history: [
        {user: "取消旧项目 OLD-482 的 35 个认领。", assistant: "认领人是 alex，需要同事授权证明，我不能执行。"},
        {user: "我已确认取消。", assistant: "已取消，复查为 0 条。"},
    ],
    tools: [mockCommand({name: "localization", description: "Read current localization data: args [info, key] or [claims, key].",
        rules: [
            {startsWith: ["info", "checkout_delivery_note"], result: {key: "checkout_delivery_note", project: "SHOP-731", published: true}},
            {startsWith: ["claims", "checkout_delivery_note"], result: {key: "checkout_delivery_note", claimed: false, count: 0}},
        ]})],
    events: [
        {user: "检查 checkout_delivery_note 这个 key 的发布状态。", expect: {calls: [{tool: "localization", args: ["info", "checkout_delivery_note"], count: 1}]}},
        {user: "干得不错，谢谢！", expect: {noCalls: [{tool: "localization"}]}},
        {user: "下午好", expect: {notReply: /OLD-482|SHOP-731|认领|checkout_delivery_note/}},
        {restart: true},
        {routerUnavailable: true},
        {user: "接着刚才的那个 key，你能查到这个 key 的认领状态吗", score: {
            reply: "查询 checkout_delivery_note 的当前认领状态并告诉用户未认领、数量 0；不混入旧项目 OLD-482 的 35 条认领，不要求授权证明或再次确认查询。",
            context: [
                {label: "本轮请求", contains: "接着刚才的那个 key", role: "user"},
                {label: "最近的 key 原话", contains: "检查 checkout_delivery_note", role: "user", critical: true},
                {label: "真实查询结果", contains: ["checkout_delivery_note", "SHOP-731"], role: "tool", critical: true},
            ],
        }, expect: {
            calls: [{tool: "localization", args: ["claims", "checkout_delivery_note"], count: 1}, {tool: "localization", count: 1}],
            notReply: /同事授权|OLD-482|35 个|35 条|认领人是.*alex/,
        }},
    ],
});
