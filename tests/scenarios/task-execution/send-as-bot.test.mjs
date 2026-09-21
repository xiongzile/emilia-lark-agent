import {conversation} from "../../support/agent-fixture.mjs";
import {mockCommand} from "../../support/chat-simulator.mjs";

// src/prompts/emilia.ts：遵循用户指定的身份和范围。验证工具调用，不验证飞书服务。
const message = "会议改到明天 14:00，请查收日历邀请。";
const recipient = "ou_fixture_colleague";

conversation({
    name: "用户指定收件人、内容和 bot 身份后，发送一次",
    tools: [mockCommand({
        name: "lark_cli",
        description: "Send a Lark message with args: im +send --as bot --receive-id <open_id> --text <message>. A successful result means the message was sent.",
        rules: [{startsWith: ["im", "+send"], result: {messageId: "om_fixture_sent"}}],
    })],
    events: [
        {user: `用爱蜜莉雅 bot 身份给同事 ${recipient} 发这条飞书消息：“${message}” 现在发。`,
            expect: {
                reply: /已发|发送成功|发出/,
                calls: [{tool: "lark_cli", args: ["im", "+send", "--as", "bot", "--receive-id", recipient, "--text", message], count: 1}],
            }},
    ],
});
