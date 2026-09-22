# Repeated context failures: 2026-09-22

Historical report for the superseded mode/view implementation. This investigation
changed test observation and one inaccurate mock, not the then-running service.
See [the context-tree design](context-architecture.md) for the current implementation.

## Method

Selected every failed top-level case from `session-refactor-final-full.log`:
12 complete conversations and four classifier files containing 16 inputs. Each ran
five times, serially, using `deepseek-flash` and `jev-1.13.0`, fresh repositories and
memory, and unchanged assertions. This is **60 conversations and 80 classifier
requests**, not 160 independent conversations (Node also counts parent tests).

Batch: `2026-09-22T05:59:11.114Z`. Source hashes, selected files, logs and reports are
under ignored `.private/test-runs/repeat-context/`. The runtime and test sources
were checked unchanged throughout this batch. Test-only `onPayload` tracing saved
actual serialized main-model requests without modifying them. Classifier traces
saved raw provider choices/confidence separately from the runtime's final route.

“Stable” below means failed in all five samples, not a proof of permanent failure.
A case can fail at different steps; inspect the exchange and tool outcome before
assigning a cause. Service timeouts remain failures and are labelled separately.

After reviewing the expectations, the bare “继续” with both a pending task and
recent cat discussion is **excluded from classifier correctness judgments**.
Either topic is a plausible referent; the test imposed a unique answer the user
had not supplied. That assertion has been removed. The frozen batch and counts
below remain historical measurements, not revised passing results.

The three retained inputs in `routing/archived-task-reference` were then rerun
five times: explicit task resumption, a query about the earlier document, and a
follow-up about cats. All **15/15** passed without changing the production router
or prompts (batch `2026-09-22T06:26:07.537Z`, local log
`.private/test-runs/routing-expectation-review.log`).

## Conversation results

Paths are relative to `tests/scenarios/`.

| Case | Failed / runs | Observed failure |
| --- | ---: | --- |
| `context/compacted-task` | **5/5** | The title follow-up lost its immediately preceding result in every run. Two runs also attempted an unsupported read before correctly renaming once. |
| `conversation/misrouted-greeting-reads-history` | **5/5** | A real MR query received only a greeting, with no history or business call. |
| `conversation/misrouted-chat-reads-history` | **5/5** | Four runs read the corrected document ID but stopped to ask whether to query its title; one did not read history. |
| `conversation/greeting-after-work` | 4/5 | Mixed greeting wording, failure to read history, and one timeout that exposed old work. |
| `task-execution/approval-capability` | 4/5 | Did not call CLI help before making capability claims; valid task routes were present. |
| `conversation/greeting-starts-fresh` | 3/5 | One extra greeting question; two failures to retrieve the later-requested experiment ID. |
| `task-execution/approve-after-refusal` | 2/5 | One refusal; one inaccurate mock response to a help command. Do not count both as refusals. |
| `conversation/greeting-router-outage` | 2/5 | Extra greeting questions; one injected outage also resurfaced old work. |
| `conversation/casual-after-work` | 0/5 | Previous failure did not reproduce. |
| `conversation/greeting-does-not-confirm-task` | 0/5 | Previous failure did not reproduce. |
| `conversation/single-target-pronoun` | 0/5 | Previous failure did not reproduce. |
| `conversation/thanks-after-task` | 0/5 | Previous failure did not reproduce. |

These results do not establish a production failure rate. Selection intentionally
included only previously failing cases; four clean repeats do not prove permanent
correctness either.

Both `misrouted-*` scenarios inject a deliberately wrong mode instead of calling
Jev. They measure recovery from a routing mistake, not observed Jev accuracy.

## Located failure stages

### Context selection removes the antecedent

In all five `compacted-task` runs, renaming targeted `DOC-NEW-921` and completed.
The next question was “它现在叫什么？只回答标题。” Jev chose `chat` in all five.
`selectView()` resets the social cursor on `task → chat`; `AgentSession` then
builds context from that new cursor. The captured request contained neither the
correct object nor `秋季周报`, and the model did not call the history reader.

The journal and compaction had preserved the result. The first loss in the request
path is **view selection**, followed by failure to retrieve, not data persistence.
A mode for answering a question is incorrectly being used as a new-topic boundary.
Relevant code at the time: `selectView` in the now-deleted `agent/conversation.ts` and
[AgentSession history selection](../src/agent/session.ts).

### A mode hint becomes a higher-priority instruction

In the forced-greeting case, the user still explicitly asks to query an MR. The
serialized system message adds “只回应一句简短招呼，回复到此结束”, and the view omits
the MR. All five runs answered a greeting without invoking a tool. The fact that
the instruction also calls itself a fallible hint did not make recovery reliable.

This is the `greeting` system section in [AgentSession](../src/agent/session.ts),
not a permissions error or missing tool registration.

### Retrieval can succeed while execution stops

For the corrected-document case, four requests included a `conversation.recent`
result with all three IDs and the user's correction to `DOC-CORRECT-926`. The
assistant identified that ID correctly but asked whether to read the title.
The next failure is **action selection after retrieval**. In one run it instead
stopped before reading history. No business API call occurred, so these runs do
not establish a business permission problem.

### Uncertainty changes the mode rather than preserving uncertainty

| Classifier input/context | Failed / runs | Raw provider vs runtime |
| --- | ---: | --- |
| “第一个吧”, following chat options | **5/5** | Provider chose `chat` five times, confidence 0.39–0.44; the code converted all five to fallback `task`. |
| “继续”, following the same chat | **5/5** | Provider chose `chat` five times, confidence 0.20–0.27; all became fallback `task`. |
| “继续”, older pending task then recent cat discussion | Excluded: ambiguous expectation | Provider chose `task` five times (0.39–0.58). The original assertion demanded `chat`, but both references are plausible. This does not demonstrate a Jev error. |
| “那它有什么限制？” | 2/5 | Both failures were request timeouts. All three returned answers chose `chat` with confidence 1. |

The other 12 classifier inputs passed all five samples. For the first two rows,
the model's top choice was the expected mode; the loss happened at the confidence
check and `uncertainTurn()` in the now-deleted `agent/conversation.ts`.
Simply adjusting a few words or treating every failure as a provider error would
miss this deterministic fallback behavior.

With the ambiguous expectation excluded, this batch does not establish a clear
Jev semantic-classification defect on an unambiguous input. The demonstrated
failures involve runtime fallback, context selection, instruction priority and
main-model execution, plus separate provider timeouts. This selected sample is
not sufficient to estimate Jev's general accuracy.

## Single-request controls

After the frozen batch, replayed captured requests five times per condition,
alternating condition order. Same model, tools and generation parameters; only the
stated factor changed. No tool calls were executed by this replay. The 40 raw
responses and exact request variants are in `controls-results.json` and
`controls.json` under the private batch directory.

| Comparison | Original request | One changed factor | Interpretation |
| --- | --- | --- | --- |
| Title immediately after rename | Correct title 0/5 | Retain the previous complete exchange: correct title **5/5** | Strong local evidence for the context-selection defect. |
| Substantive request misclassified as greeting | History reads 0/5 | Remove only the greeting system instruction: history reads **5/5** | The instruction suppresses recovery. This measures starting retrieval, not completion of the MR query. |
| Document ID already retrieved | Document call attempted 1/5 | Clarify the current request to explicitly query its title: attempts 5/5 | Intent-to-action interpretation contributes. All attempted calls omitted the required `title` argument; this is not five successful queries and is not a proposed phrase patch. |
| Approval capability question | CLI help calls 0/5 | Remove only “不包括审批用户的决定” sentence: help calls 0/5 | This experiment did not support blaming that sentence alone. Do not claim the refusal problem solved. |

These are diagnostic interventions, not deployment candidates. In particular,
changing the user's wording in a control must not replace the original test or
be turned into a runtime phrase rule.

## Test fidelity findings

The original approval mock matched the prefix `mr review`. That incorrectly
returned `approved` for `mr review --help`. The production assertion rejected the
missing real approval, but the fake success contaminated the conversation.

The mock helper now supports exact `args`; the approval scenario distinguishes
subcommand help from the complete authorized mutation. Its unchanged business and
reply assertions were rerun separately five times, never substituted for the frozen
batch above. Four runs issued the exact approved mutation once, with no merge; one
stopped for redundant confirmation after reading status.

Only two of those five passed every assertion. The other two executed correctly
but hit wording checks: one quoted its old refusal while apologizing for it, and
one said “批准已提交”, which the narrow success regex did not recognize. Those are
**assertion false positives**, not two additional failed approvals. The wording
assertions remain unchanged for review; do not silently count them as model defects
or relax all outcome checks to obtain a green suite.

## What to investigate next

Prioritize the demonstrated architectural mistakes: `task → chat` should not by
itself erase the immediate antecedent; uncertainty should not mean “switch to work”;
a probabilistic mode hint should not become a system instruction that suppresses a
substantive user request. Validate any alternative against greetings and implicit
references together.

Then investigate the separate action-selection and argument-generation failures
with the already-retrieved evidence held fixed. Neither a new memory backend nor
more history retrieval alone addresses that stage. Evaluate observable command
outcomes separately from free-form wording and fix inaccurate mocks before drawing
conclusions from them. No runtime fix or rollout was made in this investigation.
