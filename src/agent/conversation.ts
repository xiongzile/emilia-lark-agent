import type {Api, Model, Models} from "@earendil-works/pi-ai";
import type {Turn} from "../memory/store.ts";

export type ConversationMode = "greet" | "chat" | "task";
interface TopicReference {name: string; messageIds: string[]; segmentStart?: string}
export interface ConversationState {
    segmentStart?: string;
    currentTopic?: TopicReference;
    taskContext?: TopicReference;
    lastMode?: ConversationMode;
}
export interface TurnRoute {
    mode: ConversationMode;
    history: "new" | "current" | "recall";
    topic: string;
    source: "rule" | "model" | "fallback";
    elapsedMs: number;
}
export type TurnRouter = (input: string, state: ConversationState, recent: Turn[]) => Promise<TurnRoute>;

export function uncertainTurn(): TurnRoute {
    return {mode: "chat", history: "current", topic: "", source: "fallback", elapsedMs: 0};
}

const instructions = `判断用户当前消息，只返回 JSON：
{"mode":"greet|chat|task","history":"new|current|recall","topic":"当前话题的简短名称"}。
greet 是独立的打招呼或告别，允许语气词和称呼，但不能包含实际问题、历史指代或办事请求。它开启新的对话段。
chat 是交流感受、日常闲聊、知识问答或技术讨论；task 是要求实际查询、操作工具或补充执行参数。带问候的实质请求按实际内容分类；感谢不是重新打招呼。
history 表示理解当前消息需要的来源：new 是独立新话题；current 是承接当前对话段；recall 是用户主动提及、恢复或询问之前的话题或任务。模糊短句优先承接 recent 中的最新对象，不因旧任务存在就恢复它。普通寒暄与日常近况询问不表示要回顾旧聊天。
state 只包含当前对话段的线索，段外记录只有用户主动提起、history 为 recall 时才会提供。不得回答问题、执行任务或推测完成状态。topic 最多 80 字。`;

export function createTurnRouter(models: Pick<Models, "completeSimple">, model: Model<Api>, timeoutMs = 3000): TurnRouter {
    return async (input, state, recent) => {
        // Whole-message rules only; addressed greetings are classified semantically.
        const simple = input.trim().replace(/[\s!！?？。．.~～]+$/u, "");
        if (/^(你好|您好|嗨|在吗|早上好|早安|中午好|下午好|晚上好|晚安|再见|hello|hi|good morning|good night|bye)$/i.test(simple)) {
            return {...uncertainTurn(), mode: "greet", history: "new", source: "rule"};
        }
        if (/^(谢谢|谢谢你|感谢|多谢|辛苦了|thanks|thank you|thx)$/i.test(simple)) {
            return {...uncertainTurn(), source: "rule"};
        }
        const started = performance.now();
        try {
            if (input.length > 8000) return uncertainTurn();
            const response = await models.completeSimple(model, {
                systemPrompt: instructions,
                messages: [{role: "user", timestamp: Date.now(), content: JSON.stringify({
                    state: {
                        currentTopic: state.currentTopic?.segmentStart === state.segmentStart ? state.currentTopic?.name : undefined,
                        taskContext: state.taskContext?.segmentStart === state.segmentStart ? state.taskContext?.name : undefined,
                    },
                    recent: recent.slice(-3).map(turn => ({user: turn.user.slice(0, 1200),
                        assistant: turn.failed ? "未取得最终回复，操作结果未知。" : turn.assistant?.slice(0, 1600)})),
                    currentMessage: input,
                })}],
            }, {temperature: 0, maxTokens: 300, signal: AbortSignal.timeout(timeoutMs)});
            if (response.stopReason !== "stop") throw new Error("incomplete_route");
            const text = response.content.filter(part => part.type === "text").map(part => part.text).join("");
            const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
            if (!value || !["greet", "chat", "task"].includes(value.mode) || typeof value.topic !== "string" ||
                !["new", "current", "recall"].includes(value.history) ||
                (value.mode === "greet" && value.history !== "new")) throw new Error("invalid_route");
            return {mode: value.mode, history: value.history, topic: value.topic.slice(0, 80),
                source: "model", elapsedMs: Math.round(performance.now() - started)};
        } catch {
            return {...uncertainTurn(), elapsedMs: Math.round(performance.now() - started)};
        }
    };
}

// A greeting archives context by moving a boundary, never by deleting its sources.
export function advanceConversation(state: ConversationState, route: TurnRoute, messageId: string): ConversationState {
    const next = {...state, lastMode: route.mode};
    if (route.mode === "greet") return {...next, segmentStart: messageId};
    if (route.source !== "model") return next;
    const key = route.mode === "task" ? "taskContext" : "currentTopic";
    const previous = state[key];
    const reuse = route.history !== "new" && (route.history === "recall" || previous?.segmentStart === state.segmentStart);
    const ids = [...new Set([...(reuse ? previous?.messageIds ?? [] : []), messageId])];
    next[key] = {name: route.topic || (reuse ? previous?.name : "") || "", segmentStart: state.segmentStart,
        messageIds: ids.length > 4 ? [ids[0], ...ids.slice(-3)] : ids};
    return next;
}

export function contextTurnIds(route: TurnRoute, state: ConversationState, recent: Turn[], archived: Turn[] = []): string[] {
    if (route.mode === "greet") return [];
    // Keep the current segment even if routing is wrong or unavailable.
    const ids = new Set(recent.map(turn => turn.messageId));
    if (route.history === "recall") for (const turn of archived) ids.add(turn.messageId);
    const references = route.history === "recall" || route.source === "fallback"
        ? [state.currentTopic, state.taskContext]
        : [route.mode === "task" ? state.taskContext : state.currentTopic];
    if (route.history !== "new") for (const reference of references) {
        if (route.history === "recall" || reference?.segmentStart === state.segmentStart) {
            for (const id of reference?.messageIds ?? []) ids.add(id);
        }
    }
    return [...ids];
}

export function turnGuidance(route: TurnRoute): string {
    const focus = route.mode === "greet"
        ? "用户只在打招呼或告别。只回应一句简短招呼，回复到此结束；不提出问题，不追加话题、解释或历史回顾。"
        : "跟随用户当前的话题和请求。历史仅用于理解，不自动变成待办；轻松聊天不需要汇报工作或提出工作邀约。";
    return `<turn_context>\n本轮模式提示：${route.mode}。提示可能有误，以用户当前实际请求为准。\n${focus}\n</turn_context>`;
}
