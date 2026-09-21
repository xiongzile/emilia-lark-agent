import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = join(projectRoot, ".local/native-build/workspace-search");

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "emilia-native-search-"));
    const root = join(directory, "workspace");
    await mkdir(join(root, "src"), {recursive: true});
    await mkdir(join(root, ".private"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(directory, "outside"));
    await writeFile(join(root, "src/main.cpp"), "header\n// AgentLoop handles tools\n");
    await writeFile(join(root, ".private/token.txt"), "AgentLoop private\n");
    await writeFile(join(root, "node_modules/dependency.cpp"), "AgentLoop dependency\n");
    await writeFile(join(root, "src/binary.bin"), "\0AgentLoop binary\n");
    await writeFile(join(root, "src/large.txt"), "x".repeat(1024 * 1024) + "AgentLoop\n");
    await writeFile(join(directory, "outside/secret.txt"), "AgentLoop outside\n");
    await symlink(join(directory, "outside/secret.txt"), join(root, "src/external.txt"));
    await symlink(join(root, "src/main.cpp"), join(root, "src/internal.txt"));
    return {directory, root};
}

test("native search finds source text without reading private, generated, binary, or symlink files", async () => {
    const {directory, root} = await fixture();
    try {
        const result = await run(binary, ["AgentLoop"], {cwd: root});
        assert.match(result.stdout, /src\/main\.cpp:2:4: \/\/ AgentLoop handles tools/);
        assert.equal(result.stdout.match(/AgentLoop/g)?.length, 1);

        const insensitive = await run(binary, ["--ignore-case", "agentloop", "src"], {cwd: root});
        assert.match(insensitive.stdout, /src\/main\.cpp:2:4:/);
        const absent = await run(binary, ["NoSuchSymbol", "src"], {cwd: root});
        assert.equal(absent.stdout.trim(), "No matches.");
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("native search rejects absolute paths, traversal, and explicit symlinks", async () => {
    const {directory, root} = await fixture();
    try {
        for (const path of [join(root, "src/main.cpp"), "../outside/secret.txt", "src/../src/main.cpp", "src/external.txt", "src/internal.txt", ".private/token.txt"]) {
            await assert.rejects(run(binary, ["AgentLoop", path], {cwd: root}), (error) => {
                assert.equal(error.code, 2);
                return true;
            });
        }
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("configured CLI runs the native tool only in the selected workspace", async () => {
    const {directory, root} = await fixture();
    const previousDirectory = process.cwd();
    const previousConfig = process.env.AGENT_LOCAL_CONFIG;
    try {
        await writeFile(join(root, "agent.json"), JSON.stringify({workspaces: {other: join(directory, "outside")}}));
        process.chdir(root);
        process.env.AGENT_LOCAL_CONFIG = join(root, "agent.json");
        const {createConfiguredCliTools} = await import("../dist/tools/configured-cli.js");
        const [tool] = createConfiguredCliTools([{
            name: "workspace_search",
            description: "Search workspace source files for a literal string.",
            executable: binary,
        }]);
        const inside = await tool.execute("test", {args: ["AgentLoop"]});
        assert.match(inside.content[0].text, /src\/main\.cpp/);
        const other = await tool.execute("test", {workspace: "other", args: ["AgentLoop"]});
        assert.match(other.content[0].text, /secret\.txt/);
        assert.doesNotMatch(other.content[0].text, /main\.cpp/);
        await assert.rejects(tool.execute("test", {workspace: "missing", args: ["AgentLoop"]}), /Unknown workspace/);
    } finally {
        process.chdir(previousDirectory);
        if (previousConfig === undefined) delete process.env.AGENT_LOCAL_CONFIG;
        else process.env.AGENT_LOCAL_CONFIG = previousConfig;
        await rm(directory, {recursive: true, force: true});
    }
});
