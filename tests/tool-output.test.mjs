import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";

// output.ts + workspace-files.ts: a large write response must be recoverable
// without repeating the write, even when the service returns minified JSON.
test("大结果只预览，全文可翻页，读结果不会重新执行写操作", async () => {
    const directory = await mkdtemp(join(tmpdir(), "emilia-output-"));
    const previousCwd = process.cwd();
    const previousConfig = process.env.AGENT_LOCAL_CONFIG;
    try {
        const config = join(directory, "config.json");
        await writeFile(config, "{}");
        process.chdir(directory);
        process.env.AGENT_LOCAL_CONFIG = config;
        const [{createConfiguredCliTools}, {workspaceFilesTool}, {textPage}] = await Promise.all([
            import("../dist/tools/configured-cli.js"), import("../dist/tools/workspace-files.js"), import("../dist/tools/output.js"),
        ]);
        const output = JSON.stringify({records: Array.from({length: 2000}, (_, id) => ({id, title: "周报🙂".repeat(20)})), finalId: "DOC-LAST-731"});
        await writeFile("source.json", output);
        await writeFile("command.mjs", `import {appendFileSync, readFileSync} from 'node:fs'; appendFileSync('writes.txt', 'write\\n'); console.log(readFileSync('source.json', 'utf8'));`);
        const [tool] = createConfiguredCliTools([{name: "demo_cli", description: "Demo", executable: process.execPath, prependArgs: [join(directory, "command.mjs")]}]);
        const result = (await tool.execute("once", {args: ["publish"]})).content[0].text;
        assert.ok(Buffer.byteLength(result) < 18000);
        assert.match(result, /Output truncated/);
        const path = result.match(/workspace "agent": ([^ ]+)\. Read/)[1];
        assert.equal(await readFile(path, "utf8"), output);
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        const offset = Number(result.match(/offset=(\d+)/)[1]);
        let recovered = result.split("\n\n[Output truncated")[0];
        let next = offset;
        while (next < output.length) {
            const response = (await workspaceFilesTool.execute("page", {operation: "read", path, offset: next})).content[0].text;
            const page = response.split("\n\n[More content available:")[0];
            assert.ok(page.length > 0, "paging must make progress");
            assert.ok(!page.includes("\uFFFD"), "paging must not split Unicode characters");
            recovered += page;
            next += page.length;
        }
        assert.equal(recovered, output);
        assert.match(recovered, /DOC-LAST-731/);
        assert.equal(await readFile("writes.txt", "utf8"), "write\n");
        assert.equal(textPage("🙂abc", 0, 1).content, "🙂");
        assert.ok(textPage("\n" + "文".repeat(20000)).nextOffset > 0);
        await assert.rejects(workspaceFilesTool.execute("outside", {operation: "read", path: "../outside.txt", offset: 0}), /outside/);

        await writeFile("command.mjs", `process.stderr.write('DENIED ' + 'x'.repeat(200000)); process.exitCode = 3;`);
        await assert.rejects(tool.execute("failure", {args: ["publish"]}), error => {
            assert.match(error.message, /failed \(code 3\).*DENIED/s);
            assert.match(error.message, /Output truncated/);
            assert.ok(error.message.length < 18000);
            return true;
        });
        const [limited] = createConfiguredCliTools([{name: "limited_cli", description: "Capture limit",
            executable: process.execPath, prependArgs: [join(directory, "command.mjs")], maxOutputBytes: 128}]);
        await assert.rejects(limited.execute("capture-limit", {args: ["publish"]}), /Captured output is incomplete.*side effects/s);
    } finally {
        process.chdir(previousCwd);
        if (previousConfig === undefined) delete process.env.AGENT_LOCAL_CONFIG;
        else process.env.AGENT_LOCAL_CONFIG = previousConfig;
        await rm(directory, {recursive: true, force: true});
    }
});
