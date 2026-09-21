# Tests

Tests should catch a user-visible failure and make the conversation easy to read.
One real-model conversation belongs in one file, next to cases for the same feature.
Name the behavior and identify its implementation at the top of the file.

## Run

```sh
pnpm test                                                   # Offline, no credentials
pnpm eval:agent                                             # All real-model conversations
pnpm eval:agent tests/scenarios/memory                       # One feature
pnpm eval:agent tests/scenarios/workspace/find-source-symbol.test.mjs
```

Real-model cases require `DEEPSEEK_API_KEY` in the environment or `.env` and use
the configured `DEEPSEEK_MODEL`. They run serially in separate Node processes,
each with fresh temporary Git repositories, config, and memory. Each case has a
five-minute timeout. Reports under `.private/test-runs/` keep the dialogue,
tool calls, results, and assertion failure. Reports and credentials stay local.

## Feature map

| Cases | Implemented behavior |
| --- | --- |
| `scenarios/memory/archived-time` | `src/time.ts` and `src/memory/store.ts`: archived timestamps override an earlier incorrect assistant answer. |
| `scenarios/memory/remember-profile` | Memory extraction, JSON persistence, and `AgentSession` context restore a responsibility after restart. |
| `scenarios/memory/ignore-small-talk` | The distiller avoids turning casual conversation into durable memory. |
| `scenarios/memory/correct-project` | A corrected project mapping survives both restart and expiry of recent dialogue, then directs a real Git read. |
| `scenarios/memory/unverified-progress` | The distiller does not treat an assistant's unsupported success claim as verified progress. |
| `scenarios/task-execution/` | `src/prompts/emilia.ts`: act on a confirmed request, respect the requested identity, report permission denial, and clarify missing information. External CLI responses are simulated. |
| `scenarios/workspace/correct-file-target` | User correction redirects `workspace_files`; assertions inspect both repositories' actual files. |
| `scenarios/workspace/find-source-symbol` | The model calls `configured-cli` and the real C++ search binary to locate a source definition. |
| `memory.test.mjs`, `context-state.test.mjs` | Offline checks for storage, source provenance, timestamp rendering, and context refresh. |
| `message-flow.test.mjs` | Offline message queuing, failed generation recovery, and streaming-card fallback. |
| `native-search.test.mjs` | Offline search results, private-path exclusions, traversal rejection, and named workspace selection. |

## Add a conversation

Use `conversation({name, history, tools, files, events})` from
`support/agent-fixture.mjs`. Only `name` and `events` are required. `history`
seeds prior dialogue; `files` seeds temporary workspace files; `tools` selects
real local tools (`memory`, `git`, `files`, `search`) or explicit mock commands.

The `events` array reads chronologically. Each event sends a `user` message,
triggers `distill`, simulates `restart`, or ages out recent dialogue with
`ageRecentTurns`. Its `expect` checks the reply, tool calls, saved memory, or
actual files. Check mutations with exact arguments and `count: 1`; a fluent
success message alone is not evidence of execution. Unknown mock commands fail.

Read [remember-profile](scenarios/memory/remember-profile.test.mjs) for a short
conversation and [confirmed-cancellation](scenarios/task-execution/confirmed-cancellation.test.mjs)
for an external command scenario. Keep case-specific dialogue, tool responses,
and expectations in the case file; shared helpers contain no business scenarios.

No test connects to Feishu or a localization service. Simulated service results
test the agent's decisions, not the real service's permissions or delivery.
