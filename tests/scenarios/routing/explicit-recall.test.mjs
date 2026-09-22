import {routing} from "../../support/route-fixture.mjs";

// Recall works from the user's intent without exposing archived names to the classifier.
routing({name: "主动提起旧事才恢复之前的聊天或任务",
    history: [{user: "晚上好", assistant: "晚上好呀。"}], cases: [
        {user: "刚才我们在处理哪个任务？", expect: {mode: "chat"}},
        {user: "接着之前那个 Jev 的架构聊吧", expect: {mode: "chat"}},
        {user: "继续之前那个 MR，目标分支用 develop，执行吧", expect: {mode: "task"}},
        {user: "回到上次取消认领那件事，再查一下现在的状态", expect: {mode: "task"}},
    ],
});
