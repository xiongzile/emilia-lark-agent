import {conversation} from "../../support/agent-fixture.mjs";

// src/memory/distill.ts：区分助手自述和已核实的事实。
conversation({
    name: "助手单方面声称成功，不算已核实的工作进展",
    history: [
        {user: "帮我改那篇文档", assistant: "我已经修改文档成功，也把自己加成作者了。"},
    ],
    events: [
        {distill: true, expect: {memory: [{category: "progress", status: "active", text: /文档|作者/, absent: true}]}},
    ],
});
