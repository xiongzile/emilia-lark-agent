import {createModels} from "@earendil-works/pi-ai";
import {deepseekProvider} from "@earendil-works/pi-ai/providers/deepseek";
import {openrouterProvider} from "@earendil-works/pi-ai/providers/openrouter";

// Production stays on DeepSeek. Evaluations explicitly supply a different backend.
export function createModelBackend(provider = "deepseek", modelId?: string) {
    const models = createModels();
    if (provider === "deepseek") models.setProvider(deepseekProvider());
    else if (provider === "openrouter") models.setProvider(openrouterProvider());
    else throw new Error(`Unsupported model provider: ${provider}`);
    modelId ??= provider === "deepseek" ? process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash" : "";
    const model = models.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown ${provider} model '${modelId}' in the pinned Pi catalog`);
    return {models, model};
}
