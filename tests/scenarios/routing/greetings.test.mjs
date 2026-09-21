import {routing} from "../../support/route-fixture.mjs";

// conversation.ts: names, particles and languages still make a standalone greeting.
routing({name: "问候的自然变体都能开启新对话", cases: [
    {user: "晚上好呀爱蜜莉雅", expect: {mode: "greet", history: "new"}},
    {user: "嗨，艾米莉亚～", expect: {mode: "greet", history: "new"}},
    {user: "哈喽，Emilia", expect: {mode: "greet", history: "new"}},
    {user: "Good evening, Emilia!", expect: {mode: "greet", history: "new"}},
    {user: "那我先去睡啦，晚安爱蜜莉雅", expect: {mode: "greet", history: "new"}},
]});
