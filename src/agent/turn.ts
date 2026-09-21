import type {Agent} from "@earendil-works/pi-agent-core";
import {currentRuntimeContext} from "../prompts/runtime.ts";

type StreamWriter = (content: string) => Promise<void>;

function lastAssistantText(agent: Agent, messageStart: number): string {
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

export async function promptAgent(agent: Agent, text: string, write?: StreamWriter,
    {includeRuntime = true}: {includeRuntime?: boolean} = {}): Promise<string> {
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
        // Keep per-turn runtime data after the stable system prompt for cache reuse.
        await agent.prompt({
            role: "user",
            content: [
                ...(includeRuntime ? [{type: "text" as const, text: currentRuntimeContext()}] : []),
                {type: "text", text: `用户当前消息：\n${text}`},
            ],
            timestamp: Date.now(),
        });
    } finally {
        unsubscribe?.();
        process.stdout.write("\n");
    }

    const reply = lastAssistantText(agent, messageStart);
    if (!reply) throw new Error("Agent completed without a text reply");

    // Intermediate text stays visible only while generating; finish with the final answer.
    await write?.(reply);
    return reply;
}
