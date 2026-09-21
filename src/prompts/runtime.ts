import {agentTimeZone, formatAgentTime} from "../time.ts";

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: agentTimeZone,
    weekday: "long",
});

export function currentRuntimeContext(now = new Date()): string {
    const localTime = formatAgentTime(now);
    const date = localTime.slice(0, 10);

    return [
        "<runtime_context>",
        `current_datetime: ${localTime}`,
        `current_date: ${date}`,
        `weekday: ${weekdayFormatter.format(now)}`,
        `timezone: ${agentTimeZone}`,
        "This context is generated at request time and is authoritative.",
        "</runtime_context>",
    ].join("\n");
}
