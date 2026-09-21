import {execFile} from "node:child_process";
import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import {getWorkspaceRoot, workspaceNames} from "../config/workspaces.ts";

const parameters = Type.Object({
    workspace: Type.Optional(Type.String({
        description: `Named Git workspace. Defaults to agent. Available: ${workspaceNames.join(", ")}.`,
    })),
    args: Type.Array(Type.String(), {
        description: "Arguments passed to git. Shell syntax is not supported.",
        minItems: 1,
        maxItems: 80,
    }),
});

const allowedCommands = new Set([
    "add",
    "blame",
    "branch",
    "commit",
    "diff",
    "fetch",
    "grep",
    "log",
    "ls-files",
    "push",
    "remote",
    "rev-parse",
    "show",
    "status",
    "switch",
]);
const maxOutputBytes = 4 * 1024 * 1024;

function includesAny(args: string[], blocked: string[]): boolean {
    return args.some((arg) => blocked.includes(arg));
}

function assertAllowed(args: string[]): void {
    const [command, ...rest] = args;
    if (!allowedCommands.has(command)) {
        throw new Error(`git command '${command}' is not available to the agent`);
    }

    if (command === "add" && includesAny(rest, [".", "-A", "--all", "-u", "--update"])) {
        throw new Error("Stage explicit task files; broad git add operations are disabled");
    }
    if (command === "branch" && includesAny(rest, [
        "-d", "-D", "--delete", "-m", "-M", "--move", "-f", "--force", "-C",
    ])) {
        throw new Error("Deleting, renaming, or force-moving branches through the agent is disabled");
    }
    if (command === "commit" && includesAny(rest, [
        "-a", "--all", "--amend", "--fixup", "--squash",
    ])) {
        throw new Error("Broad commits and rewriting existing commits through the agent are disabled");
    }
    if (command === "push" && includesAny(rest, [
        "-f",
        "--force",
        "--force-with-lease",
        "--delete",
        "--mirror",
        "--prune",
    ]) || (command === "push" && rest.some((arg) => arg.startsWith(":")))) {
        throw new Error("Force pushes and remote deletions through the agent are disabled");
    }
    if (command === "remote" && rest[0] && !["-v", "get-url"].includes(rest[0])) {
        throw new Error("Changing Git remotes through the agent is disabled");
    }
    if (command === "switch" && includesAny(rest, [
        "-C", "--force-create", "--discard-changes", "--detach", "--orphan",
    ])) {
        throw new Error("Discarding changes or creating detached/orphan branches is disabled");
    }
}

function runGit(root: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            ["-C", root, ...args],
            {
                encoding: "utf8",
                maxBuffer: maxOutputBytes,
                timeout: 180_000,
                signal,
            },
            (error, stdout, stderr) => {
                if (error) {
                    const diagnostic = stderr.trim() || stdout.trim() || error.message;
                    reject(new Error(`git failed: ${diagnostic}`));
                    return;
                }
                resolve(stdout.trim() || stderr.trim() || "Command completed with no output.");
            },
        );
    });
}

export const workspaceGitTool: AgentTool<typeof parameters, {workspace: string; args: string[]}> = {
    name: "workspace_git",
    label: "Workspace Git",
    description: [
        "Run a constrained Git command in a named workspace.",
        "Always inspect status and the current branch before edits; preserve unrelated changes.",
        "Stage explicit task files only. Reset, clean, rebase, merge, broad add, commit rewriting, force push, remote changes, and branch deletion are disabled.",
    ].join(" "),
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, {workspace, args}, signal) {
        assertAllowed(args);
        const selectedWorkspace = getWorkspaceRoot(workspace);
        const output = await runGit(selectedWorkspace.root, args, signal);
        return {
            content: [{type: "text", text: output}],
            details: {workspace: selectedWorkspace.name, args},
        };
    },
};
