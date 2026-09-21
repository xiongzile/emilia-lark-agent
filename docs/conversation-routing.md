# Conversation routing experiment

Status: accepted for this single-user assistant after comparing
`experiment/conversation-routing` against rollback commit `a5fd1f3`. Acceptance
requires improved conversation quality and no observed regression in continuity,
correct tool targets, single execution, authorization handling or persistence.
Occasional unsolicited references in casual replies remain a measured quality
limitation, not a claim of zero risk or perfect behavior. Validation ran in isolated
worktrees before changing the live service.

## Runtime behavior

`AgentSession` loads a small persisted `ConversationState`, routes the current
message, assembles context, runs the normal Pi tool loop, then saves the reply and
updated state together. Routing does not execute tools or add approval gates.

- **Recent dialogue:** six exchanges, retaining complete live tool-call/result
  groups. A model-produced route cannot remove these exchanges. Only a whole
  standalone greeting/farewell matched by a small rule omits history for that turn.
  A greeting embedded in a request does not match. Thanks retain recent context.
- **Conversation state:** current topic, most recent task context and last turn
  type. Topic/task entries contain a short label and up to four source message IDs
  (first exchange plus the latest three), not a generated account of completed
  work. Social turns preserve these references. Returning to a task retrieves its
  original wording even after the recent window expires or the process restarts.
- **Long-term memory:** stable profile, preferences, project facts and decisions
  remain in core context. Progress and open issues are retrieved with the existing
  memory tool instead of being inserted as an automatic work agenda.

The router returns `NEW_TOPIC`, `CONTINUE_TOPIC`, `FOLLOW_UP`, `SOCIAL`, `META`, or
`AMBIGUOUS`, plus a task-continuation hint. Nontrivial messages use the existing
configured DeepSeek model with a small JSON-only request; there is no Jev call,
new provider key, vector database or second post-response summarization call.
Timeouts (three seconds), invalid output and request errors fall back to recent
history and saved references. Long inputs bypass classification without truncating
the user's actual message.

State is an optional `conversation` field in `.private/memory/transcript.json`;
existing version-1 files remain readable. Archived assistant wording is labeled
as historical, unverified wording. Restart restores wording, not invented tool
execution evidence. Failed generations preserve the user's request with an
unknown-outcome marker and exclude partial replies.

This is one current topic and one most-recent task context, not a multi-task
scheduler. A task reference does not claim the task is still pending or completed.
References retained by a mistaken route can still be unhelpful; retaining recent
history prevents the earlier hard-deletion failure, not all model errors.

## Evaluation

All runs used real `deepseek-flash` inference. External writes and web responses
were simulated; Git and local-file checks used disposable workspaces. No Feishu
messages or external platform writes were performed. The baseline had the same
scenario files and search schema; only fixture cleanup and test-schema export
were backported, without changing its conversation logic. The baseline has no
router dependency; in the outage scenario it simply uses its normal path.

The final implementation was frozen for two paired rounds, nine scenarios each.
These are small, targeted regression samples, not a general success-rate estimate.

| Scenario | Baseline passes / 2 | Prototype passes / 2 |
| --- | ---: | ---: |
| Natural casual language after work | 0 | 1 |
| Greeting, then recall the previous task | 0 | 2 |
| Greeting containing a real Git request | 2 | 2 |
| Standalone “why” question after work | 1 | 2 |
| Resume an MR after window expiry and restart | 0 | 2 |
| Search follow-up during router outage | 2 | 2 |
| Search Jev without repeating its name | 2 | 2 |
| “First one” / “continue” follow the chat topic | 0 | 2 |
| Thank the agent, then recall the created ID | 2 | 2 |
| **Total** | **9 / 18** | **17 / 18** |

Additional checks on the final implementation:

- `pnpm test`: **18 / 18** offline checks passed.
- `pnpm eval:agent`: **19 / 20** scenarios passed. All eleven existing memory,
  task-execution and workspace scenarios passed. The failure was casual-after-work.
- The two fixed comparison rounds passed **9 / 9** and **8 / 9**, respectively. The failed run is retained, not replaced by a retry.
- Across the paired prototype rounds, 25 successful model routing calls had a
  median of **691 ms** and p95 of **997 ms**. Four rule routes made no extra model
  call. Injected router exceptions are separate from those latency samples.
- A separate spot check with the real local persona and tool declarations answered
  a greeting and a casual message without referring to old work. Every tool
  executor was disabled in that check; it is not an end-to-end Feishu test.

## Remaining failure

With a completed task in recent history, the user said:

> 忙了一天，终于能躺会儿了

The router correctly returned `SOCIAL`, but the main model still replied with the
old task ID and cancellation count before wishing the user a rest. The same case
passed in another fixed round. Keeping history available and labeling the turn
correctly does not guarantee the model will avoid mentioning irrelevant details.

The assertion remains active in `casual-after-work.test.mjs`. No greeting-specific
prompt patch or silent retry was added to force this case green. The experiment
supports the state/reference design for continuity. The improvement was accepted
with this remaining quality limitation; it does not establish that casual
conversation is solved. Deterministic integrity failures and wrong or repeated
external actions remain release blockers. Model evaluations still return nonzero
on a failed assertion, so quality failures stay visible rather than being hidden.

## Reproduce and inspect

```sh
pnpm test
pnpm eval:agent
pnpm eval:agent tests/scenarios/conversation
```

Local evidence is retained under `.private/test-runs/`:
`conversation-offline-final.log`, `conversation-full.log`, `compare-1.log`,
`compare-2.log`, `baseline/compare-1.log`, `baseline/compare-2.log`,
`comparison.json`, and `production-config-smoke.json`. Per-conversation JSON files
contain the ordered user/assistant/tool timeline and persisted state.

Implementation entry points are `src/agent/conversation.ts` (routing and state),
`src/agent/session.ts` (context assembly), `src/agent/history.ts` (archive restore),
and `src/memory/store.ts` (persistence). Each conversational test names its target
behavior and implementation; shared helpers contain no topic-specific policy.
