import {createTreeRouter} from "./tree-router.ts";
import {Agent, type AgentTool} from "@earendil-works/pi-agent-core";
import {createModels} from "@earendil-works/pi-ai";
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
import {createContextCompactor, summaryInstruction} from "./context.ts";
import {createContextTreeTool} from "./tree-tools.ts";

export function createDeepSeekAgent(memory: MemoryStore, tools?: AgentTool[],
    contextBudget = {maxTokens: 64000, keepTokens: 16000}) {
    const models = createModels();

    models.setProvider(deepseekProvider());

    const modelId = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
    const model = models.getModel("deepseek", modelId);
    if (!model) {
        const available = models.getModels("deepseek").map((item) => item.id).join(", ");
        throw new Error(`Unknown DeepSeek model '${modelId}'. Available models: ${available}`);
    }

    const availableTools = [createContextTreeTool(memory), ...(tools ?? (() => {
        const webSearchTool = createWebSearchTool();
        return [
            createMemoryTool(memory),
            larkCliTool,
            workspaceFilesTool,
            workspaceGitTool,
            ...(webSearchTool ? [webSearchTool] : []),
            ...createConfiguredCliTools(localAgentConfig.commandTools ?? []),
        ];
    })())];
    const systemPrompt = [emiliaSystemPrompt, localAgentConfig.prompt]
        .filter(Boolean)
        .join("\n\n");

    let requestStarted = 0;
    let firstTokenMs: number | undefined;
    const agent = new Agent({
        initialState: {
            systemPrompt,
            model,
            tools: availableTools,
        },

        streamFn: (model, context, options) => {
            requestStarted = performance.now();
            firstTokenMs = undefined;
            return models.streamSimple(model, context, options);
        },
    });

    const compact = createContextCompactor(async (messages, signal) => {
        const response = await models.completeSimple(model, {
            // Keep the same system, tool declarations and conversation prefix.
            messages: [...await agent.convertToLlm(messages), {
                role: "user", content: summaryInstruction, timestamp: Date.now(),
            }],
        }, {toolChoice: "none", maxTokens: 2048,
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)});
        console.log("[DeepSeek compaction usage]", response.usage);
        if (response.stopReason !== "stop") throw new Error(`Summary failed: ${response.stopReason}`);
        return response.content.filter(part => part.type === "text").map(part => part.text).join("");
    }, {...contextBudget, maxTokens: Math.min(contextBudget.maxTokens, model.contextWindow - 8192)});

    agent.subscribe((event) => {
        if (event.type === "message_update" && firstTokenMs === undefined &&
            ["text_delta", "thinking_delta", "toolcall_delta"].includes(event.assistantMessageEvent.type)) {
            firstTokenMs = Math.round(performance.now() - requestStarted);
        }
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
                firstTokenMs,
                elapsedMs: Math.round(performance.now() - requestStarted),
                cost: usage.cost.total,
            });

            if (event.message.stopReason === "error") {
                console.error(
                    "LLM error:",
                    event.message.errorMessage,
                );
            }
        }
    });

    return {agent, compact, distiller: new MemoryDistiller(memory, models, model), router: createTreeRouter()};
}
