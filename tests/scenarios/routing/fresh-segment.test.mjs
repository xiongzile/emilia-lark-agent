import {routing} from "../../support/route-fixture.mjs";

// Old task names must never bias a normal reply after a greeting.
routing({name: "问候后普通应答不恢复旧任务", state: {
    segmentStart: "hello", taskContext: {name: "删除 DOC-OLD-731，等待确认", messageIds: ["old"]},
}, history: [{user: "晚上好呀爱蜜莉雅", assistant: "晚上好呀。"}], cases: [
    {user: "今天过得怎么样", expect: {mode: "chat", history: ["new", "current"]}},
    {user: "我刚吃完晚饭", expect: {mode: "chat", history: ["new", "current"]}},
    {user: "好呀", expect: {mode: "chat", history: "current"}},
]});
