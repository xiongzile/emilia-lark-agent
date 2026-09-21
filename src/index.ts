import {createDeepSeekAgent} from "./agent/deepseek.ts";
import {
    type FeishuTextMessage,
    type FeishuStreamWriter,
    replyFeishu,
    showFeishuProcessing,
    startFeishu,
    streamFeishuReply,
} from "./channels/feishu.ts";
import {currentRuntimeContext} from "./prompts/runtime.ts";

const agent = createDeepSeekAgent();
let pending = Promise.resolve();

function lastAssistantText(messageStart: number): string {
    for (let index = agent.state.messages.length - 1; index >= messageStart; index -= 1) {
        const message = agent.state.messages[index];
        if (message.role !== "assistant") continue;

        return message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("")
            .trim();
    }

    return "";
}

async function promptAgent(
    text: string,
    write?: FeishuStreamWriter,
): Promise<string> {
    const messageStart = agent.state.messages.length;
    let streamedText = "";
    let separateNextAssistantMessage = false;

    const unsubscribe = write ? agent.subscribe(async (event) => {
        if (event.type === "message_start" && event.message.role === "assistant") {
            separateNextAssistantMessage = streamedText.length > 0;
            return;
        }

        if (
            event.type !== "message_update" ||
            event.assistantMessageEvent.type !== "text_delta"
        ) return;

        if (separateNextAssistantMessage) {
            streamedText += "\n\n";
            separateNextAssistantMessage = false;
        }
        streamedText += event.assistantMessageEvent.delta;
        await write(streamedText);
    }) : undefined;

    try {
        // Append runtime data once per user turn. Keeping it out of the leading
        // system message preserves DeepSeek's prefix cache across tool calls.
        await agent.prompt({
            role: "user",
            content: [
                {type: "text", text: currentRuntimeContext()},
                {type: "text", text},
            ],
            timestamp: Date.now(),
        });
    } finally {
        unsubscribe?.();
        process.stdout.write("\n");
    }

    const reply = lastAssistantText(messageStart);
    if (!reply) {
        throw new Error("Agent completed without a text reply");
    }

    // 工具调用前的过程话术只在生成期间展示；完成后卡片收敛为最终回答。
    await write?.(reply);
    return reply;
}

async function processMessage({messageId, chatId, text}: FeishuTextMessage): Promise<void> {
    console.log("\nFeishu:", text);
    const dismissProcessing = showFeishuProcessing(messageId);
    let promptStarted = false;

    try {
        try {
            await streamFeishuReply(chatId, messageId, async (write) => {
                // producer 被调用时初始卡片已经可见，可以撤下短暂的表情回执。
                await dismissProcessing();
                promptStarted = true;
                await promptAgent(text, write);
            });
            console.log("[Feishu streamed]", messageId);
            return;
        } catch (error) {
            if (promptStarted) {
                // 流式卡片已经存在，SDK 会在卡片内显示生成中断。
                console.error("Agent streaming error:", error);
                return;
            }
            console.warn("Feishu streaming unavailable, falling back to post reply:", error);
        }

        const reply = await promptAgent(text);
        await replyFeishu(messageId, reply);
        console.log("[Feishu replied]", messageId);
    } finally {
        await dismissProcessing();
        console.log("[Agent done] Waiting for the next message.");
    }
}

async function replyWithError(messageId: string, error: unknown): Promise<void> {
    console.error("Agent error:", error);
    try {
        await replyFeishu(messageId, "处理失败，请稍后重试；详细错误已记录在服务终端。\n");
    } catch (replyError) {
        console.error("Feishu error reply failed:", replyError);
    }
}

startFeishu((message) => {
    console.log("[Agent queued]", message.text);
    // Agent.prompt 不支持并发；上一条完成后再处理下一条。
    pending = pending
        .then(() => processMessage(message))
        .catch((error) => replyWithError(message.messageId, error));
}).catch((error) => {
    console.error("Feishu startup error:", error);
    process.exitCode = 1;
});
