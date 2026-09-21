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
- Optionally uses Jev to select relevant past exchanges before each reply, so casual conversation can leave old work behind and task follow-ups can recover it.
- Includes a macOS `launchd` service with automatic restart and `caffeinate -i` support.

This is still a single-process, single-user demo: one Agent handles messages sequentially. Only text messages are handled. Web search returns excerpts rather than full-page verification.

Memory lives in `.private/memory/transcript.json` and `.private/memory/memories.json`, outside Git. Timestamps stay in UTC on disk and are shown to the agent in Beijing time with an explicit offset. Each reply receives core facts and selected dialogue; raw history is restored with its original user/assistant roles. After replies, a separate DeepSeek call extracts durable facts when the chat is idle for 30 seconds, after five pending turns, or immediately after an explicit “remember” request. Failed extraction leaves the original dialogue available for retry. The `memory` tool searches curated facts first and can search archived wording when the agent needs older detail.

Send `/memory` for counts and extraction status, `/memory list [category]` to inspect facts, `/memory show <id>` for provenance, `/memory update` to process pending dialogue and compare facts with recent chat, or `/memory forget <id>` to remove a fact. The update command does not claim to verify external repositories or Lark resources it has not inspected. The original transcript remains after forgetting a fact. These JSON files contain private conversation text; keep the `.private/` directory local.

## Requirements

- Node.js with native TypeScript stripping support
- pnpm 10
- CMake and a C++17 compiler for the native source-search tool
- Git submodules initialized (`git clone --recurse-submodules` or `git submodule update --init --recursive`)
- A Lark/Feishu custom app with long-connection event delivery enabled
- A DeepSeek API key
- `lark-cli` if the agent should operate Lark resources
- A Tavily API key if the agent should search the public web

## Setup

```sh
cp .env.example .env
# Fill in FEISHU_APP_ID, FEISHU_APP_SECRET, and DEEPSEEK_API_KEY.
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
Set `TAVILY_API_KEY` in the ignored `.env` to enable the `web_search` tool. Search queries are sent to Tavily; keep private documents and internal code out of them. The tool returns up to five short excerpts and URLs for attribution. Without the key, the agent continues to run without web search.

Set `JEV_API_KEY` in `.env` to enable context selection (`TYPESAFE_API_KEY` is also accepted; see the [TypeSafe API docs](https://docs.typesafe.ai/api)). Before each user turn, the runtime sends the current message and bounded excerpts from the last 20 non-command conversation turns to TypeSafe's pinned `jev-1.13.0` model. It chooses the current focus and relevant exchanges in one request. Stable personal/project facts remain available; progress and open issues enter core context only when the selector confidently identifies a task-related turn. Acknowledging a just-completed task can still include that exchange. This selection does not grant permissions or execute tools.

Live exchanges retain their complete tool-call/result groups. Restart and `/memory` commands restore archived wording with a source label; past assistant statements are not verified facts or evidence that an external operation succeeded. Interrupted turns retain the user's request with an unknown-result marker; partial model replies are not reused. Selection runs once per user turn, never between tool calls within that turn. A missing key or `AGENT_CONTEXT_SELECTION=off` uses the latest four conversation turns. On a request failure, invalid response, three-second timeout, or current message over 8,000 characters, raw history stays out of the active dialogue. The model can retrieve the latest four exchanges through `memory` with `operation: recent` when the current message needs them; it still receives the full current message. This avoids automatically restoring unrelated work during an outage. An uncertain choice retains its immediate preceding exchange; it does not ask the user for extra approval. `[Context]` logs record selected message IDs, confidence, elapsed time and fallback reasons. This fallback keeps the agent available, but resolving a reference may require an extra tool call. Changing selected history and the memory/focus sections can reduce prefix-cache reuse; base instructions and tool schemas remain unchanged.

Pi source is pinned as the `vendor/pi` submodule. The two Pi dependencies link to that source, so edits under `vendor/pi/packages/agent` or `vendor/pi/packages/ai` can be rebuilt with `pnpm build:pi` and debugged in place. To update Pi, run `git submodule update --remote vendor/pi`, rebuild and verify the agent, then commit the new submodule pointer. An update to the upstream `main` branch does not silently change an existing checkout.

## Testing

Tests must catch a real user-facing failure and read like the conversation they exercise. Keep dialogue and business expectations visible in each scenario; put setup and transport details in shared helpers. Check observable outcomes such as writes occurring only once, saved memory, and file contents. Test doubles should reject unsupported commands, and deliberately broken behavior should fail the relevant checks.

`pnpm test` builds the C++ search tool and runs offline checks for its workspace boundaries, memory persistence, context selection failures, tool-result continuity, and the message flow, including a failed streaming card and an interrupted generation followed by another message. No Feishu app or API key is needed.

`pnpm eval:agent` calls DeepSeek using `DEEPSEEK_API_KEY` from the environment or local `.env`. Conversation cases live in `tests/scenarios/`, grouped by casual conversation, memory, task execution, and workspace tools. Each file covers one behavior and identifies the implementation it exercises. The Node test runner handles discovery, process isolation, and failures; shared helpers handle temporary workspaces and the conversation timeline.

Run a feature with `pnpm eval:agent tests/scenarios/memory`, or pass one `.test.mjs` file. See [the test guide](tests/README.md) for the feature map and how to add a conversation.

These evaluations check saved memory, selected history, actual temporary-file contents, and tool arguments and call counts. Cases marked `requiresJev` also need its key and are explicitly skipped without it. External service commands are simulated: no Feishu message is sent and no configured user workspace is modified. Each case saves an ordered conversation/context/tool report under `.private/test-runs/` and returns a nonzero exit code on failure. Model evaluations can vary between runs and consume API tokens.

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
