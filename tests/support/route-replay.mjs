import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

// Freeze the first recorded round, regardless of its pass/fail result. The tape
// contains classifier decisions only, never model answers or business-tool output.
export function routingTape(directory) {
    const tape = {};
    for (const file of readdirSync(directory).filter(name => /^agent-eval-.*\.json$/.test(name)).sort()) {
        const report = JSON.parse(readFileSync(join(directory, file), "utf8"));
        if (report.round !== 1) continue;
        for (const result of report.results) {
            if (tape[result.name]) throw new Error(`Duplicate first-round conversation: ${result.name}`);
            let input;
            tape[result.name] = result.timeline.flatMap(event => {
                if (event.type === "user") input = event.text;
                return event.type === "route" ? [{input, route: {...event}}] : [];
            });
        }
    }
    if (!Object.keys(tape).length) throw new Error("No first-round route evidence found");
    return tape;
}

export function replayRouter(tape, name) {
    if (!tape[name]?.length) throw new Error(`No recorded routes for ${name}`);
    const used = new Map();
    return async (input, state) => {
        const index = used.get(input) ?? 0;
        const record = tape[name].filter(record => record.input === input)[index];
        if (!record) throw new Error(`No recorded route for current input in ${name}`);
        used.set(input, index + 1);
        const branch = record.route.branch;
        if (!["new", "current", "search", undefined].includes(branch) && !state.topics?.some(topic => topic.id === branch)) {
            throw new Error(`Recorded topic ${branch} does not exist in this run; cannot compare routes`);
        }
        return {...record.route, replayed: true, elapsedMs: 0};
    };
}
