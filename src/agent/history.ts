import type {AgentMessage} from "@earendil-works/pi-agent-core";
import type {Api, Model} from "@earendil-works/pi-ai";
import type {Turn} from "../memory/store.ts";
import {formatAgentTime} from "../time.ts";

// Archived wording is distinct from live, paired tool calls and their results.
export function restoreTurn(turn: Turn, model: Model<Api>): AgentMessage[] {
    const timestamp = Date.parse(turn.at);
    return [
        {role: "user", content: `[历史消息时间：${formatAgentTime(turn.at)}]\n${turn.user}`, timestamp},
        {role: "assistant", content: [{type: "text", text: turn.failed
            ? "[这轮未取得最终回复，外部操作结果未知；需要时核对实际状态。]"
            : `[历史助手回复，仅为当时的表述，未核验]\n${turn.assistant ?? ""}`}],
            api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp,
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0,
                cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}},
    ];
}
