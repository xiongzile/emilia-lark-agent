import {execFile} from "node:child_process";
import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";

const parameters = Type.Object({
    args: Type.Array(Type.String(), {
        description: "Arguments passed to lark-cli, for example [\"calendar\", \"+agenda\"] or [\"schema\", \"im.messages.list\"].",
        maxItems: 40,
    }),
});

const blockedCommands = new Set(["auth", "config", "profile", "update"]);
const maxOutputBytes = 1024 * 1024;

function runLarkCli(args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "lark-cli",
            args,
            {
                cwd: process.cwd(),
                encoding: "utf8",
                maxBuffer: maxOutputBytes,
                timeout: 60_000,
                signal,
            },
            (error, stdout, stderr) => {
                if (error) {
                    const diagnostic = stderr.trim() || stdout.trim() || error.message;
                    reject(new Error(`lark-cli failed: ${diagnostic}`));
                    return;
                }

                resolve(stdout.trim() || stderr.trim() || "Command completed with no output.");
            },
        );
    });
}

export const larkCliTool: AgentTool<typeof parameters, {args: string[]}> = {
    name: "lark_cli",
    label: "Lark CLI",
    description: [
        "Run the official Lark/Feishu CLI.",
        "Use '<domain> --help' to discover shortcuts and 'schema <service.resource.method>' to inspect an API.",
        "Prefer shortcuts over raw API calls. Use --dry-run before changes when supported.",
        "Authentication and CLI configuration are managed outside the agent.",
    ].join(" "),
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, {args}, signal) {
        if (args.length === 0) {
            throw new Error("lark-cli requires at least one argument");
        }
        if (blockedCommands.has(args[0])) {
            throw new Error(`lark-cli command '${args[0]}' is not available to the agent`);
        }

        const output = await runLarkCli(args, signal);
        return {
            content: [{type: "text", text: output}],
            details: {args},
        };
    },
};
