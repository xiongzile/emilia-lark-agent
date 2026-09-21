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
| `scenarios/conversation/` | `agent/conversation.ts`, `session.ts`, `history.ts`: greeting boundaries across several turns and restart, implicit search subjects, acknowledgements, topic changes, paused tasks and router outages. |
| `scenarios/memory/archived-time` | `src/time.ts` and `src/memory/store.ts`: archived timestamps override an earlier incorrect assistant answer. |
| `scenarios/memory/remember-profile` | Memory extraction, JSON persistence, and `AgentSession` context restore a responsibility after restart. |
| `scenarios/memory/ignore-small-talk` | The distiller avoids turning casual conversation into durable memory. |
| `scenarios/memory/correct-project` | A corrected project mapping survives both restart and expiry of recent dialogue, then directs a real Git read. |
| `scenarios/memory/unverified-progress` | The distiller does not treat an assistant's unsupported success claim as verified progress. |
| `scenarios/task-execution/` | `src/prompts/emilia.ts`: act on a confirmed request, respect the requested identity, report permission denial, and clarify missing information. External CLI responses are simulated. |
| `scenarios/workspace/correct-file-target` | User correction redirects `workspace_files`; assertions inspect both repositories' actual files. |
| `scenarios/workspace/find-source-symbol` | The model calls `configured-cli` and the real C++ search binary to locate a source definition. |
| `memory.test.mjs` | Offline checks for storage, source provenance and timestamp rendering. |
| `conversation.test.mjs`, `session-conversation.test.mjs` | Current-segment continuity, durable greeting boundaries, archived-context exclusion from both routing and responses, memory scope, and paired tool results while live. |
| `message-flow.test.mjs` | Offline message queuing, failed generation recovery, and streaming-card fallback. |
| `native-search.test.mjs` | Offline search results, private-path exclusions, traversal rejection, and named workspace selection. |

## Add a conversation

Use `conversation({name, history, tools, files, events, routerUnavailable})` from
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

`routerUnavailable: true` injects a routing failure while still calling the real
main model. Call expectations support `query: /pattern/` for the real search
schema. `support/web-search.mjs` returns fixed public snippets without giving
corrective instructions to a bad query. Conversation reports include the route,
its latency, and the state saved after each reply.

See [the design and evaluation report](../docs/conversation-routing.md) for current checks and the earlier comparison. Greeting cases assert the full exchange, not just a router label. `greeting-does-not-confirm-task` checks that “好” after a greeting cannot approve an old deletion request. All assertions remain active; a failed run is retained rather than silently retried.
