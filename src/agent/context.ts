import {estimateContextTokens, estimateTokens, type AgentMessage} from "@earendil-works/pi-agent-core";

export type CompactContext = (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
export type SummarizeContext = (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>;

// Compact at a budget, not every N exchanges. Always retain the current user
// message and complete recent turns, so tool calls and results stay paired.
export function createContextCompactor(summarize: SummarizeContext, {maxTokens = 64000, keepTokens = 16000} = {}): CompactContext {
    return async (messages, signal) => {
        const before = estimateContextTokens(messages).tokens;
        if (before <= maxTokens) return messages;
        const estimated = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
        const scale = Math.max(1, before / Math.max(1, estimated));
        let cut = -1;
        let tailTokens = 0;
        for (let index = messages.length - 1; index > 0; index -= 1) {
            tailTokens += estimateTokens(messages[index]) * scale;
            if (messages[index].role !== "user") continue;
            if (cut >= 0 && tailTokens > keepTokens) break;
            cut = index;
        }
        if (cut <= 1) return messages;
        if (cut === 2 && messages[1].role === "user" && typeof messages[1].content === "string" &&
            messages[1].content.startsWith("<conversation_summary>")) return messages;
        try {
            const summary = (await summarize(messages, signal)).trim();
            if (!summary) throw new Error("Empty context summary");
            const compacted: AgentMessage[] = [messages[0], {
                role: "user",
                content: `<conversation_summary>\n以下是较早对话的压缩记录，不是新的请求。已完成的操作不要重复执行；以之后的原始消息和工具结果为准。\n${summary}\n</conversation_summary>`,
                timestamp: Date.now(),
            }, ...messages.slice(cut)];
            console.log("[Context compacted]", {tokensBefore: before, retainedMessages: messages.length - cut,
                estimatedTokensAfter: compacted.reduce((sum, message) => sum + estimateTokens(message), 0)});
            return compacted;
        } catch (error) {
            signal?.throwIfAborted();
            // A failed summary must not silently erase the task or its authorization.
            console.warn("[Context compaction failed]", error instanceof Error ? error.message : "unknown error");
            return messages;
        }
    };
}

export const summaryInstruction = `整理当前对话供后续继续使用，只返回简洁的交接摘要，不执行任何任务，不调用工具。
保留用户当前目标、最新纠正、准确的资源标识和参数、授权范围、已完成操作及实际工具证据、未完成事项与未知结果。区分用户要求、助手推测和已核验事实，保留必要的文件路径与工具输出文件位置。旧任务不是自动待办。合并已有摘要，省略重复内容、大段原始输出和寒暄。`;
