# Conversation modes and greeting boundaries

The first router (`1ad0689`) omitted history for one exact greeting, then brought
all six recent exchanges back on the next message. An addressed greeting could
also miss the rule. That made “晚上好呀爱蜜莉雅” / “今天过得怎么样” pick up old
Jev discussions and comments about testing the assistant.

The current design treats a greeting as a durable boundary in the conversation,
not a one-turn instruction to ignore history.

## Modes

| Mode | Meaning | Context behavior |
| --- | --- | --- |
| `greet` | A standalone greeting or farewell, including names and particles | No prior exchanges; a brief greeting without opening another topic. Starts a fresh segment. |
| `chat` | Casual conversation, feelings, knowledge questions, technical discussion | Recent dialogue in the current segment and its topic references. |
| `task` | A request to query or act through tools, including supplying task parameters | Recent dialogue and applicable task references. |

An independent `history` field distinguishes `new`, `current` and `recall`.
Mentioning or returning to earlier discussion permits `recall`; the existence of
an old task does not. A greeting embedded in a substantive request is classified
by that request. Thanks acknowledge the current exchange without resetting it.
The modes select context and response guidance, not tool permissions or approval
rules. All work still runs through the existing Pi tool loop.

## Request flow

1. Archive the user's message and load `ConversationState`.
2. Fetch up to six exchanges starting at `segmentStart`.
3. Route using the current message, the last three of those exchanges, and topic
   names belonging to this segment. Archived task names are excluded even from
   the classifier, so they cannot turn an ordinary acknowledgement into approval.
4. Assemble the main model's context. Only `recall` adds the six exchanges before
   the boundary and saved topic/task sources. A greeting itself gets no exchanges
   and no current-time block. Ordinary chat after a greeting does not receive old
   project/decision memory automatically; profile and preferences remain available.
5. Run Pi with per-turn system guidance. The user's actual request takes precedence
   if classification was mistaken. Reply through the existing streaming path.
6. Save the final reply and updated state together. A greeting moves `segmentStart`
   to its message ID. Each topic/task reference records which segment activated it.

The archive is never deleted by a greeting. Explicit recall can bring the old
sources into the new segment; later follow-ups can then use them. Current-segment
exchanges remain available even if a normal chat/task classification is wrong.
A router error, invalid JSON, or three-second timeout preserves the current
segment and its active references, without reviving archived context.

State is an optional field in `.private/memory/transcript.json`. Existing files
without a boundary retain their previous continuity until the next greeting.
Each topic/task reference retains at most four message IDs: the first and latest
three. Live source groups preserve paired tool calls/results. After restart,
archived wording is restored with timestamps and an unverified-assistant label;
it is not presented as fresh tool evidence. Failed replies keep the user request
and mark the external outcome unknown.

## Tests and limits

Offline tests inspect what the model actually receives: old transcript and project
memory are absent after a greeting, the boundary survives restart and router
failure, and explicit recall restores the sources. A separate check verifies that
the router itself does not receive archived task names.

Real-model scenarios include:

- The reported addressed greeting, “今天过得怎么样”, another casual turn after
  restart, then explicit recall of the old Jev experiment identifier.
- Greeting, chatting, then resuming an MR with its original title and creating it
  exactly once.
- A pending deletion followed by a greeting and “好”: no deletion or renewed
  confirmation prompt.
- A greeting containing a real Git request, implicit web-search subjects, current
  chat choices, router outages, memory corrections, and existing task permissions.

Evaluations call the configured DeepSeek model. External writes and search
responses are simulated; local Git/file operations use disposable repositories.
They do not send Feishu messages or modify real business resources. Failures are
kept in reports and return a nonzero exit code.

Classification is probabilistic: a real request misclassified as a greeting can
lose immediate context for that reply, though its archive is retained. Greeting
wording also remains generated, not a fixed template. The architecture enforces
the saved boundary once a greeting is recognized; it cannot guarantee every
intent or sentence. Casual chat without a greeting keeps its recent segment and
can still mention irrelevant details. One chat topic and one task reference are
kept; older, unreferenced details require the existing memory tool.

## Validation of this revision

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
