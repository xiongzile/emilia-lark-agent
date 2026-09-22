import {execFile, type ExecFileOptionsWithStringEncoding} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {truncateHead} from "@earendil-works/pi-agent-core";
import {getWorkspaceRoot} from "../config/workspaces.ts";

// Bound model input independently of the subprocess's maxBuffer safety limit.
export function textPage(text: string, offset = 0, limit = 12000) {
    let end = Math.min(text.length, offset + limit);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end += end === offset + 1 ? 1 : -1;
    const candidate = text.slice(offset, end);
    const truncated = truncateHead(candidate, {maxBytes: 16 * 1024, maxLines: 400});
    // Minified JSON may be one enormous line. It still needs a readable preview.
    let content = truncated.content || candidate.slice(0, 4000);
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    const nextOffset = offset + content.length;
    return {content, nextOffset, hasMore: nextOffset < text.length};
}

export async function limitToolOutput(output: string): Promise<string> {
    const page = textPage(output);
    if (!page.hasMore) return output;
    const path = `.private/tool-output/${randomUUID()}.txt`;
    const root = getWorkspaceRoot("agent").root;
    await mkdir(join(root, ".private/tool-output"), {recursive: true, mode: 0o700});
    await writeFile(join(root, path), output, {mode: 0o600});
    return `${page.content}\n\n[Output truncated; this is not the complete result. Full output saved in workspace "agent": ${path}. Read with workspace_files operation="read", path="${path}", offset=${page.nextOffset}. Prefer command filters/pagination for focused queries. Do not repeat a write command just to recover its output.]`;
}

export async function runCommand(executable: string, args: string[], options: ExecFileOptionsWithStringEncoding): Promise<string> {
    const result = await new Promise<{output: string; error?: Error}>((resolve) => {
        execFile(executable, args, options, (error, stdout, stderr) => {
            const output = error ? stderr.trim() || stdout.trim() || error.message
                : stdout.trim() || stderr.trim() || "Command completed with no output.";
            resolve({output, error: error ?? undefined});
        });
    });
    const incomplete = (result.error as NodeJS.ErrnoException)?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const output = await limitToolOutput((incomplete
        ? "[Process stopped at its output limit. Captured output is incomplete; side effects may already have occurred. Verify the result before retrying.]\n" : "") + result.output);
    if (result.error) throw new Error(`${executable} failed (code ${(result.error as NodeJS.ErrnoException).code ?? result.error.name}): ${output}`);
    return output;
}
