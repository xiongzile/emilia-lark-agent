import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";

const git = promisify(execFile);
const projectRoot = process.cwd();
const previousLocalConfig = process.env.AGENT_LOCAL_CONFIG;
if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is required for the real-model agent evaluation");
}

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

const fixture = await mkdtemp(join(tmpdir(), "emilia-agent-eval-"));
const agentRepo = join(fixture, "agent");
const mobileRepo = join(fixture, "mobile");
const results = [];

try {
    await createRepo(agentRepo, "AGENT-MEMORY-731");
    await createRepo(mobileRepo, "MOBILE-FEED-482");
    await mkdir(join(agentRepo, ".private"), {recursive: true});
    const localConfig = join(agentRepo, ".private", "agent.json");
    await writeFile(localConfig, JSON.stringify({
        workspaces: {mobile: mobileRepo},
    }));
    process.env.AGENT_LOCAL_CONFIG = localConfig;
    process.chdir(agentRepo);

    const [{MemoryStore}, {createDeepSeekAgent}, {AgentSession}, {createMemoryTool}, {workspaceGitTool}] = await Promise.all([
        import("../dist/memory/store.js"),
        import("../dist/agent/deepseek.js"),
        import("../dist/agent/session.js"),
        import("../dist/memory/tool.js"),
        import("../dist/tools/workspace-git.js"),
    ]);

    function runtime(store, trace) {
        const safeGitArgs = {
            status: ["status", "--short"],
            log: ["log", "-1", "--format=%s"],
            "rev-parse": ["rev-parse", "--abbrev-ref", "HEAD"],
        };
        const readOnlyGit = {
            ...workspaceGitTool,
            description: "Read-only Git inspection in named workspaces. Available commands: status, log, rev-parse.",
            async execute(id, params, signal, onUpdate) {
                const safeArgs = safeGitArgs[params.args[0]];
                if (!safeArgs) {
                    throw new Error("The evaluation allows read-only Git commands only");
                }
                return workspaceGitTool.execute(id, {...params, args: safeArgs}, signal, onUpdate);
            },
        };
        const {agent, distiller} = createDeepSeekAgent(store, [createMemoryTool(store), readOnlyGit]);
        agent.subscribe((event) => {
            if (event.type === "tool_execution_start") trace.push({tool: event.toolName, args: event.args});
        });
        return {session: new AgentSession(agent, store, distiller), distiller};
    }

    async function scenario(name, run) {
        const trace = [];
        try {
            const evidence = await run(trace);
            results.push({name, passed: true, evidence, trace});
            console.log(`PASS ${name}`);
        } catch (error) {
            results.push({name, passed: false, error: String(error), trace});
            console.error(`FAIL ${name}: ${error}`);
        }
    }

    await scenario("memory survives restart without saving small talk", async (trace) => {
        const path = join(fixture, "memory-basic");
        const store = await MemoryStore.open(path);
        const first = runtime(store, trace);
        await first.session.run("profile-1", "请记住：我负责 Android 构建性能优化。");
        await first.distiller.update();
        const profile = store.list("profile").find((entry) => entry.status === "active" && /Android/i.test(entry.text) && /构建/.test(entry.text));
        assert.ok(profile, "the stable responsibility must be distilled as an active profile fact");
        assert.deepEqual(profile.sourceMessageIds, ["profile-1"]);

        const reopened = await MemoryStore.open(path);
        const second = runtime(reopened, trace);
        const answer = await second.session.run("profile-2", "我主要负责什么工作？");
        assert.match(answer, /Android/i);
        assert.match(answer, /构建/);
        await second.session.run("profile-3", "今晚吃什么比较好？");
        await second.distiller.update();
        assert.ok(reopened.list().every((entry) => !/晚饭|今晚吃|吃什么/.test(entry.text)), "one-off small talk must not become durable memory");
        return {answer, memories: reopened.list().map(({category, text, status}) => ({category, text, status}))};
    });

    await scenario("corrected pi workspace survives restart", async (trace) => {
        const path = join(fixture, "memory-repo");
        const store = await MemoryStore.open(path);
        const first = runtime(store, trace);
        await first.session.run("repo-1", "记住：pi 是 mobile 仓库。");
        await first.distiller.update();
        await first.session.run("repo-2", "纠正一下，我刚才说错了：pi 指当前 agent 工程，不是 mobile 仓库。以后按这个理解。");
        await first.distiller.update();

        // Push the correction out of the recent-dialogue window. The next answer must
        // come from durable memory rather than parroting the immediately prior turn.
        for (let index = 0; index < 20; index += 1) {
            await store.recordUser(`filler-${index}`, `无关的日常闲聊 ${index}`);
            await store.recordAssistant(`filler-${index}`, "收到。");
        }
        await store.apply([], store.status().turns);

        const reopened = await MemoryStore.open(path);
        const second = runtime(reopened, trace);
        const yesOrNo = await second.session.run("repo-3", "pi 是 mobile 仓库吗？只回答“是”或“否”。");
        assert.match(yesOrNo.trim(), /^否[。.!！\s]*$/, "the agent must reject the stale project mapping after restart");
        const projects = reopened.list("project").filter((entry) => entry.status === "active");
        assert.ok(projects.some((entry) => /pi/i.test(entry.text) && /agent/i.test(entry.text)), `durable memory must identify the agent project; got ${JSON.stringify(reopened.list())}`);
        assert.ok(projects.every((entry) => !/^pi\s*(是|指)\s*mobile/i.test(entry.text)), "the old mapping must not remain active");

        const answer = await second.session.run("repo-4", "请只读查看 pi 仓库最近一次 Git 提交的标题，告诉我标题里的标记。不要猜。");
        assert.match(answer, /AGENT-MEMORY-731/i, "the answer must use the agent repo commit");
        assert.ok(trace.some(({tool, args}) => tool === "workspace_git" && args.args?.[0] === "log" && (!args.workspace || args.workspace === "agent")), "the agent must inspect the agent repo history");
        assert.ok(trace.every(({tool, args}) => tool !== "workspace_git" || args.workspace !== "mobile"), "the wrong repo must not be queried");
        return {yesOrNo, answer, projects};
    });

    await scenario("assistant-only success claim is not verified progress", async (trace) => {
        const store = await MemoryStore.open(join(fixture, "memory-claim"));
        await store.recordUser("claim-1", "帮我改那篇文档");
        await store.recordAssistant("claim-1", "我已经修改文档成功，也把自己加成作者了。");
        const {distiller} = runtime(store, trace);
        await distiller.update();
        const falseProgress = store.list("progress").filter((entry) => entry.status === "active" && /文档|作者/.test(entry.text));
        assert.equal(falseProgress.length, 0, "an assistant's unsupported success claim must not be active progress");
        return {memories: store.list().map(({category, text, status}) => ({category, text, status}))};
    });
} finally {
    process.chdir(projectRoot);
    if (previousLocalConfig === undefined) delete process.env.AGENT_LOCAL_CONFIG;
    else process.env.AGENT_LOCAL_CONFIG = previousLocalConfig;
    const outputDirectory = join(projectRoot, ".private", "test-runs");
    await mkdir(outputDirectory, {recursive: true, mode: 0o700});
    const outputPath = join(outputDirectory, `agent-eval-${Date.now()}.json`);
    await writeFile(outputPath, JSON.stringify({model: process.env.DEEPSEEK_MODEL || "deepseek-flash", results}, null, 2) + "\n", {mode: 0o600});
    console.log(`Evaluation report: ${outputPath}`);
    await rm(fixture, {recursive: true, force: true});
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
