import type {AgentSession} from "../agent/session.ts";
import {isMemoryCommand} from "../memory/commands.ts";
import {isTreeCommand} from "../agent/tree-tools.ts";
import type {FeishuTextMessage, FeishuStreamWriter} from "./feishu.ts";

export interface FeishuTransport {
    reply(messageId: string, text: string): Promise<void>;
    processing(messageId: string): () => Promise<void>;
    stream(chatId: string, messageId: string, producer: (write: FeishuStreamWriter) => Promise<void>): Promise<void>;
}

async function replyToMessage(session: AgentSession, transport: FeishuTransport, {messageId, chatId, text}: FeishuTextMessage): Promise<void> {
    const dismiss = transport.processing(messageId);
    let promptStarted = false;

    try {
        if (isMemoryCommand(text) || isTreeCommand(text)) {
            const reply = await session.run(messageId, text);
            await transport.reply(messageId, reply);
            return;
        }

        try {
            await transport.stream(chatId, messageId, async (write) => {
                await dismiss();
                promptStarted = true;
                await session.run(messageId, text, write);
            });
            return;
        } catch (error) {
            if (promptStarted) {
                console.error("Agent streaming error:", error);
                return;
            }
            console.warn("Feishu streaming unavailable, falling back to post reply:", error);
        }

        const reply = await session.run(messageId, text);
        await transport.reply(messageId, reply);
    } finally {
        await dismiss();
    }
}

async function replyWithError(transport: FeishuTransport, messageId: string, error: unknown): Promise<void> {
    console.error("Agent error:", error);
    try {
        await transport.reply(messageId, "处理失败，请稍后重试；详细错误已记录在服务终端。\n");
    } catch (replyError) {
        console.error("Feishu error reply failed:", replyError);
    }
}

export function createFeishuMessageHandler(session: AgentSession, transport: FeishuTransport): (message: FeishuTextMessage) => Promise<void> {
    let pending: Promise<void> = Promise.resolve();

    return (message) => {
        pending = pending
            .then(() => replyToMessage(session, transport, message))
            .catch((error) => replyWithError(transport, message.messageId, error));
        return pending;
    };
}
