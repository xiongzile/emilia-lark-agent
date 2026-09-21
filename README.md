# Emilia Lark Agent

A self-hosted Lark/Feishu bot that streams DeepSeek responses into interactive cards and can use constrained local tools.

## Features

- Receives text messages in direct chats and group mentions over the Lark long connection; no public webhook is required.
- Acknowledges messages with a typing reaction, streams DeepSeek output into an interactive card, and falls back to a regular reply if streaming is unavailable.
- Gives the agent the current date, time, and time zone for each turn, and logs model token/cache usage.
- Runs `lark-cli` as a tool for Lark operations available to the configured user or bot identity and its permissions.
- Lists, reads, and writes UTF-8 files inside named workspaces, and runs an allowlisted set of Git commands there. Destructive Git commands and force pushes are disabled.
- Can search source text with an optional C++ CLI tool. It stays inside the selected workspace and skips hidden paths, generated directories, symlinks, binary files, and files over 1 MiB.
- Loads private workspaces, prompt instructions, and additional constrained command-line tools from an ignored local config.
- Optionally searches the public web through Tavily, returning up to five short excerpts with source URLs when `TAVILY_API_KEY` is configured.
- Saves direct-chat wording in ignored local JSON files, distills durable facts into categorized memory, and lets the agent search older memories or transcripts when needed.
- Includes a macOS `launchd` service with automatic restart and `caffeinate -i` support.

Conversation routing distinguishes greetings, conversation (including technical discussion), and tool-based work. A greeting or clearly independent chat starts a fresh dialogue segment; follow-ups retain that segment, and explicit task resumption restores archived parameters. Uncertain classification preserves current context. See [the design and evaluation report](docs/conversation-routing.md) for behavior, tests and limitations.

This is still a single-process, single-user demo: one Agent handles messages sequentially. Only text messages are handled. Web search returns excerpts rather than full-page verification.

Memory lives in `.private/memory/transcript.json` and `.private/memory/memories.json`, outside Git. Timestamps stay in UTC on disk and are shown to the agent in Beijing time with an explicit offset. The runtime keeps six recent exchanges within the current dialogue segment, plus durable source references for the current topic and most recent task. Jev classifies `greet`, `chat`, or `task` and the relation to earlier dialogue in one request; greetings with names or conversational particles use semantic classification. Greeting and new-chat boundaries survive restart. Ordinary follow-ups and routing failures do not automatically restore earlier segments. Greetings, new chats and their casual follow-ups receive only profile/preference memory by default; work and explicit recall can also receive stable project facts and decisions. Progress and open issues remain available through the memory tool. After replies, a separate DeepSeek call extracts durable facts when the chat is idle for 30 seconds, after five pending turns, or immediately after an explicit “remember” request. Failed extraction leaves the original dialogue available for retry. The `memory` tool searches curated facts first and can search archived wording when the agent needs older detail.

Send `/memory` for counts and extraction status, `/memory list [category]` to inspect facts, `/memory show <id>` for provenance, `/memory update` to process pending dialogue and compare facts with recent chat, or `/memory forget <id>` to remove a fact. The update command does not claim to verify external repositories or Lark resources it has not inspected. The original transcript remains after forgetting a fact. These JSON files contain private conversation text; keep the `.private/` directory local.

## Requirements

- Node.js with native TypeScript stripping support
- pnpm 10
- CMake and a C++17 compiler for the native source-search tool
- Git submodules initialized (`git clone --recurse-submodules` or `git submodule update --init --recursive`)
- A Lark/Feishu custom app with long-connection event delivery enabled
- A DeepSeek API key
- A TypeSafe/Jev API key for semantic turn routing
- `lark-cli` if the agent should operate Lark resources
- A Tavily API key if the agent should search the public web

## Setup

```sh
cp .env.example .env
# Fill in FEISHU_APP_ID, FEISHU_APP_SECRET, DEEPSEEK_API_KEY, and JEV_API_KEY.
git submodule update --init --recursive
pnpm build:pi
pnpm install
pnpm build
pnpm build:native
pnpm test
pnpm start
```

Subscribe the app to `im.message.receive_v1` and grant only the permissions required by the operations you want the bot to perform.
The default model is `deepseek-flash`; override it with `DEEPSEEK_MODEL` if the pinned Pi catalog exposes another model ID.
Set `JEV_API_KEY` in the ignored `.env` for turn classification (the `TYPESAFE_API_KEY` alias also works). The router sends the current message, the full text of up to ten recent exchanges marked by conversation segment, and active topic clues to TypeSafe. The main model receives history selected for the current turn, not automatically everything seen by Jev. It pins `jev-1.13.0`; DeepSeek still handles replies, tools, and memory distillation. Missing credentials, provider errors, and uncertain answers preserve current context. No extra SDK is required.
Set `TAVILY_API_KEY` in the ignored `.env` to enable the `web_search` tool. Search queries are sent to Tavily; keep private documents and internal code out of them. The tool returns up to five short excerpts and URLs for attribution. Without the key, the agent continues to run without web search.

Pi source is pinned as the `vendor/pi` submodule. The two Pi dependencies link to that source, so edits under `vendor/pi/packages/agent` or `vendor/pi/packages/ai` can be rebuilt with `pnpm build:pi` and debugged in place. To update Pi, run `git submodule update --remote vendor/pi`, rebuild and verify the agent, then commit the new submodule pointer. An update to the upstream `main` branch does not silently change an existing checkout.

## Testing

Tests must catch a real user-facing failure and read like the conversation they exercise. Keep dialogue and business expectations visible in each scenario; put setup and transport details in shared helpers. Check observable outcomes such as writes occurring only once, saved memory, and file contents. Test doubles should reject unsupported commands, and deliberately broken behavior should fail the relevant checks.

`pnpm test` builds the C++ search tool and runs offline checks for its workspace boundaries, memory persistence, and the message flow, including routing failures, task-state persistence, paired tool-result continuity, a failed streaming card and an interrupted generation followed by another message. No Feishu app or API key is needed.

`pnpm eval:agent` calls Jev and DeepSeek using `JEV_API_KEY` and `DEEPSEEK_API_KEY` from the environment or local `.env`. Classifier-only cases in `tests/scenarios/routing/` require only the Jev key. Conversation cases live in `tests/scenarios/`, grouped by conversation, memory, task execution, and workspace tools. Each file covers one behavior and identifies the implementation it exercises. The Node test runner handles discovery, process isolation, and failures; shared helpers handle temporary workspaces and the conversation timeline.

Run a feature with `pnpm eval:agent tests/scenarios/memory`, or pass one `.test.mjs` file. See [the test guide](tests/README.md) for the feature map and how to add a conversation.

These evaluations check saved memory, actual temporary-file contents, and tool arguments and call counts. External service commands are simulated: no Feishu message is sent and no configured user workspace is modified. Each case saves an ordered conversation/tool report under `.private/test-runs/` and returns a nonzero exit code on failure. Model evaluations can vary between runs and consume API tokens.

## Private extensions

Public and private behavior share one codebase. The repository contains the generic runtime; machine-specific workspaces and organization-specific tools live in `.private/`, which Git ignores.

```sh
mkdir -p .private
cp config/agent.local.example.json .private/agent.json
cp config/prompt.local.example.md .private/prompt.md
```

Edit `.private/agent.json` to add named workspaces and constrained command tools. Relative workspace paths are resolved from the process working directory. Prompt file paths are resolved from the config file's directory. Set `AGENT_LOCAL_CONFIG` if the config lives elsewhere.

Keep the always-loaded private prompt short. Put detailed project mappings and procedures in `.private/knowledge/` and let the agent read them through `workspace_files` when a task needs them.

Configured commands use `execFile` without a shell. Policies can restrict the first argument, individual arguments, consecutive argument sequences, and regular-expression matches. This provides a useful boundary but does not turn an unsafe executable into a sandbox; expose narrowly scoped CLIs and keep their authentication outside the agent.

To enable the C++ search tool, add this object to the `commandTools` array in `.private/agent.json` after `pnpm build:native` (replace the executable with your checkout's absolute path):

```json
{
  "name": "workspace_search",
  "label": "Workspace Search (C++)",
  "executable": "/path/to/repo/.local/native-build/workspace-search",
  "description": "Search literal source text in a named workspace. args: [query, optional relative path], optionally prefixed with --ignore-case. Narrow the path in large repositories.",
  "timeoutMs": 30000,
  "maxOutputBytes": 65536
}
```

The executable accepts a literal query and optional relative path. It returns `path:line:column: excerpt`, at most 80 matching lines, and stops after 30,000 files; narrow the path if that limit is reached.

For a team, keep the internal configuration in a separate private repository or private package and generate `.private/agent.json` during setup. Avoid public/private branches that carry different source trees: they drift and make accidental disclosure more likely.

## Safety checks

Before publishing:

```sh
pnpm audit:public
pnpm build
git status --short
```

The audit catches common private paths, identifiers, domains, and credential shapes in tracked or unignored files. Also enable GitHub secret scanning and push protection. If a credential has ever been committed, rotate it and create clean public history; a later deletion does not remove it from old commits.

## macOS background service

```sh
pnpm service:install
pnpm service:status
pnpm service:uninstall
```

The service keeps the process alive and prevents idle system sleep while still allowing the display to turn off and the Mac to lock. Logs are written under `logs/`.

See [DEBUGGING.md](DEBUGGING.md) for local debugging details.

## License

[MIT](LICENSE)
