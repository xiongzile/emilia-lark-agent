import {Agent} from "@earendil-works/pi-agent-core";
import {createModels, createAssistantMessageEventStream} from "@earendil-works/pi-ai";
import {deepseekProvider} from "@earendil-works/pi-ai/providers/deepseek";
import {emiliaSystemPrompt} from "../../dist/prompts/emilia.js";
import {stream as serialize} from "../../vendor/pi/packages/ai/src/api/openai-completions.ts";

// Use Pi's actual event/tool loop; replace only the provider response for offline tests.
export function scriptedAgent(respond = () => "收到", tools = []) {
    const models = createModels(); models.setProvider(deepseekProvider());
    const model = models.getModel("deepseek", "deepseek-flash");
    const requests = [];
    const agent = new Agent({initialState: {systemPrompt: emiliaSystemPrompt, model, tools}, streamFn: (_model, context, options) => {
        const stream = createAssistantMessageEventStream();
        requests.push(structuredClone(context));
        Promise.resolve().then(async () => {
            if (options?.onPayload) await serialize(model, context, {apiKey: "offline-test",
                async onPayload(payload) {await options.onPayload(payload, model); throw new Error("Captured before network");},
                fetch() {throw new Error("Offline fixture must not access network");},
            }).result();
            return respond(context, requests.length);
        })
            .catch(error => ({content: [], stopReason: "error", errorMessage: String(error)})).then(value => {
            const content = typeof value === "string" ? [{type: "text", text: value}] : value.content;
            const message = {role: "assistant", api: model.api, provider: model.provider, model: model.id,
                content, timestamp: Date.now(), stopReason: content.some(p => p.type === "toolCall") ? "toolUse" : "stop",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                ...(typeof value === "object" ? value : {})};
            stream.push(message.stopReason === "error" ? {type: "error", reason: "error", error: message}
                : {type: "done", reason: message.stopReason, message});
            stream.end();
        });
        return stream;
    }});
    return {agent, requests};
}
