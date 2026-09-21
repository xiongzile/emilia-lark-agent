# Product scope and development principles

Emilia is a personal assistant for routine daily work and enjoyable conversation.

- Complete simple, repetitive work quickly: routine platform operations, opening merge requests, and similar bounded tasks through configured tools.
- Make conversation natural, warm, and responsive. Conversational ease and emotional support are product goals alongside task completion.
- Major engineering deliverables, build-system migrations, and large repository refactors are outside the intended scope. Do not design toward a general-purpose autonomous coding agent.

Use this scope to evaluate every iteration:

- Tie each change to a concrete routine-work scenario or an observed conversational problem. Explain the expected benefit before introducing infrastructure.
- Choose the smallest implementation that meets the need. Hypothetical future requirements and feature parity with other agents do not justify added complexity.
- Add reliability mechanisms when an actual workflow needs them; a generic maturity checklist is not an agreed roadmap.
- Tests must catch meaningful user-facing failures and be easy to read. Keep real-model conversation cases separate by feature, with one scenario per file and a clear link to the implementation. Follow `tests/README.md`.
- Keep organization-specific examples, credentials, and configuration outside public source.
