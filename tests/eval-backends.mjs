import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {createBudget, budgetStatus} from "./support/eval-budget.mjs";
import {routingTape} from "./support/route-replay.mjs";
import {createModelBackend} from "../dist/agent/models.js";

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(option("budget"));
if (!Number.isFinite(limit) || limit <= 0) throw new Error("Specify --budget=<total USD>; no paid calls without a budget");
const rounds = Number(option("repeat") || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error("--repeat must be 1–5 for budgeted comparisons");
for (const arg of args) if (arg.startsWith("--") && !/^--(budget|repeat|models|budget-file|routes)=/.test(arg)) throw new Error(`Unknown option ${arg}`);
const backends = (option("models") || "deepseek:deepseek-flash,openrouter:anthropic/claude-sonnet-5,openrouter:openai/gpt-5.4,openrouter:google/gemini-3.8-flash").split(",");
if (new Set(backends).size !== backends.length) throw new Error("Duplicate backend");
for (const backend of backends) {
    const [provider, ...model] = backend.split(":");
    createModelBackend(provider, model.join(":"));
    if (!process.env[provider === "openrouter" ? "OPENROUTER_API_KEY" : "DEEPSEEK_API_KEY"]) throw new Error(`Missing ${provider} key`);
}
if (!process.env.DEEPSEEK_API_KEY || !(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY)) throw new Error("DeepSeek judge and Jev router keys are required");
const targets = args.filter(arg => !arg.startsWith("--"));
if (!targets.length) targets.push(
    "tests/scenarios/conversation/greeting-starts-fresh.test.mjs",
    "tests/scenarios/conversation/recent-key-after-greeting.test.mjs",
    "tests/scenarios/conversation/tree-repair.test.mjs",
    "tests/scenarios/task-execution/approval-capability.test.mjs",
);
const directory = resolve(".private/test-runs", `backends-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(directory, {recursive: true, mode: 0o700});
const ledger = resolve(option("budget-file") || join(directory, "budget.jsonl"));
if (existsSync(ledger)) {
    if (budgetStatus(ledger).limit !== limit) throw new Error("Existing budget limit differs; never reset spend on retry");
} else createBudget(ledger, limit);
const previousRequests = new Set(budgetStatus(ledger).requests.map(row => row.id));
writeFileSync(join(directory, "plan.json"), JSON.stringify({backends, targets, rounds, limit,
    reasoning: "runtime/provider defaults", maxOutputTokens: 2048, budgetFile: ledger, router: option("routes") ? `replay of first round: ${option("routes")}` : "live jev-1.13.0", judge: "deepseek-flash",
    note: "Same scripts, fresh sessions. Live route decisions and responses may differ; inspect requests before attributing failures to a backend."}, null, 2), {mode: 0o600});
const routesPath = option("routes") ? join(directory, "routing-tape.json") : undefined;
if (routesPath) writeFileSync(routesPath, JSON.stringify(routingTape(resolve(option("routes"))), null, 2), {mode: 0o600});
const rows = [];
let firstManifest;
for (const [index, backend] of backends.entries()) {
    const [provider, ...name] = backend.split(":");
    const output = join(directory, String(index + 1));
    console.log(`\nBackend ${backend}; accounted $${budgetStatus(ledger).accounted.toFixed(4)} / $${limit}`);
    const run = spawnSync(process.execPath, ["tests/eval-agent.mjs", "--score", `--repeat=${rounds}`, `--label=${backend}`, ...targets], {
        stdio: "inherit", env: {...process.env, AGENT_EVAL_PROVIDER: provider, AGENT_EVAL_MODEL: name.join(":"),
            AGENT_EVAL_BACKEND: backend, AGENT_EVAL_ROUTES: routesPath || "", AGENT_EVAL_JUDGE_MODEL: "deepseek-flash", AGENT_EVAL_DIRECTORY: output, AGENT_EVAL_BUDGET_FILE: ledger},
    });
    if (run.error) throw run.error;
    const reports = readdirSync(output).filter(file => /^agent-eval-.*\.json$/.test(file))
        .flatMap(file => {const report = JSON.parse(readFileSync(join(output, file)));
            return report.results.map(result => ({...result, round: report.round}));});
    const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
    for (const field of ["runtimeHash", "testsHash", "judgeModel", "pi", "routingTapeHash"]) {
        if (firstManifest && manifest[field] !== firstManifest[field]) throw new Error(`Cannot compare: ${field} changed during the batch`);
    }
    firstManifest ??= manifest;
    const scores = JSON.parse(readFileSync(join(output, "scores.json")));
    const requests = budgetStatus(ledger).requests.filter(row => row.backend === backend && !previousRequests.has(row.id));
    rows.push({backend, passed: reports.filter(row => row.passed).length, total: reports.length,
        reply: scores.reply, context: scores.context, judgeErrors: scores.judgeErrors, criticalRuns: scores.criticalRuns,
        openrouterUSD: requests.filter(row => row.provider === "openrouter" && row.basis === "reported").reduce((sum, row) => sum + row.cost, 0),
        accountedUSD: requests.reduce((sum, row) => sum + (row.cost ?? row.reserved), 0),
        unsettled: requests.filter(row => row.cost === undefined).length,
        failures: reports.filter(row => !row.passed).map(row => ({name: row.name, round: row.round,
            reasons: row.timeline.filter(e => e.type === "expectation_failure").map(e => e.message), error: row.error})),
        directory: output});
    if (run.status !== 0) process.exitCode = 1;
    if (budgetStatus(ledger).accounted >= limit) break;
}
const summary = {plan: {backends, targets, rounds, limit, routesPath}, rows, budget: budgetStatus(ledger)};
writeFileSync(join(directory, "comparison.json"), JSON.stringify(summary, null, 2), {mode: 0o600});
const n = value => value == null ? "unscored" : value.toFixed(2);
const lines = ["# Backend comparison", "", `Same selected conversations; runtime/provider reasoning defaults and 2048 output-token cap. ${routesPath ? "Classifier decisions replay the first recorded round." : "Live Jev routing varies."} These are small end-to-end samples, not a model leaderboard.`, "",
    "| Backend | Conversations passed | Reply /100 | Context /100 | Judge errors | OpenRouter reported USD | Accounted USD incl. auxiliaries | Unsettled requests |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(r => `| ${r.backend} | ${r.passed}/${r.total} | ${n(r.reply)} | ${n(r.context)} | ${r.judgeErrors} | ${r.openrouterUSD.toFixed(4)} | ${r.accountedUSD.toFixed(4)} | ${r.unsettled} |`), "",
    "OpenRouter reported cost is actual response/generation cost. DeepSeek/Jev use conservative list-price estimates; unfinished or unbilled requests retain their full reservations. These numbers exclude account credit-purchase fees.",
    "Full requests, tool observations, model errors and per-scenario scores are in each backend directory. Missing judgments are not passes."];
writeFileSync(join(directory, "comparison.md"), lines.join("\n") + "\n", {mode: 0o600});
console.log(`\n${lines.join("\n")}\n\n${directory}`);
