# Context-tree refactor

The previous mode-based implementation could hide a just-mentioned resource when
switching between work and chat. Recovering an older similarly named task then
produced a fluent answer about the wrong object. Adding more business-specific
prompt rules did not fix that ownership problem.

The replacement separates original evidence, topic membership and the messages
actually sent to the model. Pi owns append-only storage. Topic branches reference
complete original turns. Selection, correction and undo change references; they
never delete evidence or repeat external operations. There is no social-view
cursor, task pin or parallel `conversation` history tool. The implementation and
commands are described in [Context tree](conversation-routing.md).

## References and limits of reuse

- [Pi sessions at the pinned revision](https://github.com/earendil-works/pi/blob/890f920884f6d21fc7617d236ef9e1cc5d7a0ef8/packages/coding-agent/docs/sessions.md): branches, stored entries and selected model context are distinct. We reuse the checked-in Pi session repository and branch APIs.
- [Pi compaction](https://github.com/earendil-works/pi/blob/890f920884f6d21fc7617d236ef9e1cc5d7a0ef8/packages/coding-agent/docs/compaction.md): summaries reduce inference context without deleting original entries. Emilia retains its budget policy and persists checkpoints per topic.
- [Context-Agent](https://arxiv.org/html/2604.05552v1): topic forests and selective context motivate the organization. This research is not a production dependency or proof that our classifier works.
- [Conversational Tree Architecture](https://arxiv.org/html/2603.21278v1): an inspectable and correctable conversation structure. Emilia implements text commands, not the paper's graphical interface.

Pi's execution branches and semantic topics are not identical concepts. Emilia's
small adapter stores topic references on Pi branches and projects their membership.
The first version is a shallow forest, with no autonomous hierarchy-building or
cross-topic summaries.

## Evaluation

Offline tests run the actual Pi tool loop and serializer with scripted model output.
They verify original tool evidence, restart, compaction, interrupted turns, migration,
same-loop context repair, whole-turn moves and persistent undo. Restoring context
must not repeat a business operation. Negative scoring tests ensure that a correct
reply cannot conceal missing input evidence or a failed judge.

Real-model tests retain exact tool-target and mutation-count assertions. In addition,
`--score --repeat=5` records two independent scores per selected exchange:

- **Context coverage, 0–100:** required original messages/tool observations in the
  first actual serialized request. Critical missing evidence is reported separately.
  The final request is also inspected, so retrieval can be distinguished from initial
  assembly; later recovery cannot erase an initial miss.
- **Reply quality, 0–100:** a separate model grades fulfillment, correct target,
  grounded outcome and conversational relevance. It must quote evidence from the
  reply/tool trace. Invalid judgments remain errors, never automatic passes.

Reports retain every repetition, mean/range/deviation, raw assertions and judge errors.
A batch manifest pins source/test hashes, Pi revision and models. Baseline comparison
rejects different cases, test versions or models. External business tools are
simulated; real Jev and DeepSeek calls still incur latency and token costs.
See [the test guide](../tests/README.md) for commands.

The [earlier repeated-failure report](context-retest.md) is historical evidence about
the superseded mode/view implementation, not a score for this tree implementation.

### Measured on 2026-09-22

Frozen batch `2026-09-22T07:27:21.270Z` used `deepseek-flash` and `jev-1.13.0`:
nine conversations, five fresh repetitions each, sixty scored exchanges. The
actual request and every failed assertion remain in the private reports.

| Check | Result |
| --- | --- |
| Offline Pi/storage/commands/tool/context tests | 40/40 passed, including direct TypeScript source startup |
| Migration of a copy of existing private data | All 45 turns retained wording, timestamps and replies; memory JSON unchanged; reopen passed |
| New tree repair, candidate choice and greeting-correction scenarios | 15/15 complete conversations passed |
| Required first-request evidence across the annotated exchanges | 100/100 coverage; no marked critical omission |
| Independent reply score | 83.7/100 equal-weight scenario mean; two invalid judge results remain missing |
| Existing strict assertions across these nine scenarios | 31/45 complete conversations passed |
| Additional inspection of fifteen scored social requests | 14 contained none of the old fixture IDs; one routing timeout reintroduced old work |
| Full regression batch `2026-09-22T07:33:08.662Z` | 38/46 complete conversations passed; one classifier input failed (Node totals: 87/97, including parent tests) |

Coverage means the explicitly required evidence was present, not that all supplied
context was relevant or that every turn was scored. The social-request check makes
that distinction visible. Greeting verbosity and unnecessary approval restrictions
still fail their existing assertions; scoring does not waive them.

The full run's eight failing conversations include four greeting-style failures,
one recovery that found the right document but did not query it, one unsupported
command attempt before a successful retry, and one capability refusal. The eighth
is a known assertion false positive: its success regex also matches the reply
“没批准成功”, despite the trace showing one denied attempt and no retry. The raw
failure is retained in these counts rather than reclassified as a passing test.

### Comparison with the published version

Matching the forty conversation names shared with the historical run of `ab1a282`,
both versions pass 33/40 strict conversation assertions. The tree implementation
does not yet demonstrate a higher overall reply success rate. The six added
conversations pass 5/6 in the full run; their results are not part of that comparison.

Three previously failing conversations now pass: resuming a paused task after chat
and restart, recovering task parameters after a recent topic change and restart,
and keeping an old deletion request out of a greeting followed by “好”. In the last
case the previous failure was unsolicited discussion of deletion, not an executed
deletion. Three previous passes now fail: a malformed rename command followed by
a successful retry, an unnecessary offer of help after a greeting, and the denied
approval reply's regex false positive described above. The denied-approval reply
also suggests another identity before disclaiming a bypass; no second attempt ran.

These are historical single-batch observations, not a randomized comparison or a
claim that all differences are caused by this refactor. The command mock in the
approval-after-refusal scenario was tightened to distinguish help from approval.
The reason to ship this iteration is concrete task recovery plus inspectable,
repairable context, supported by the new repeated tree tests and offline guarantees.
Greeting style and model willingness to execute remain unresolved.

One structural failure was isolated during the refactor: Jev sometimes selected an
older document topic for a pronoun referring to the immediately preceding document.
Before the short cross-topic bridge, that preceding source appeared in only 1/5
requests, and the complete conversation passed 1/5. With the bridge it appeared in
5/5 and the conversation passed 4/5. The remaining failure chose the wrong object
despite seeing both originals. An offline forced-wrong-route test separately verifies
the visibility guarantee. These small repeated samples are not production rates.

Earlier batches exposed two scoring defects: escaped tool-result JSON was rejected
as a quotation, and text-part arrays hid literal newlines from coverage checks.
Both were corrected with regression tests. Earlier aggregate scores are retained
as historical artifacts and are not presented as a like-for-like quality baseline.

The service's direct-source startup check also exposed TypeScript parameter properties
that worked after compilation but failed in Node's strip-only mode. They were replaced
with ordinary fields/assignments. Tree commands also use the channel's direct-text
reply path, avoiding an empty streaming card. The source-startup test executes tree
commands through the real source modules and message handler with a fake transport.
These startup/delivery corrections followed the model batch; they do not change model input.

## Remaining boundaries

Routing outages retain recent originals and may bring old work into a greeting.
The model may find an object but fail to call its business tool, or read a topic
without selecting it for later turns. These are visible in traces and tree commands;
durability alone does not make model behavior deterministic. Lexical candidate ranking
can miss semantic matches. Slash commands offer direct correction when natural
language handling is wrong.

Recorded observations describe the past. Live state must be queried again before
claiming it is current. No context operation grants new tool permissions, approves
a business action or reverses a previously executed action.
