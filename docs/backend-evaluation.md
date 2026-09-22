# Multi-backend evaluation — 2026-09-22

The same agent can now be evaluated with DeepSeek or Pi's existing OpenRouter
provider. Production still defaults to DeepSeek. Credentials and raw conversations
remain local. See [commands and budget controls](../tests/README.md#compare-model-backends-with-a-spending-limit).

## Scope and observations

Four existing conversations exercise greeting boundaries, returning to a recent
localization key, finding a document through the context tree, and checking whether
the CLI supports approval. Business services are simulated; model calls are real.
No real document, merge request, message or user workspace is changed.

First run: two fresh repetitions per model with live Jev routing, 32 conversations.
A second run fixes the first DeepSeek round's recorded routing decisions for all
models: one repetition each, 16 conversations. It preserves failed decisions rather
than selecting successful samples. In particular, that tape includes two timeout
fallbacks. This controls differences in routing availability; it is not a test of
ideal routing. Answers and tool calls remain live and may make later inputs differ.

| Model | Live routing: complete conversations passing | Fixed routing: complete conversations passing | Fixed-routing graded checkpoint mean /100 |
| --- | ---: | ---: | ---: |
| DeepSeek `deepseek-flash` | 4/8 | 1/4 | 81.25 |
| Claude Sonnet 5 | 4/8 | 2/4 | 78.13 |
| GPT-5.4 | 2/8 | 2/4 | 87.50 |
| Gemini 3.8 Flash | 6/8 | 3/4 | 100.00 |

Scores apply only to annotated checkpoints, not every response. In particular,
the initial greeting is checked by strict assertions but is not model-graded.
A score of 100 therefore does not imply a perfect conversation. The live DeepSeek
batch has one invalid judge quotation, retained as missing; the fixed batch has
none. The judge is DeepSeek for every backend and is not an objective oracle.

Observed differences:

- All four models ask an extra question after a standalone greeting. This violates
  the existing product expectation even when no old work is mentioned.
- DeepSeek repeatedly denies approval capability without checking CLI help.
  Claude and GPT generally describe capability or conditions without checking.
  Gemini calls help before answering in all three measured repetitions, without
  performing the approval itself.
- Tree-based document recovery passes across all four models. The original
  source and subsequent external query remain independently inspectable.
- GPT's two live recent-key failures are about call timing/count: one issues an
  additional publication query; the other already fetched claims during the initial
  publication query and later reuses that observation instead of querying again.
  These are not wrong-object or missing-context failures.
- The fixed-routing DeepSeek recent-key failure still queries and answers the
  correct key, but unnecessarily mentions an unrelated old project.
- Fixed-routing Claude brings old testing talk into casual conversation. That
  shared route tape retained a failed greeting classification and exposed the old
  topic; this illustrates the fallback boundary, not an absent source message.

Required evidence at all annotated first-request checkpoints scores 100/100.
This measures explicitly named evidence, not the relevance of every supplied
message, nor every turn. The live Gemini batch had 17 routing timeouts, compared
with two for DeepSeek and none for Claude/GPT, which is why the controlled follow-up
was necessary. It sends no live classifier requests. Its four manifests have the
same source hash, test hash, Pi revision, judge and routing-tape hash.

The small samples support differences in tool verification and common greeting
behavior. They do not establish a general model ranking or justify switching the
production model automatically.

## Cost and validation

A shared USD 5 ledger covers both runs, the judge, memory extraction, compaction,
routing and a discarded preliminary attempt. That attempt forced low reasoning
for auxiliary requests and caused memory extraction to hit its output limit; it
was stopped and excluded from quality comparisons. The final evaluator preserves
runtime/provider reasoning defaults, caps output at 2,048 tokens and disables SDK
retries. Existing smaller limits for memory and judging still apply.

At completion the ledger accounts for **USD 0.7214**, including conservative
DeepSeek/Jev estimates and **USD 0.0629** reserved for twenty requests without
settled billing (nineteen router timeouts and one interrupted preliminary Claude
request). OpenRouter responses/generation records report **USD 0.5569**. These are
not additive totals: the OpenRouter figure is already included in the ledger.
The account usage snapshot showed about USD 0.55 increase at that moment; reporting
can settle later. Credit-purchase fees and unrelated applications are outside the
local test-run budget. The later frontier-model run below continues this same ledger.

Offline validation passes **47/47**, including shared budget reservations,
interrupted streams, actual Pi serialization for all four model configurations,
Anthropic tool-evidence normalization and deterministic route replay. Direct Node
TypeScript runtime import also passes. Public-source checks exclude local secrets
and reports.

Local evidence (ignored by Git):

- Live run: `.private/test-runs/backends-2026-09-22T08-36-56-793Z/`.
- Fixed-routing run: `.private/test-runs/backends-2026-09-22T09-16-34-280Z/`.
- Shared ledger: `.private/test-runs/backends-2026-09-22T08-33-36-005Z/budget.jsonl`.

Each backend directory contains its manifest, actual request timelines, failed
assertions and scores. Reformatting these reports does not call models again.

## GPT-6 Astra and Claude Opus 5 follow-up

One fresh repetition of the same four conversations uses OpenRouter models
`openai/gpt-6-astra` and `anthropic/claude-opus-5`. Both were present in the live
OpenRouter catalog and the pinned Pi catalog. OpenAI also documents the
[GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra).
No runtime, prompt or test changes were needed. Source, test, Pi, judge and routing
tape hashes match the earlier fixed-routing comparison. The same output limits
and runtime/provider reasoning defaults apply.

| Model | Complete conversations passing | Graded checkpoint mean /100 | Required context evidence /100 | Accounted USD including auxiliaries |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Astra | 3/4 | 100.00 | 100.00 | 0.2427 |
| Claude Opus 5 | 3/4 | 93.75 | 100.00 | 0.1823 |

Both correctly query the recent key after greeting/restart/router failure, recover
the document through the context tree, and inspect CLI help before confirming
approval capability without executing an approval. GPT-6 additionally queries
claims during the initial publication query, then queries again when asked; the
conversation passes, but that first extra query is unnecessary.

Both fail the greeting conversation. GPT-6 replies with an extra question but
does not mention the old topic. Opus brings the old Jev/architecture discussion
into all three casual turns and corrects the user's evening greeting based on
the current afternoon time. The shared routing tape deliberately preserves a
timeout fallback that exposes the old topic at this greeting. This is evidence
of different responses to the same routing failure, not a clean test of correct
greeting isolation. GPT-6's 100 graded score excludes the initial greeting, as
explained above, and must not be read as a perfect conversation score.

No judge errors or annotated critical-context losses occur in this follow-up.
The largest reported output was 402 tokens for the GPT-6 run and 232 for Opus,
including auxiliary calls; failures do not show output-cap exhaustion.

The follow-up adds **USD 0.4250** to the ledger, of which **USD 0.4218** is
OpenRouter-reported billing. Cumulative accounting is now **USD 1.1464 / 5**, with
the original twenty unsettled reservations still included and no new unsettled
requests. Production remains on DeepSeek. One sample per case suggests a useful
tool-verification improvement over the earlier GPT-5.4/Sonnet/DeepSeek samples;
it does not establish stability or show that a more expensive model fixes context
selection. No further paid runs were started for this follow-up.

Local evidence: `.private/test-runs/backends-2026-09-22T09-32-43-815Z/`.
