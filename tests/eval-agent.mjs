import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, resolve} from "node:path";
import {writeScoreReport} from "./score-report.mjs";

// Node owns discovery, process isolation, failure reporting, and timeouts.
// Forward a feature directory or a single case to run a smaller evaluation.
const args = process.argv.slice(2);
const repeat = args.find(arg => arg.startsWith("--repeat="));
const rounds = repeat ? Number(repeat.slice("--repeat=".length)) : 1;
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("--repeat must be an integer from 1 to 20");
const label = args.find(arg => arg.startsWith("--label="))?.slice(8) || "evaluation";
const scored = args.includes("--score");
const targets = args.filter(arg => arg !== repeat && arg !== "--score" && !arg.startsWith("--label="));
const patterns = (targets.length ? targets : ["tests/scenarios"]).map((target) =>
    statSync(target, {throwIfNoEntry: false})?.isDirectory() ? `${target}/**/*.test.mjs` : target
);
const batch = new Date().toISOString();
const directory = process.env.AGENT_EVAL_DIRECTORY || resolve(".private/test-runs", `scored-${batch.replace(/[:.]/g, "-")}`);
if (scored) {
    function hashTree(root) {
        const hash = createHash("sha256");
        for (const name of readdirSync(root, {recursive: true}).sort()) {
            const path = join(root, name);
            if (statSync(path).isFile()) hash.update(name).update("\0").update(readFileSync(path)).update("\0");
        }
        return hash.digest("hex");
    }
    mkdirSync(directory, {recursive: true, mode: 0o700});
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({label, batch, rounds, targets,
        provider: process.env.AGENT_EVAL_PROVIDER || "deepseek",
        model: process.env.AGENT_EVAL_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash",
        budgetFile: process.env.AGENT_EVAL_BUDGET_FILE,
        routingTapeHash: process.env.AGENT_EVAL_ROUTES ? createHash("sha256").update(readFileSync(process.env.AGENT_EVAL_ROUTES)).digest("hex") : null,
        judgeModel: process.env.AGENT_EVAL_JUDGE_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash",
        runtimeHash: hashTree("src"), testsHash: hashTree("tests"),
        revision: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
        pi: execFileSync("git", ["-C", "vendor/pi", "rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
    }, null, 2), {mode: 0o600});
}
for (let round = 1; round <= rounds; round++) {
    console.log(`Evaluation round ${round}/${rounds}; batch ${batch}`);
    const result = spawnSync(process.execPath, [
        "--test",
        "--test-reporter=spec",
        "--test-concurrency=1",
        "--test-timeout=300000",
        ...patterns,
    ], {stdio: "inherit", env: {...process.env, AGENT_EVAL_BATCH: batch, AGENT_EVAL_ROUND: String(round),
        ...(scored ? {AGENT_EVAL_SCORE: "1", AGENT_EVAL_DIRECTORY: directory} : {})}});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
}
if (scored) {
    const summary = await writeScoreReport(directory);
    if (!summary.scoredCases || summary.judgeErrors) process.exitCode = 1;
}
