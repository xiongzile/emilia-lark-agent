import {readFile, readdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {summarizeScores} from "./support/conversation-score.mjs";

// Reads saved reports only. Reformatting or comparing a run never calls a model again.
async function load(directory) {
    const reports = await Promise.all((await readdir(directory)).filter(name => /^agent-eval-.*\.json$/.test(name))
        .sort().map(name => readFile(join(directory, name), "utf8").then(JSON.parse)));
    return {manifest: JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")), ...summarizeScores(reports)};
}

export async function writeScoreReport(directory, baselineDirectory) {
    const result = await load(directory);
    const number = value => value === null ? "未评分" : value.toFixed(1);
    const range = stats => `${number(stats.mean)} (${number(stats.min)}–${number(stats.max)}; σ ${number(stats.sd)})`;
    const lines = [`# ${result.manifest.label}`, "", `Batch: ${result.manifest.batch}`,
        `Scored scenarios: ${result.scoredCases}/${result.totalCases}. Reply and context scores are separate (0–100).`, "",
        "| Scenario | Runs scored / total | Reply: mean (range; sd) | First-request context | Critical-loss runs | Judge errors | Assertion failures |",
        "| --- | ---: | --- | --- | ---: | ---: | ---: |",
        ...result.cases.map(row => `| ${row.name} | ${row.scoredRuns}/${row.runs} | ${range(row.reply)} | ${range(row.context)} | ${row.criticalRuns} | ${row.judgeErrors} | ${row.assertionsFailed} |`), "",
        `Equal-weight scenario means: reply ${number(result.reply)}, context ${number(result.context)}.`,
        "Missing judge results are reported, never scored as success. First-request context measures what was initially visible; final-request checks in the raw trace show later recovery.",
        "Critical context losses and business assertion failures require inspection regardless of average scores. Scores do not authorize deployment."];
    if (baselineDirectory) {
        const baseline = await load(baselineDirectory);
        for (const field of ["testsHash", "provider", "model", "judgeModel", "pi", "routingTapeHash"]) {
            if (baseline.manifest[field] !== result.manifest[field]) throw new Error(`Cannot compare: ${field} differs`);
        }
        const names = summary => summary.cases.map(row => row.name).sort().join("\n");
        if (names(baseline) !== names(result)) throw new Error("Cannot compare: scenarios differ");
        result.comparison = {baseline: resolve(baselineDirectory), cases: result.cases.map(row => {
            const before = baseline.cases.find(item => item.name === row.name);
            const delta = axis => row[axis].n === row.runs && before[axis].n === before.runs
                ? row[axis].mean - before[axis].mean : null;
            return {name: row.name, reply: delta("reply"), context: delta("context"),
                criticalRunsBefore: before.criticalRuns, criticalRunsAfter: row.criticalRuns};
        })};
        lines.push("", `## Compared with ${baseline.manifest.label}`, "",
            "| Scenario | Reply delta | Context delta | Critical-loss runs before → after |", "| --- | ---: | ---: | --- |",
            ...result.comparison.cases.map(row => `| ${row.name} | ${number(row.reply)} | ${number(row.context)} | ${row.criticalRunsBefore} → ${row.criticalRunsAfter} |`),
            "", "Compare repeated distributions and per-scenario regressions, not one best run. Deltas are withheld when either run has incomplete scores.");
    }
    await writeFile(join(directory, "scores.json"), JSON.stringify(result, null, 2) + "\n", {mode: 0o600});
    await writeFile(join(directory, "scores.md"), lines.join("\n") + "\n", {mode: 0o600});
    console.log(`Scores: reply ${number(result.reply)}, context ${number(result.context)}; ${result.criticalRuns} critical-loss runs; ${result.judgeErrors} judge errors.\n${join(directory, "scores.md")}`);
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    if (!process.argv[2]) throw new Error("Usage: node tests/score-report.mjs <run directory> [baseline directory]");
    await writeScoreReport(resolve(process.argv[2]), process.argv[3] && resolve(process.argv[3]));
}
