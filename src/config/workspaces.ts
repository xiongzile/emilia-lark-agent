import {realpathSync} from "node:fs";
import {localAgentConfig} from "./local.ts";

export const workspaceRoots: Record<string, string> = {
    agent: realpathSync(process.cwd()),
    ...localAgentConfig.workspaces,
};

export const workspaceNames = Object.keys(workspaceRoots);

export function getWorkspaceRoot(name: string | undefined): {
    name: string;
    root: string;
} {
    const resolvedName = name ?? "agent";
    if (!workspaceNames.includes(resolvedName)) {
        throw new Error(
            `Unknown workspace '${resolvedName}'. Allowed workspaces: ${workspaceNames.join(", ")}`,
        );
    }

    return {name: resolvedName, root: workspaceRoots[resolvedName]};
}
