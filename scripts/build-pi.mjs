#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pi = join(root, "vendor", "pi");
const manifest = join(pi, "package.json");

if (!existsSync(manifest)) {
  throw new Error("Pi submodule is missing. Run: git submodule update --init --recursive");
}

function run(command, args) {
  execFileSync(command, args, { cwd: pi, stdio: "inherit" });
}

run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);

for (const name of [
  "@earendil-works/chord",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
]) {
  console.log(`Building ${name} from ${pi}`);
  run("npm", ["run", "build", `--workspace=${name}`]);
}
