import {execFile} from "node:child_process";
import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {CommandToolConfig} from "../config/local.ts";
import {getWorkspaceRoot, workspaceNames} from "../config/workspaces.ts";

const parameters = Type.Object({
    workspace: Type.Optional(Type.String({
        enum: workspaceNames,
        description: `Working directory name. Defaults to agent. Available: ${workspaceNames.join(", ")}.`,
    })),
    args: Type.Array(Type.String(), {
        description: "Arguments passed directly to the executable. Shell syntax is not supported.",
        minItems: 1,
        maxItems: 80,
    }),
});

function validateArgs(config: CommandToolConfig, args: string[]): void {
    const first = args[0];
    if (config.allowedFirstArgs && !config.allowedFirstArgs.includes(first)) {
        throw new Error(`${config.name} does not allow '${first}' as its first argument`);
    }
    if (config.blockedFirstArgs?.includes(first)) {
        throw new Error(`${config.name} command '${first}' is disabled`);
    }
    const blocked = config.blockedArgs?.find((arg) => args.includes(arg));
    if (blocked) throw new Error(`${config.name} argument '${blocked}' is disabled`);

    for (const sequence of config.blockedArgSequences ?? []) {
        const found = args.some((_, index) =>
            sequence.every((part, offset) => args[index + offset] === part)
        );
        if (found) throw new Error(`${config.name} argument sequence '${sequence.join(" ")}' is disabled`);
    }

    for (const pattern of config.blockedArgPatterns ?? []) {
        const expression = new RegExp(pattern, "i");
        const match = args.find((arg) => expression.test(arg));
        if (match) throw new Error(`${config.name} argument '${match}' is disabled by policy`);
    }
}

export function createConfiguredCliTools(
    configs: CommandToolConfig[],
): AgentTool<typeof parameters, {workspace?: string; args: string[]}>[] {
    const names = new Set<string>();
    return configs.map((config) => {
        if (names.has(config.name)) throw new Error(`Duplicate configured tool: ${config.name}`);
        names.add(config.name);

        return {
            name: config.name,
            label: config.label ?? config.name,
            description: config.description,
            parameters,
            executionMode: "sequential",
            async execute(_toolCallId, {workspace, args}, signal) {
                signal?.throwIfAborted();
                validateArgs(config, args);
                const selectedWorkspace = getWorkspaceRoot(workspace);
                const allArgs = [...(config.prependArgs ?? []), ...args];

                const output = await new Promise<string>((resolve, reject) => {
                    execFile(config.executable, allArgs, {
                        cwd: selectedWorkspace.root,
                        encoding: "utf8",
                        maxBuffer: config.maxOutputBytes ?? 2 * 1024 * 1024,
                        timeout: config.timeoutMs ?? 120_000,
                        signal,
                    }, (error, stdout, stderr) => {
                        if (error) {
                            const diagnostic = stderr.trim() || stdout.trim() || error.message;
                            reject(new Error(`${config.name} failed: ${diagnostic}`));
                            return;
                        }
                        resolve(stdout.trim() || stderr.trim() || "Command completed with no output.");
                    });
                });

                return {
                    content: [{type: "text", text: output}],
                    details: {workspace: selectedWorkspace.name, args},
                };
            },
        };
    });
}
