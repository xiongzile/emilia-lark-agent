import type {Agent} from "@earendil-works/pi-agent-core";
import {currentRuntimeContext} from "../prompts/runtime.ts";
import type {CompactContext} from "./context.ts";

type StreamWriter = (content: string) => Promise<void>;

function lastAssistantText(agent: Agent): string {
    for (let index = agent.state.messages.length - 1; index >= 0; index -= 1) {
        const message = agent.state.messages[index];
        if (message.role === "user") break;
        if (message.role !== "assistant") continue;
        if (message.stopReason === "error" || message.stopReason === "aborted") return "";

        return message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("")
            .trim();
    }

    return "";
}

export async function promptAgent(agent: Agent, text: string, write?: StreamWriter,
    {includeRuntime = true, context, treeContext, compact}: {
        includeRuntime?: boolean; context?: string; treeContext?: string; compact?: CompactContext;
    } = {}): Promise<string> {
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
        // Keep per-turn runtime data after the stable system prompt for cache reuse.
        const message = {
            role: "user" as const,
            content: [
                ...(context ? [{type: "text" as const, text: context}] : []),
                ...(includeRuntime ? [{type: "text" as const, text: currentRuntimeContext()}] : []),
                ...(treeContext ? [{type: "text" as const, text: treeContext}] : []),
                {type: "text" as const, text: `用户当前消息：\n${text}`},
            ],
            timestamp: Date.now(),
        };
        if (compact) agent.state.messages = (await compact([...agent.state.messages, message])).slice(0, -1);
        await agent.prompt(message);
    } finally {
        unsubscribe?.();
        process.stdout.write("\n");
    }

    const reply = lastAssistantText(agent);
    if (!reply) throw new Error("Agent completed without a text reply");

    // Intermediate text stays visible only while generating; finish with the final answer.
    await write?.(reply);
    return reply;
}
