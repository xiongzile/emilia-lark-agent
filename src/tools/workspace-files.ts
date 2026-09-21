import {lstat, mkdir, readdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {Type} from "@earendil-works/pi-ai";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import {getWorkspaceRoot, workspaceNames} from "../config/workspaces.ts";

const maxReadBytes = 256 * 1024;
const maxWriteBytes = 1024 * 1024;

const parameters = Type.Object({
    workspace: Type.Optional(Type.String({
        description: `Named workspace. Defaults to agent. Available: ${workspaceNames.join(", ")}.`,
    })),
    operation: Type.Union([
        Type.Literal("list"),
        Type.Literal("read"),
        Type.Literal("write"),
    ], {
        description: "list a directory, read a UTF-8 text file, or create/overwrite a UTF-8 text file",
    }),
    path: Type.String({
        description: "Path relative to the workspace root. Use '.' for the workspace root.",
    }),
    content: Type.Optional(Type.String({
        description: "Complete UTF-8 file content. Required for write and ignored otherwise.",
    })),
});

function isWithinWorkspace(workspaceRoot: string, path: string): boolean {
    const relativePath = relative(workspaceRoot, path);
    return relativePath === "" || (
        relativePath !== ".." &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath)
    );
}

function resolveLexicalPath(workspaceRoot: string, inputPath: string): string {
    const candidate = resolve(workspaceRoot, inputPath);
    if (!isWithinWorkspace(workspaceRoot, candidate)) {
        throw new Error(`Path is outside the allowed workspace: ${inputPath}`);
    }
    return candidate;
}

async function resolveExistingPath(workspaceRoot: string, inputPath: string): Promise<string> {
    const candidate = resolveLexicalPath(workspaceRoot, inputPath);
    const actualPath = await realpath(candidate);
    if (!isWithinWorkspace(workspaceRoot, actualPath)) {
        throw new Error(`Path resolves outside the allowed workspace: ${inputPath}`);
    }
    return actualPath;
}

async function resolveWritePath(workspaceRoot: string, inputPath: string): Promise<string> {
    const candidate = resolveLexicalPath(workspaceRoot, inputPath);
    if (candidate === workspaceRoot) {
        throw new Error("The workspace root cannot be overwritten");
    }

    let targetExists = false;
    try {
        await lstat(candidate);
        targetExists = true;
        const actualPath = await realpath(candidate);
        if (!isWithinWorkspace(workspaceRoot, actualPath)) {
            throw new Error(`Path resolves outside the allowed workspace: ${inputPath}`);
        }
        return actualPath;
    } catch (error) {
        if (targetExists) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    let ancestor = dirname(candidate);
    while (true) {
        try {
            const ancestorStat = await lstat(ancestor);
            if (!ancestorStat.isDirectory() && !ancestorStat.isSymbolicLink()) {
                throw new Error(`Parent path is not a directory: ${relative(workspaceRoot, ancestor)}`);
            }

            const actualAncestor = await realpath(ancestor);
            const actualTarget = resolve(actualAncestor, relative(ancestor, candidate));
            if (
                !isWithinWorkspace(workspaceRoot, actualAncestor) ||
                !isWithinWorkspace(workspaceRoot, actualTarget)
            ) {
                throw new Error(`Path resolves outside the allowed workspace: ${inputPath}`);
            }
            return candidate;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            ancestor = parent;
        }
    }
}

function displayPath(workspaceRoot: string, path: string): string {
    return relative(workspaceRoot, path) || ".";
}

export const workspaceFilesTool: AgentTool<
    typeof parameters,
    {workspace: string; operation: string; path: string}
> = {
    name: "workspace_files",
    label: "Workspace Files",
    description: [
        `List directories and read or write UTF-8 text files in named workspaces: ${workspaceNames.join(", ")}.`,
        "Paths outside this workspace are rejected, including paths reached through symbolic links.",
        "Use relative paths. Reads are limited to 256 KiB and writes to 1 MiB.",
        "Writing replaces the complete file and creates missing parent directories. Deletion is not supported.",
    ].join(" "),
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, {workspace, operation, path, content}, signal) {
        signal?.throwIfAborted();
        const selectedWorkspace = getWorkspaceRoot(workspace);
        const {root: workspaceRoot} = selectedWorkspace;

        if (operation === "list") {
            const actualPath = await resolveExistingPath(workspaceRoot, path);
            const pathStat = await stat(actualPath);
            if (!pathStat.isDirectory()) throw new Error(`Not a directory: ${path}`);

            const entries = await readdir(actualPath, {withFileTypes: true});
            const result = entries
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory()
                        ? "directory"
                        : entry.isFile()
                            ? "file"
                            : entry.isSymbolicLink()
                                ? "symlink"
                                : "other",
                }));
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        workspace: selectedWorkspace.name,
                        path: displayPath(workspaceRoot, actualPath),
                        entries: result,
                    }),
                }],
                details: {workspace: selectedWorkspace.name, operation, path},
            };
        }

        if (operation === "read") {
            const actualPath = await resolveExistingPath(workspaceRoot, path);
            const pathStat = await stat(actualPath);
            if (!pathStat.isFile()) throw new Error(`Not a file: ${path}`);
            if (pathStat.size > maxReadBytes) {
                throw new Error(`File exceeds the ${maxReadBytes}-byte read limit: ${path}`);
            }

            const data = await readFile(actualPath, {signal});
            if (data.includes(0)) throw new Error(`Binary files are not supported: ${path}`);
            return {
                content: [{type: "text", text: data.toString("utf8")}],
                details: {workspace: selectedWorkspace.name, operation, path},
            };
        }

        if (content === undefined) throw new Error("content is required for write");
        if (Buffer.byteLength(content, "utf8") > maxWriteBytes) {
            throw new Error(`Content exceeds the ${maxWriteBytes}-byte write limit`);
        }

        const targetPath = await resolveWritePath(workspaceRoot, path);
        await mkdir(dirname(targetPath), {recursive: true});
        await writeFile(targetPath, content, {encoding: "utf8", signal});
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    workspace: selectedWorkspace.name,
                    path: displayPath(workspaceRoot, targetPath),
                    bytesWritten: Buffer.byteLength(content, "utf8"),
                }),
            }],
            details: {workspace: selectedWorkspace.name, operation, path},
        };
    },
};
