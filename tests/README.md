# Tests

Tests should catch a user-visible failure and make the conversation easy to read.
One real-model conversation belongs in one file, next to cases for the same feature.
Name the behavior and identify its implementation at the top of the file.

Use conversations whose intended outcome is clear from what the user actually
said. Do not force a unique route for an ambiguous utterance with several plausible
referents, then count a different interpretation as a model defect. Keep useful
pronoun and short-reply cases when the context identifies their target. Explicit
ambiguity tests should check clarification and absence of unintended mutations,
not require the classifier to guess an unstated intent.

## Run

```sh
pnpm test                                                   # Offline, no credentials
pnpm eval:agent                                             # All real-model conversations
pnpm eval:agent tests/scenarios/memory                       # One feature
pnpm eval:agent --repeat=5 tests/scenarios/conversation      # Fixed repeated runs
pnpm eval:agent --score --repeat=5 --label=tree tests/scenarios/conversation/recent-key-after-greeting.test.mjs
pnpm eval:agent tests/scenarios/workspace/find-source-symbol.test.mjs
```

Real-model conversations require `DEEPSEEK_API_KEY` and `JEV_API_KEY` in the environment
or `.env` and use the configured `DEEPSEEK_MODEL` plus pinned `jev-1.13.0`.
Classifier-only cases under `scenarios/routing/` require only the Jev credential.
Test files run serially in separate Node processes. Conversations use fresh
temporary Git repositories, config, and memory. Each file has a five-minute
timeout. Reports under `.private/test-runs/` keep the dialogue, tool calls,
results, serialized main-model requests, and assertion failures. Reports and credentials stay local.

`--repeat=N` runs every selected case N times (1–20), in fresh test processes,
without stopping after an assertion failure. Any failed round leaves a nonzero
exit code. JSON reports include `batch` and `round`; classify repeated failures by
the failing exchange and actual tool outcome, not just the case name. Classifier
reports also retain the raw provider answer, so a low-confidence downgrade can be
distinguished from a wrong provider choice. Full request timelines are test-only.
Production retains only the latest request for `/tree context` in the ignored private directory.

## Compare model backends with a spending limit

```sh
pnpm eval:backends --budget=5 --repeat=2
pnpm eval:backends --budget=1 --models=deepseek:deepseek-flash,openrouter:openai/gpt-5.4-mini tests/scenarios/conversation/tree-repair.test.mjs
```

The default shortlist is current DeepSeek, Claude Sonnet 5, GPT-5.4 and Gemini 3.8
Flash. Models must exist in the pinned Pi catalog. These are representative models,
not a claim to test every backend or an equal-price leaderboard. The same existing
four scripts cover greeting boundaries, recent-key recovery, tree repair and
approval capability. Add explicit paths to compare other features. No production
model or private workspace configuration is changed.

`OPENROUTER_API_KEY` is only needed for OpenRouter models. DeepSeek remains the
fixed reply judge; Jev remains the live router. Auxiliary memory and compaction use
the selected backend. All their requests share one budget. Routing is not replayed:
inspect the saved routes and actual requests before attributing a difference solely
to the answer model. Scores and strict assertions remain separate.

For a controlled follow-up, add `--routes=<one previous backend directory>`. This
replays that backend's **first round** of recorded classifier decisions for every
model, without selecting successful samples or calling Jev. Explicit outage and
forced-route events in the scenario still apply. Model replies, tool calls and
subsequent context remain live. A missing route or nonexistent target topic fails
the comparison instead of silently choosing another branch. Reports pin the tape
hash, and the runner rejects source/test/judge/tape changes during a batch.

Budgeted runs preserve runtime/provider reasoning defaults, with a 2,048-token output cap, serial test files and no
SDK retries. A text-request UTF-8 byte bound plus framing allowance and maximum
output cost is reserved **before** sending. OpenRouter requests specify a provider
price ceiling and disable provider fallback. A stream without verified billing
keeps its reservation, including a timeout or crashed child process. Read-only
billing lookups do not initiate another generation. The local budget is a
conservative test-run guard, not an account-level spending limit for unrelated apps.

OpenRouter costs come from response usage or its generation record. DeepSeek and
Jev costs are conservative list-price estimates (cache discounts are not assumed).
Pricing references: [OpenRouter usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting),
[provider ceilings](https://openrouter.ai/docs/guides/routing/provider-selection),
[TypeSafe pricing](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
Credit purchase fees are excluded. Check published prices when updating models.

Reports live in `.private/test-runs/backends-*/`: plan, per-backend raw traces and
scores, `comparison.md`, and an append-only `budget.jsonl`. Use
`--budget-file=<previous budget.jsonl>` with the same `--budget` to continue under
the **same total limit**, without resetting spent or reserved amounts. Failed
assertions or missing judge results leave a nonzero exit code but still produce
comparison reports. Do not quietly retry only the failures or label truncated
responses as evidence of lower intelligence.

## Score replies and actual context separately

An event can define `score: {goal, context: [...]}`. `goal` describes the user-visible
outcome for an independent DeepSeek judge; it is never sent to the tested agent.
Context criteria use `label`, `contains`, optional serialized-message `role`,
`absent`, and `critical`. They inspect actual message content, not tool schemas or
the runtime's proposed message list. See the recent-key and tree-repair cases.

`--score` grades annotated events only. Reply grades 0–4 become 0–100; the judge
must supply quotations from the actual reply/tool trace. Invalid grades are errors,
not passes. The initial request gets its own coverage score and critical-missing
list; final-request coverage shows whether retrieval repaired an initial omission.
Neither dimension is averaged into the other. Existing mutation/target assertions
remain active, and their failures are reported separately.

`--repeat=N` saves every sample and a `manifest.json` with source/test hashes,
model IDs and the Pi revision. `scores.md` and `scores.json` report per-case means,
ranges and deviations. A failed judge does not disappear from the denominator.
Regenerate or compare reports with:

```sh
node tests/score-report.mjs .private/test-runs/scored-<run>
node tests/score-report.mjs .private/test-runs/scored-<candidate> .private/test-runs/scored-<baseline>
```

Comparisons require identical test hashes, cases, Pi revision and model IDs.
Do not claim improvement from different fixtures or from one successful retry.
Critical evidence omissions and wrong-target mutations need individual inspection,
even when average reply quality is high. Scoring does not deploy the service.

## Feature map

| Cases | Implemented behavior |
| --- | --- |
| `scenarios/context/` | `agent/context.ts`, `tools/output.ts`, `workspace-files.ts`: recover an answer beyond the CLI preview without repeating the command; after real-model compaction, execute the corrected target once and preserve the greeting boundary; compact between tool iterations without losing paired results or the revision needed by the next write. |
| `cache-prefix.test.mjs`, `context-budget.test.mjs`, `tool-output.test.mjs` | Actual DeepSeek request serialization across twelve turns, mode/memory changes, whole-turn compaction and failure preservation, Unicode paging, complete result recovery, and bounded command errors. |
| `scenarios/routing/` | Real Jev decisions for greetings, mixed requests, technical chat, implicit references, history references and deferred tasks. No main-model reply can hide a classification failure. |
| `scenarios/conversation/` | `agent/context-tree.ts`, `tree-router.ts`, `session.ts`: greeting boundaries across several turns and restart, implicit search subjects, acknowledgements, topic changes, paused tasks and router outages. |
| `conversation/tree-repair`, `tree-candidates`, `tree-greeting-correction` | Find an object hidden in another topic, offer candidates before acting, and start a clean greeting topic after a user correction. |
| `conversation/recent-key-after-greeting`, `misrouted-chat-reads-history`, `misrouted-greeting-reads-history` | Recent target recovery with an older competing task, latest correction, restart, routing outage and forced wrong views. Assert retrieval and exact external query, not just a plausible answer. |
| `conversation/resume-task-reference`, `pronoun-target-correction`, `task-option-reference` | Restore an unnamed earlier task within ten turns after multiple topics/restart; resolve current and corrected document references; apply the latest first/second choice exactly once. |
| `conversation/ambiguous-pronoun`, `continue-current-chat`, `topic-follow-up-outage` | Clarify which of two documents is meant; continue casual chat; preserve an implicit search subject during a router outage after restart. |
| `conversation/single-target-pronoun`, `routing/agreed-task-cue` | Act on a uniquely identified target and honor an explicitly agreed continuation cue without asking the user to repeat information. |
| `scenarios/memory/archived-time` | `src/time.ts` and `src/memory/store.ts`: original timestamps override an earlier incorrect assistant answer. |
| `scenarios/memory/remember-profile` | Memory extraction, JSON persistence, and `AgentSession` context restore a responsibility after restart. |
| `scenarios/memory/ignore-small-talk` | The distiller avoids turning casual conversation into durable memory. |
| `scenarios/memory/correct-project` | A corrected project mapping survives both restart and expiry of recent dialogue, then directs a real Git read. |
| `scenarios/memory/unverified-progress` | The distiller does not treat an assistant's unsupported success claim as verified progress. |
| `scenarios/task-execution/` | `src/prompts/emilia.ts`: act on a confirmed request, respect the requested identity, report permission denial, and clarify missing information. External CLI responses are simulated. |
| `task-execution/approval-capability`, `approve-after-refusal`, `review-without-approval`, `approval-permission-denied` | Check CLI capabilities before claiming a restriction; execute an authorized approval despite an earlier refusal; distinguish review, approval and merge; stop on a real permission denial. Assert the target, identity and mutation count. |
| `scenarios/workspace/correct-file-target` | User correction redirects `workspace_files`; assertions inspect both repositories' actual files. |
| `scenarios/workspace/find-source-symbol` | The model calls `configured-cli` and the real C++ search binary to locate a source definition. |
| `jev-router.test.mjs` | Offline provider errors, rate limits, timeout, malformed or uncertain answers, mode/topic choices, low-confidence valid answers and request boundaries. |
| `context-tree.test.mjs` | Pi branch references, command inspection, restart/undo, whole-turn moves, live tool-loop repair, candidate recovery and no replayed business operations. |
| `conversation-score.test.mjs` | Missing initial evidence remains visible after successful retrieval; tool schemas cannot satisfy coverage; invalid judges cannot inflate the aggregate. |
| `journal.test.mjs` | Legacy import preserves IDs, timestamps and memory sources; recent-history pagination and full Unicode reads; compaction checkpoints survive restart without deleting originals. |
| `memory.test.mjs` | Offline checks for storage, source provenance, archive timestamp rendering and `/memory` command replies. |
| `conversation.test.mjs`, `session-conversation.test.mjs` | All modes retain tree-tool access; new topics exclude old work; actual Pi tool results survive `/memory status`, restart, interrupted generation and an uncommitted final reply. |
| `message-flow.test.mjs` | Offline message queuing, failed generation recovery, and streaming-card fallback. |
| `source-startup.test.mjs` | Load TypeScript source as launchd does; send tree commands through the actual message handler and verify direct-text delivery instead of an empty card, without a model or live Feishu connection. |
| `native-search.test.mjs` | Offline search results, private-path exclusions, traversal rejection, and named workspace selection. |

## Add a conversation

Use `conversation({name, history, tools, files, events, routerUnavailable})` from
`support/agent-fixture.mjs`. Only `name` and `events` are required. `history`
seeds prior dialogue; `files` seeds temporary workspace files; `tools` selects
real local tools (`memory`, `git`, `files`, `search`) or explicit mock commands.

The `events` array reads chronologically. Each event sends a `user` message,
triggers `distill`, simulates `restart`, or ages out recent dialogue with
`ageRecentTurns`. An event may inject a deliberately wrong `route` to verify recovery with the real main model. An event with `routerUnavailable: true/false` toggles a provider outage during the conversation. Its `expect` checks the reply, tool calls, saved memory, or
actual files. Check mutations with exact arguments and `count: 1`; a fluent
success message alone is not evidence of execution. Unknown mock commands fail.
Mock command rules can use exact `args` or a `startsWith` prefix. Use exact
arguments for mutations whose target/identity matter: `review --help` must not
match an approval response.

Expectation failures are recorded and the scripted conversation continues, so
a wording failure cannot hide a later wrong operation or broken context recovery.
Any failed expectation still fails the case; runtime errors stop it immediately.

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
its latency, model token/cache usage, and the state saved after each reply.

See [the architecture evaluation](../docs/context-architecture.md) and [the repeated-failure diagnosis](../docs/context-retest.md) for current checks and release status. Greeting cases assert the full exchange, not just a router label. `greeting-does-not-confirm-task` checks that “好” after a greeting cannot approve an old deletion request. All assertions remain active; a failed run is retained rather than silently retried.

Classifier-only examples use `routing({name, history, state, cases})` from
`support/route-fixture.mjs`. Each case names a user message and the expected mode
only. They call the production router, require a real provider
result, and save every decision and latency in a local JSON report.

Context scenarios can set `contextBudget: {maxTokens, keepTokens}` to trigger the production compactor with a small fixture, and assert `compacted: true`. Cache-prefix tests intercept the provider payload before network I/O; they check actual serialized request continuity, not merely the in-memory message list. Real cache hit percentages are measurements, not deterministic assertions.
