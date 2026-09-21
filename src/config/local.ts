import {existsSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, resolve} from "node:path";

export interface CommandToolConfig {
    name: string;
    label?: string;
    executable: string;
    description: string;
    prependArgs?: string[];
    allowedFirstArgs?: string[];
    blockedFirstArgs?: string[];
    blockedArgs?: string[];
    blockedArgSequences?: string[][];
    blockedArgPatterns?: string[];
    timeoutMs?: number;
    maxOutputBytes?: number;
}

interface LocalAgentConfig {
    workspaces?: Record<string, string>;
    prompt?: string;
    commandTools?: CommandToolConfig[];
}

const configuredPath = process.env.AGENT_LOCAL_CONFIG;
const configPath = resolve(process.cwd(), configuredPath ?? ".private/agent.json");

function stringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${field} must be an array of strings`);
    }
    return value;
}

function validateCommandTool(value: unknown, index: number): CommandToolConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`commandTools[${index}] must be an object`);
    }

    const tool = value as Record<string, unknown>;
    for (const field of ["name", "executable", "description"] as const) {
        if (typeof tool[field] !== "string" || tool[field].length === 0) {
            throw new Error(`commandTools[${index}].${field} must be a non-empty string`);
        }
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name as string)) {
        throw new Error(`commandTools[${index}].name is not a valid tool name`);
    }

    const optionalNumber = (field: "timeoutMs" | "maxOutputBytes") => {
        const item = tool[field];
        if (item !== undefined && (!Number.isInteger(item) || (item as number) <= 0)) {
            throw new Error(`commandTools[${index}].${field} must be a positive integer`);
        }
        return item as number | undefined;
    };

    let blockedArgSequences: string[][] | undefined;
    if (tool.blockedArgSequences !== undefined) {
        if (
            !Array.isArray(tool.blockedArgSequences) ||
            tool.blockedArgSequences.some((sequence) =>
                !Array.isArray(sequence) ||
                sequence.length === 0 ||
                sequence.some((item) => typeof item !== "string")
            )
        ) {
            throw new Error(`commandTools[${index}].blockedArgSequences must contain string arrays`);
        }
        blockedArgSequences = tool.blockedArgSequences as string[][];
    }

    return {
        name: tool.name as string,
        label: typeof tool.label === "string" ? tool.label : undefined,
        executable: tool.executable as string,
        description: tool.description as string,
        prependArgs: stringArray(tool.prependArgs, `commandTools[${index}].prependArgs`),
        allowedFirstArgs: stringArray(tool.allowedFirstArgs, `commandTools[${index}].allowedFirstArgs`),
        blockedFirstArgs: stringArray(tool.blockedFirstArgs, `commandTools[${index}].blockedFirstArgs`),
        blockedArgs: stringArray(tool.blockedArgs, `commandTools[${index}].blockedArgs`),
        blockedArgSequences,
        blockedArgPatterns: stringArray(tool.blockedArgPatterns, `commandTools[${index}].blockedArgPatterns`),
        timeoutMs: optionalNumber("timeoutMs"),
        maxOutputBytes: optionalNumber("maxOutputBytes"),
    };
}

function loadConfig(): LocalAgentConfig {
    if (!existsSync(configPath)) {
        if (configuredPath) {
            throw new Error(`AGENT_LOCAL_CONFIG does not exist: ${configPath}`);
        }
        return {};
    }

    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Local agent config must be a JSON object");
    }
    const raw = parsed as Record<string, unknown>;

    let workspaces: Record<string, string> | undefined;
    if (raw.workspaces !== undefined) {
        if (!raw.workspaces || typeof raw.workspaces !== "object" || Array.isArray(raw.workspaces)) {
            throw new Error("workspaces must be an object of name-to-path entries");
        }
        workspaces = {};
        for (const [name, path] of Object.entries(raw.workspaces)) {
            if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || typeof path !== "string") {
                throw new Error(`Invalid workspace entry: ${name}`);
            }
            workspaces[name] = realpathSync(resolve(process.cwd(), path));
        }
    }

    const promptFiles = stringArray(raw.promptFiles, "promptFiles");
    const promptParts = [typeof raw.prompt === "string" ? raw.prompt : ""];
    for (const file of promptFiles ?? []) {
        const promptPath = isAbsolute(file) ? file : resolve(dirname(configPath), file);
        promptParts.push(readFileSync(promptPath, "utf8"));
    }

    if (raw.commandTools !== undefined && !Array.isArray(raw.commandTools)) {
        throw new Error("commandTools must be an array");
    }

    return {
        workspaces,
        prompt: promptParts.filter(Boolean).join("\n\n").trim(),
        commandTools: (raw.commandTools as unknown[] | undefined)?.map(validateCommandTool),
    };
}

export const localAgentConfig = loadConfig();
