export type ContextState = {kind: "reload"} | {kind: "active"; turns: number};
export type ContextEvent = "replied" | "command" | "failed";

export function needsContext(state: ContextState): boolean {
    return state.kind === "reload" || state.turns >= 20;
}

export function advanceContext(state: ContextState, event: ContextEvent): ContextState {
    if (event !== "replied") return {kind: "reload"};
    if (state.kind === "active" && !needsContext(state)) {
        return {kind: "active", turns: state.turns + 1};
    }
    return {kind: "active", turns: 1};
}
