import {Agent, type AgentTool} from "@earendil-works/pi-agent-core";
import {createModels} from "@earendil-works/pi-ai";
// @ts-ignore
import {deepseekProvider} from "@earendil-works/pi-ai/providers/deepseek";
import {larkCliTool} from "../tools/lark-cli.ts";
import {workspaceFilesTool} from "../tools/workspace-files.ts";
import {workspaceGitTool} from "../tools/workspace-git.ts";
import {createConfiguredCliTools} from "../tools/configured-cli.ts";
import {createWebSearchTool} from "../tools/web-search.ts";
import {localAgentConfig} from "../config/local.ts";
import {emiliaSystemPrompt} from "../prompts/emilia.ts";
import {MemoryDistiller} from "../memory/distill.ts";
import {type MemoryStore} from "../memory/store.ts";
import {createMemoryTool} from "../memory/tool.ts";

export function createDeepSeekAgent(memory: MemoryStore, tools?: AgentTool[]) {
    const models = createModels();

    models.setProvider(deepseekProvider());

    const modelId = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
    const model = models.getModel("deepseek", modelId);
    if (!model) {
        const available = models.getModels("deepseek").map((item) => item.id).join(", ");
        throw new Error(`Unknown DeepSeek model '${modelId}'. Available models: ${available}`);
    }

    const availableTools = tools ?? (() => {
        const webSearchTool = createWebSearchTool();
        return [
            createMemoryTool(memory),
            larkCliTool,
            workspaceFilesTool,
            workspaceGitTool,
            ...(webSearchTool ? [webSearchTool] : []),
            ...createConfiguredCliTools(localAgentConfig.commandTools ?? []),
        ];
    })();
    const systemPrompt = [emiliaSystemPrompt, localAgentConfig.prompt]
        .filter(Boolean)
        .join("\n\n");

    const agent = new Agent({
        initialState: {
            systemPrompt,
            model,
            tools: availableTools,
        },

        streamFn: models.streamSimple.bind(models),
    });

    agent.subscribe((event) => {
        if (event.type === "tool_execution_start") {
            console.log(`\n[Tool start] ${event.toolName}`, event.args);
        }

        if (event.type === "tool_execution_end") {
            console.log(`[Tool end] ${event.toolName}`, event.isError ? "failed" : "succeeded");
        }

        if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
        ) {
            process.stdout.write(
                event.assistantMessageEvent.delta,
            );
        }

        if (
            event.type === "message_end" &&
            event.message.role === "assistant"
        ) {
            const usage = event.message.usage;
            const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
            const cacheHitRate = promptTokens === 0
                ? 0
                : usage.cacheRead / promptTokens;

            console.log("\n[DeepSeek usage]", {
                promptTokens,
                cacheHitTokens: usage.cacheRead,
                cacheMissTokens: usage.input,
                cacheWriteTokens: usage.cacheWrite,
                cacheHitRate: `${(cacheHitRate * 100).toFixed(1)}%`,
                outputTokens: usage.output,
            });

            if (event.message.stopReason === "error") {
                console.error(
                    "LLM error:",
                    event.message.errorMessage,
                );
            }
        }
    });

    return {agent, distiller: new MemoryDistiller(memory, models, model)};
}
