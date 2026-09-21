import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const files = execFileSync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
], {encoding: "utf8"}).split("\0").filter(Boolean);

const joined = (...parts) => parts.join("");
const rules = [
    ["absolute macOS home path", new RegExp(joined("/", "Users", "/"), "i")],
    ["private company domain", new RegExp(joined("byte", "dance", "\\.(?:com|net)"), "i")],
    ["private product reference", new RegExp(joined("star", "ling|aeo", "lus|i18n", "ops"), "i")],
    ["private repository reference", new RegExp(joined("tik", "tok"), "i")],
    ["personal project identifier", new RegExp(joined("xiong", "zile"), "i")],
    ["Lark user identifier", /\bou_[a-z0-9]{16,}\b/i],
    ["probable access key", /\bAK[A-Z0-9]{20,}\b/],
    ["probable API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
];

const failures = [];
for (const file of files) {
    let content;
    try {
        content = readFileSync(file, "utf8");
    } catch {
        continue;
    }
    if (content.includes("\0")) continue;

    for (const [label, expression] of rules) {
        const match = expression.exec(content);
        if (!match) continue;
        const line = content.slice(0, match.index).split("\n").length;
        failures.push(`${file}:${line}: ${label}`);
    }
}

if (failures.length > 0) {
    console.error("Public-source audit failed:\n" + failures.join("\n"));
    process.exit(1);
}

console.log(`Public-source audit passed (${files.length} files checked).`);
