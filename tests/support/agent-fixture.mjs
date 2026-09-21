import {execFile} from "node:child_process";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {createChatSimulator} from "./chat-simulator.mjs";

const git = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

async function createRepo(path, marker) {
    await mkdir(path, {recursive: true});
    await git("git", ["-C", path, "init", "-q"]);
    await git("git", ["-C", path, "config", "user.name", "Agent Eval"]);
    await git("git", ["-C", path, "config", "user.email", "agent-eval@example.invalid"]);
    await git("git", ["-C", path, "config", "commit.gpgsign", "false"]);
    await writeFile(join(path, "README.md"), `${marker}\n`);
    await git("git", ["-C", path, "add", "README.md"]);
    await git("git", ["-C", path, "commit", "-qm", `docs: ${marker}`]);
}

// One conversation per test file. Node isolates files in separate processes,
// so the runtime's cached config and cwd cannot leak between conversations.
export function conversation(script) {
    test(script.name, async () => {
        if (!process.env.DEEPSEEK_API_KEY) {
            throw new Error("DEEPSEEK_API_KEY is required for the real-model agent evaluation");
        }
        const previousDirectory = process.cwd();
        const previousConfig = process.env.AGENT_LOCAL_CONFIG;
        const fixture = await mkdtemp(join(tmpdir(), "emilia-agent-eval-"));
        const workspaces = {agent: join(fixture, "agent"), mobile: join(fixture, "mobile")};
        const result = {name: script.name, passed: false, timeline: []};
        try {
            await createRepo(workspaces.agent, "AGENT-MEMORY-731");
            await createRepo(workspaces.mobile, "MOBILE-FEED-482");
            for (const file of script.files ?? []) {
                const path = join(workspaces[file.workspace ?? "agent"], file.path);
                await mkdir(dirname(path), {recursive: true});
                await writeFile(path, file.content);
            }
            const localConfig = join(fixture, "agent.json");
            await writeFile(localConfig, JSON.stringify({workspaces: {mobile: workspaces.mobile}}));
            process.env.AGENT_LOCAL_CONFIG = localConfig;
            process.chdir(workspaces.agent);

            // Import only after selecting the fixture: config is loaded at module scope.
            const [{MemoryStore}, {createDeepSeekAgent}, {AgentSession}, {createMemoryTool}, {workspaceGitTool}, {workspaceFilesTool}, {createConfiguredCliTools}] = await Promise.all([
                import("../../dist/memory/store.js"),
                import("../../dist/agent/deepseek.js"),
                import("../../dist/agent/session.js"),
                import("../../dist/memory/tool.js"),
                import("../../dist/tools/workspace-git.js"),
                import("../../dist/tools/workspace-files.js"),
                import("../../dist/tools/configured-cli.js"),
            ]);
            const readOnlyGit = {
                ...workspaceGitTool,
                description: "Read-only Git inspection in named workspaces. Available commands: status, log, rev-parse.",
                async execute(id, params, signal, onUpdate) {
                    if (!["status", "log", "rev-parse"].includes(params.args[0]) || params.args.some((arg) =>
                        arg === "--output" || arg.startsWith("--output=") || arg === "--ext-diff" || /^-o(?:$|[^-])/.test(arg)
                    )) throw new Error("The evaluation allows read-only Git commands only");
                    return workspaceGitTool.execute(id, params, signal, onUpdate);
                },
            };
            const [searchTool] = createConfiguredCliTools([{
                name: "workspace_search",
                label: "Workspace Search (C++)",
                executable: join(projectRoot, ".local/native-build/workspace-search"),
                description: "Search source text in a named workspace. args: [literal query, optional relative path], or [--ignore-case, literal query, optional relative path]. Results are file:line:column excerpts. Hidden and generated files are skipped.",
            }]);
            const play = createChatSimulator({
                fixture, workspaces, MemoryStore, createDeepSeekAgent, AgentSession,
                toolRegistry: {
                    memory: (store) => createMemoryTool(store),
                    git: () => readOnlyGit,
                    files: () => workspaceFilesTool,
                    search: () => searchTool,
                },
            });
            result.timeline = await play(script);
            result.passed = true;
        } catch (error) {
            result.error = String(error);
            result.timeline = error.timeline ?? [];
            throw error;
        } finally {
            process.chdir(previousDirectory);
            if (previousConfig === undefined) delete process.env.AGENT_LOCAL_CONFIG;
            else process.env.AGENT_LOCAL_CONFIG = previousConfig;
            await rm(fixture, {recursive: true, force: true});
            const outputDirectory = join(projectRoot, ".private/test-runs");
            await mkdir(outputDirectory, {recursive: true, mode: 0o700});
            const outputPath = join(outputDirectory, `agent-eval-${Date.now()}-${process.pid}.json`);
            await writeFile(outputPath, JSON.stringify({
                model: process.env.DEEPSEEK_MODEL || "deepseek-flash", results: [result],
            }, null, 2) + "\n", {mode: 0o600});
            console.log(`Conversation report: ${outputPath}`);
        }
    });
}
