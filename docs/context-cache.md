# Context and prompt caching

Large CLI responses previously entered every subsequent request in full. The session
also rebuilt a six-exchange window and changed system sections on each turn. A tool
loop could reuse its prefix, while the next user message or mode change invalidated it.

## Request layout

`AgentSession` keeps the leading system prompt and tool declarations unchanged during
work and discussion. Within a live segment, requests grow by appending messages. Runtime time, changed
memory snapshots, and the current user message appear after existing history; turn
guidance follows the user text. Unchanged memory snapshots are not repeated.

A greeting or resolved new chat still starts a fresh segment. An isolated greeting
keeps its original system-level response guidance; the following chat restores the
stable base prompt. This small boundary-specific cache reset preserves response policy. Explicit recall appends
missing historical evidence, marked as history, and refreshes the memory snapshot.
A failed reply is restored from the archive as an unknown outcome rather than replaying
partial generation. Restart restores bounded archived wording, not fabricated tool results.
These boundaries deliberately change the prefix; cache reuse does not override conversation intent.

## Output and context budgets

- Lark, Git, and configured CLIs share `tools/output.ts`. Model previews are bounded
  by 16 KiB, 400 lines, and 12,000 characters. A long single line still gets a preview.
  Complete captured output is saved under ignored `.private/tool-output/` with private
  permissions. The preview identifies the file and next character offset.
- `workspace_files` can read text files up to 16 MiB in pages with `offset`/`limit`.
  A preview is not the full file; remaining pages must be read before replacing it.
  Existing workspace and symlink boundaries and the 1 MiB write limit remain in force.
- The subprocess's `maxOutputBytes` still bounds capture memory. Exceeding it is an
  error with an explicit incomplete-output notice, not a successful complete result.
  Reading a saved result never repeats the original command or its side effects.
- Context compaction has a 64,000-token soft threshold (or a smaller model-window
  limit), retaining roughly 16,000 recent tokens. Pi's provider-usage-aware estimator
  determines whether to compact; its character estimate helps choose whole-turn cuts.
  The latest user message and its entire tool loop are always retained. This is a
  soft budget: a single large active turn can exceed it.
- Before the next user request and between tool iterations, older context can be
  replaced with a summary plus complete recent turns. The summary request reuses the
  original system, tool declarations, and transcript, appending an instruction with
  tool execution disabled. Summary output is capped at 2,048 tokens with a 30-second
  deadline. Empty, failed, or interrupted summaries do not silently discard history.
  An existing summary is not repeatedly summarized just because the active turn is large.
- Summaries retain corrected identifiers, authorization scope, completed actions,
  tool evidence, outstanding work, and local result paths. Raw chat remains in the
  existing JSON archive; summaries are working context, not new durable user facts.

The runtime logs input, cache-hit/miss tokens, output, estimated model cost, first-token
latency, and request duration. Summary usage is logged separately. Compare total input
and uncached tokens as well as cache percentage: carrying a huge cached result can
still cost more than a small, focused request.

## Evaluation

Offline tests inspect real DeepSeek payload serialization, stop before network I/O,
and verify unchanged prefixes across twelve turns, mode changes, and memory updates.
They also cover paging without lost Unicode characters, one-time command execution,
compaction boundaries, and preservation of history when summarization fails.

Real-model scenarios under `tests/scenarios/context/` check an answer beyond the
preview and a corrected task whose parameters must survive actual summarization.
The broader conversation suite covers greetings, references, task resumption, restart,
and authorization. Tests mock external mutations and retain failed reports locally.

A synthetic twelve-turn comparison uses the same model, one read-only report query,
a mode change, and a memory update. It compares the previous context assembly/raw CLI
output with bounded output and append-only context. It is an experiment, not a promise
of a production cache hit percentage. A 2026-09-22 run with `deepseek-flash`
made 13 model requests in each variant (12 user turns and one tool continuation):

| Measurement | Previous assembly/output | Bounded, append-only context |
| --- | ---: | ---: |
| Total input tokens | 968,144 | 56,808 |
| Uncached input tokens | 243,792 | 5,352 |
| Aggregate cache hit rate | 74.82% | 90.58% |
| Cache hit rate on mode change | 0.6% | 96.1% |
| Cache hit rate on memory update | 0.3% | 95.6% |
| Median first-token latency | 852 ms | 525 ms |

This sample reduced input by 94.1% and uncached input by 97.8%. Provider caching is
best effort; latency is one run's observation, not a statistical performance guarantee.

An initial attempt to shorten turn guidance to a mode label hurt greeting behavior.
A small prompt-layout comparison scored 2/10 with the label, 9/10 with full guidance
before the current message, and 10/10 with full guidance after it. The implementation
keeps full guidance at the tail for continuity, but subsequent conversation tests
still observed extra greeting questions. Greetings therefore retain their original
system-level guidance at their already-isolated boundary. The previous commit also
reproduced extra greeting questions. No output clipping, silent retries, or relaxed
assertions conceal model behavior. The persona prompt itself is unchanged.

Final validation on 2026-09-22:

- `pnpm test`: 38/38 offline checks passed, including actual provider payload prefixes.
- The full real-model suite ran 92 checks: 87 passed; five greeting/thanks wording
  checks failed while their task-context and tool-execution checks remained intact.
- After preserving system-level greeting guidance at the segment boundary, those
  five complete conversations passed 5/5. The full suite was not rerun after that
  isolated change; the previous failures remain in local reports.
- All three new context scenarios passed: paged result recovery, corrected target
  after summary, and compaction inside a tool loop followed by a revision-checked write.
- Production configuration (eight tools) passed an offline serialized-prefix smoke
  check. Public-source audit passed. No real external mutation was used by the tests.

## References

- [Claude Code engineering: prompt caching](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything): stable prefixes, appended updates, and summary requests that reuse the parent prefix.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): append-only history, stable tools, and evaluating total cost after compaction.
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference): separate tool-output and context-compaction budgets.
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/): prefix reuse and best-effort caching.
- Pinned Pi source in `vendor/pi`: reuse `truncateHead`, `estimateTokens`, and `estimateContextTokens`; keep the adapter small rather than replacing the app with another harness.
