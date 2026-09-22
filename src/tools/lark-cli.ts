import {runCommand} from "./output.ts";
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

export const larkCliTool: AgentTool<typeof parameters, {args: string[]}> = {
    name: "lark_cli",
    label: "Lark CLI",
    description: [
        "Run the official Lark/Feishu CLI.",
        "Use '<domain> --help' to discover shortcuts and 'schema <service.resource.method>' to inspect an API.",
        "Prefer shortcuts over raw API calls. Use --dry-run before changes when supported.",
        "Choose --as user or --as bot according to whose identity should perform the operation; do not infer one identity from the other's access.",
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

        const output = await runCommand("lark-cli", args, {
            cwd: process.cwd(), encoding: "utf8", maxBuffer: maxOutputBytes, timeout: 60_000, signal,
        });
        return {
            content: [{type: "text", text: output}],
            details: {args},
        };
    },
};
