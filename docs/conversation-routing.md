# Conversation modes and topic boundaries

The first router (`1ad0689`) omitted history for one exact greeting, then brought
all six recent exchanges back on the next message. An addressed greeting could
also miss the rule. That made “晚上好呀爱蜜莉雅” / “今天过得怎么样” pick up old
Jev discussions and comments about testing the assistant.

Greetings and resolved independent chats create a durable boundary in the
conversation, rather than a one-turn instruction to ignore history.

## Modes

| Mode | Meaning | Context behavior |
| --- | --- | --- |
| `greet` | A standalone greeting or farewell, including names and particles | No prior exchanges; a brief greeting without opening another topic. Starts a fresh segment. |
| `chat` | Casual conversation, feelings, knowledge questions, technical discussion | A resolved `new` starts a fresh segment; follow-ups keep the current segment and topic references. |
| `task` | A request to query or act through tools, including supplying task parameters | Recent dialogue and applicable task references. |

An independent `history` field distinguishes `new`, `current` and `recall`.
Mentioning or returning to earlier discussion permits `recall`; the existence of
an old task does not. A greeting embedded in a substantive request is classified
by that request. Thanks acknowledge the current exchange without resetting it.
The modes select context and response guidance, not tool permissions or approval
rules. All work still runs through the existing Pi tool loop.

`startsNewSegment()` is shared by context selection, memory scope and saved state.
An independent chat starts a segment only when both Jev decisions are usable;
partial/uncertain answers do not discard recent context. The saved task is retained
across topic changes. “Continue the earlier task” can restore it, while an unqualified
“continue” follows the current conversation unless the user explicitly agreed it as a task confirmation. This distinction is tested with actual
tool arguments, not just a fluent acknowledgement.

Follow-ups include both chat and task sources from the current segment: a tool
request can depend on an object or correction first introduced in chat. Switching
mode must not silently lose that evidence. Archived sources still require recall.

## Jev classification

Semantic routing uses pinned `jev-1.13.0` with two independent `Choice` questions,
`mode` and `history`, in a single HTTP request. Exact standalone greetings and
thanks keep their existing local fast path. See TypeSafe's [Choice documentation](https://docs.typesafe.ai/primitives/choice)
and [confidence semantics](https://docs.typesafe.ai/confidence).

Jev does not generate a topic name. The code retains the existing source label
when continuing and uses up to 160 characters of the user's wording for a new
label. Original message IDs remain the source of actual parameters. There is no
extra DeepSeek call to summarize or label a turn.

Each classification is used independently. Below confidence 0.5, or when Jev
chooses `uncertain`, that field falls back to chat/current. A confident recall
request remains usable even when chat versus task is uncertain. A current-history fallback
keeps both active topic/task references; it never activates archived sources
without a recall decision. A greeting requires a consistent new-history decision
before moving the boundary. Confidence is a distribution statistic, not a measured
probability of correctness; the threshold is an application choice.

Missing credentials, invalid responses, HTTP errors or the three-second deadline
use the existing current-segment fallback. Errors are logged as short reasons,
without provider bodies or credentials. These do not become new user approval
steps. No per-message relevance filter or second classifier is introduced.

## Request flow

1. Archive the user's message and load `ConversationState`.
2. Fetch up to six exchanges starting at `segmentStart`.
3. Route using the current message and the last ten complete exchanges, including
   exchanges before the boundary. Each is marked `current` or `earlier`; the original
   user/assistant text is not clipped. Active topic names still belong to the current
   segment. Seeing an earlier task is not permission to resume it.
4. Assemble the main model's context separately. Only `recall` adds the ten exchanges
   visible to the classifier and saved topic/task sources. A greeting or resolved new chat gets
   no earlier exchanges and only profile/preference memory. Later ordinary chat
   stays within that segment. A greeting also omits the current-time block.
5. Run Pi with per-turn system guidance. The user's actual request takes precedence
   if classification was mistaken. Reply through the existing streaming path.
6. Save the final reply and updated state together. A greeting or resolved new chat
   moves `segmentStart` to its message ID. Each topic/task reference records which
   segment activated it; a new chat does not replace the archived task reference.

The archive is never deleted by a topic boundary. Explicit recall can bring the old
sources into the new segment; later follow-ups can then use them. Current-segment
exchanges remain available for follow-ups and uncertain classifications.
A router error, invalid JSON, or three-second timeout preserves the current
segment and its active references, without reviving archived context.

State is an optional field in `.private/memory/transcript.json`. Existing files
without a boundary retain their previous continuity until a greeting or resolved new chat.
Each topic/task reference retains at most four message IDs: the first and latest
three. Live source groups preserve paired tool calls/results. After restart,
archived wording is restored with timestamps and an unverified-assistant label;
it is not presented as fresh tool evidence. Failed replies keep the user request
and mark the external outcome unknown.

## Tests and limits

Offline tests inspect what the model actually receives: old transcript and project
memory are absent after a new segment, the boundary survives restart and router
failure, and explicit recall restores the sources. Separate checks verify the
classifier's ten-turn limit, full text and segment labels. Giving the classifier
more context does not automatically add that context to the main model's request.

Real-model scenarios include:

- The reported addressed greeting, “今天过得怎么样”, another casual turn after
  restart, then explicit recall of the old Jev experiment identifier.
- Greeting, chatting, then resuming an MR with its original title and creating it
  exactly once.
- A pending deletion followed by a greeting and “好”: no deletion or renewed
  confirmation prompt.
- A greeting containing a real Git request, implicit web-search subjects, current
  chat choices, router outages, memory corrections, and existing task permissions.
- Several independent topics followed by generic task resumption within ten turns
  and after restart; the original document ID and title must reach exactly one write call.
- Current-document pronouns, explicit corrections back to an older document,
  first/second task choices, ambiguous targets and continuation of casual chat.

Evaluations call Jev and the configured DeepSeek model. External writes and search
responses are simulated; local Git/file operations use disposable repositories.
They do not send Feishu messages or modify real business resources. Failures are
kept in reports and return a nonzero exit code.

Classification is probabilistic: a dependent request confidently misclassified as
a new chat or greeting can lose immediate context, though its archive is retained. Greeting
wording also remains generated, not a fixed template. The architecture enforces
the saved boundary once a new segment is recognized; it cannot guarantee every
intent or sentence. Uncertain routing keeps recent context and can still expose
irrelevant details. One chat topic and one task reference are
kept; older, unreferenced details require the existing memory tool.
Reliable resolution of an unnamed task beyond the ten-turn window is not a target
of this revision. Existing named-task references remain available without adding a
new retrieval layer or another classifier.

## Topic-boundary and ten-turn validation

The repeated baseline investigation on `ff9a091` found old-work leakage in 8/10
casual-after-work runs despite correct routing. A paired context ablation removed
that leakage in 10/10 runs. This revision therefore changes context assembly,
not just the wording of the classifier criteria.

- Offline checks: **33/33 passed**, including the actual main-model payload,
  restart, uncertain decisions and full ten-turn classifier input.
- Full real-model run: **31/33 conversations** and **39/40 classifier decisions**
  passed. The two conversation failures were unnecessary questions in greetings;
  their later recall/restart checks passed. One new deferred task fell back to
  `current` at history confidence 0.49; task mode and source retention were intact.
  The evaluation correctly exited with failure. Greeting assertions remain active.
- A fixed five-round run of ten critical conversations produced **48/50 complete
  passes**. Every round passed the target, argument and call-count checks for
  pronouns, task resumption, corrections, ambiguous targets, chat continuation,
  router outage and project mapping. Neither failure was a lost search subject:
  both searches included Jev and identified TypeSafe, then said no extra third-party
  coverage was found. A blanket ban on “没搜到” incorrectly failed those answers.
  The search case now checks the actual subject/provider and still rejects asking
  for spelling/confirmation. Original reports remain unchanged.
- A production-config smoke check used the real local persona and eight tool
  declarations, with execution disabled. New casual chat and its follow-up both
  excluded the old task from the model request; neither attempted a tool.

Two scenario definitions were also corrected during development: one unique
pending document is a valid referent for “改它吧”, while two unspecified documents
require clarification; an explicit “say continue to execute” agreement is different
from an unqualified request to continue chatting. Positive and negative scenarios
now cover both, rather than teaching the assistant to ask unnecessary questions.

Reports are retained locally under `.private/test-runs/topic-boundary/` after
release: `topic-full-final.log`, `topic-offline-3.log`, `topic-repeat-progress.log`
and `topic-repeat-1790012909955/results.json`, together with earlier failed runs.
The production smoke result is `.private/test-runs/topic-production-smoke.json`.
These small samples show an improvement and no observed operation regression;
they do not establish deterministic classification or greeting quality.

## Previous Jev replacement validation (`ff9a091`)

- Offline checks: **30/30 passed**, including provider failure and independent
  handling of uncertain mode/history answers.
- Classifier-only evaluation: **26/26 passed** across eight scenario files. The
  measured median was **419 ms**, with **1,051 ms p95**, including a fresh connection
  in each file. This is a small local sample, not a latency guarantee.
- Full conversations: **22/26 passed**. Four wording failures remain: an unnecessary
  question in two greeting scenarios, and an old-work reference in two ordinary
  chats without a greeting. Every scenario ran to its end; all later recall,
  restart, operation-argument and call-count assertions passed. No expectation
  was removed, and the evaluation correctly exited with a failure status.
- A production-configuration smoke check used the local persona and eight tool
  declarations, with execution disabled. Both requests excluded the archived
  test record, and no tool was attempted. The greeting added a question. One
  comparison run on `a4228a3` with its original DeepSeek classifier produced the
  same greeting question; its context checks also passed. Jev classifies the turn
  but does not control the main model's exact wording.

Earlier candidate runs exposed two actual routing issues: treating mode/history
confidence together discarded valid recall, and ambiguous classification omitted
the source of a deferred task outside the recent window. Independent decisions,
preserving both active references under uncertainty, and clearer task criteria
address these; deferred work and out-of-window resumption now have dedicated cases.
An implicit web search also fell below the mode confidence floor; task criteria
now explicitly include read-only lookups. The floor was not lowered to pass it.

The final full run is `jev-verification.log`; offline output is `jev-checks.log`.
Deployment retains these and the earlier failed reports under
`.private/test-runs/jev-turn-router/`. Production/baseline smoke reports are
`jev-production-smoke.json` and `jev-baseline-smoke.json` in the main checkout's
`.private/test-runs/`. These results support replacing the classifier without an
observed business-operation regression; they do not establish perfect conversation
quality. The remaining wording assertions stay active for future improvements.

## Previous greeting-boundary validation (`a4228a3`)

- Offline checks: **21/21 passed**.
- Full real-model run: **22/23 passed**. All greeting-boundary scenarios and all
  eleven existing memory, task-execution and workspace scenarios passed.
- The remaining failure was the existing `casual-after-work` scenario without a
  greeting: the model still mentioned `DEMO-482`. Its assertion remains active.
- A smoke check with the real local persona and eight production tool declarations
  passed the addressed greeting and next-turn question. Tool execution was disabled;
  neither reply attempted a tool, and neither request contained the old test record.
- A single run of the same greeting case on `1ad0689` also happened to pass, despite
  its request still containing old history. This is why the new offline checks
  assert the actual context boundary, rather than treating one fluent reply as proof.

Early development runs that added a question to the greeting remain in the local
reports. The final guidance explicitly ends the reply after one greeting; it does
not inject a fixed response or retry a failed generation. These are small regression
samples, not a general success-rate estimate or a guarantee of perfect wording.

Final logs are `greeting-offline-final.log` and `greeting-final.log` in the development
worktree's `.private/test-runs/`; deployment retains copies under the main checkout's
`.private/test-runs/greeting-boundary/`. The production-config smoke report is
`.private/test-runs/greeting-production-smoke.json` in the main checkout.

## Earlier evidence

Before this revision, two fixed paired rounds compared `1ad0689` with `a5fd1f3`:
9/18 versus 17/18 scenario passes. The first router added a median 691 ms across
25 model classifications. Those measurements describe that earlier implementation,
not a success rate or latency guarantee for this revision. The user subsequently
reported the multi-turn greeting failure addressed here.

## Reproduce

```sh
pnpm test
pnpm eval:agent
pnpm eval:agent tests/scenarios/conversation
```

Per-conversation JSON reports and run logs stay under ignored `.private/test-runs/`.
Read `src/agent/session.ts` for orchestration, `conversation.ts` for classification
and state transitions, and `src/memory/store.ts` for persistence and segment ranges.
