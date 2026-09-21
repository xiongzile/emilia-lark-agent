import {spawnSync} from "node:child_process";
import {statSync} from "node:fs";

// Node owns discovery, process isolation, failure reporting, and timeouts.
// Forward a feature directory or a single case to run a smaller evaluation.
const targets = process.argv.slice(2);
const patterns = (targets.length ? targets : ["tests/scenarios"]).map((target) =>
    statSync(target, {throwIfNoEntry: false})?.isDirectory() ? `${target}/**/*.test.mjs` : target
);
const result = spawnSync(process.execPath, [
    "--test",
    "--test-reporter=spec",
    "--test-concurrency=1",
    "--test-timeout=300000",
    ...patterns,
], {stdio: "inherit"});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
