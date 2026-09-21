import * as Lark from "@larksuiteoapi/node-sdk";
import {createHash} from "node:crypto";
import {feishuConfig} from "../config/feishu.ts";

export interface FeishuTextMessage {
    messageId: string;
    chatId: string;
    text: string;
}

export type FeishuStreamWriter = (content: string) => Promise<void>;

const replyChunkSize = 6000;
const feishuChannel = Lark.createLarkChannel({
    ...feishuConfig,
    safety: {
        chatQueue: {enabled: false},
        batch: {text: {delayMs: 0}},
    },
    policy: {
        dmMode: "open",
        requireMention: true,
        respondToMentionAll: false,
    },
    outbound: {
        streamInitialText: "**爱蜜莉雅正在想…**\n<font color='grey'>稍等我一下。</font>",
        streamThrottleMs: 100,
        streamThrottleChars: 24,
    },
});
const restClient = feishuChannel.rawClient;

function splitReply(text: string): string[] {
    const characters = Array.from(text);
    const chunks: string[] = [];

    for (let index = 0; index < characters.length; index += replyChunkSize) {
        chunks.push(characters.slice(index, index + replyChunkSize).join(""));
    }

    return chunks.length > 0 ? chunks : ["Agent 没有返回文本内容。"];
}

function replyUuid(messageId: string, index: number, text: string): string {
    return createHash("sha256")
        .update(`${messageId}:${index}:${text}`)
        .digest("hex")
        .slice(0, 32);
}

export async function replyFeishu(messageId: string, text: string): Promise<void> {
    const chunks = splitReply(text);

    for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const prefix = chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n` : "";
        const response = await restClient.im.v1.message.reply({
            path: {message_id: messageId},
            data: {
                msg_type: "post",
                content: JSON.stringify({
                    zh_cn: {
                        content: [[{
                            tag: "md",
                            text: `${prefix}${chunk}`,
                        }]],
                    },
                }),
                uuid: replyUuid(messageId, index, chunk),
            },
        });

        if (response.code !== 0 || !response.data?.message_id) {
            throw new Error(
                `Feishu reply failed: code=${response.code ?? "unknown"} message=${response.msg ?? "unknown"}`,
            );
        }
    }
}

export function showFeishuProcessing(messageId: string): () => Promise<void> {
    let dismissed = false;
    const reaction = feishuChannel.addReaction(messageId, "Typing")
        .then((reactionId) => {
            console.log("[Feishu processing reaction added]", messageId);
            return reactionId;
        })
        .catch((error) => {
            console.warn("Feishu processing reaction failed:", error);
            return undefined;
        });

    return async () => {
        if (dismissed) return;
        dismissed = true;

        const reactionId = await reaction;
        if (!reactionId) return;

        try {
            await feishuChannel.removeReaction(messageId, reactionId);
            console.log("[Feishu processing reaction removed]", messageId);
        } catch (error) {
            console.warn("Feishu processing reaction removal failed:", error);
        }
    };
}

export async function streamFeishuReply(
    chatId: string,
    messageId: string,
    producer: (write: FeishuStreamWriter) => Promise<void>,
): Promise<void> {
    await feishuChannel.stream(
        chatId,
        {
            markdown: async (controller) => {
                await producer((content) => controller.setContent(content));
            },
        },
        {replyTo: messageId},
    );
}

export async function startFeishu(
    onText: (message: FeishuTextMessage) => void,
): Promise<void> {
    feishuChannel.on({
        message: (message) => {
            console.log("[Feishu received]", message.messageId, message.rawContentType);
            if (message.rawContentType !== "text") {
                console.log("[Feishu skipped] Unsupported message type:", message.rawContentType);
                return;
            }

            const text = message.content;
            if (!text.trim()) return;

            // 入队后立即返回，让 SDK 确认事件，不等待模型生成完毕。
            onText({
                messageId: message.messageId,
                chatId: message.chatId,
                text,
            });
        },
        reject: (event) => {
            console.log("[Feishu skipped]", event.messageId, event.reason);
        },
        error: (error) => {
            console.error("Feishu channel error:", error);
        },
    });

    await feishuChannel.connect();
}
