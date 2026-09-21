const timeZone = "Asia/Shanghai";

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long",
});

export function currentRuntimeContext(now = new Date()): string {
    const parts = Object.fromEntries(
        dateTimeFormatter
            .formatToParts(now)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}:${parts.second}`;

    return [
        "<runtime_context>",
        `current_datetime: ${date}T${time}+08:00`,
        `current_date: ${date}`,
        `weekday: ${weekdayFormatter.format(now)}`,
        `timezone: ${timeZone}`,
        "This context is generated at request time and is authoritative.",
        "</runtime_context>",
    ].join("\n");
}
