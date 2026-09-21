export const agentTimeZone = "Asia/Shanghai";

const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: agentTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
});

export function formatAgentTime(value: string | Date): string {
    const date = typeof value === "string" ? new Date(value) : value;
    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );
    const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.slice(3);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
