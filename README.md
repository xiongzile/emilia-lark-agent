# Emilia Lark Agent

A self-hosted Lark/Feishu bot that streams DeepSeek responses into interactive cards and can use constrained local tools.

## Features

- Receives text messages in direct chats and group mentions over the Lark long connection; no public webhook is required.
- Acknowledges messages with a typing reaction, streams DeepSeek output into an interactive card, and falls back to a regular reply if streaming is unavailable.
- Gives the agent the current date, time, and time zone for each turn, and logs model token/cache usage.
- Runs `lark-cli` as a tool for Lark operations available to the configured user or bot identity and its permissions.
- Lists, reads, and writes UTF-8 files inside named workspaces, and runs an allowlisted set of Git commands there. Destructive Git commands and force pushes are disabled.
- Loads private workspaces, prompt instructions, and additional constrained command-line tools from an ignored local config.
- Optionally searches the public web through Tavily, returning up to five short excerpts with source URLs when `TAVILY_API_KEY` is configured.
- Saves direct-chat wording in ignored local JSON files, distills durable facts into categorized memory, and lets the agent search older memories or transcripts when needed.
- Includes a macOS `launchd` service with automatic restart and `caffeinate -i` support.

This is still a single-process, single-user demo: one Agent handles messages sequentially. Only text messages are handled. Web search returns excerpts rather than full-page verification.

Memory lives in `.private/memory/transcript.json` and `.private/memory/memories.json`, outside Git. The first turn after startup (and every 20 turns) receives a bounded selection of core facts and recent dialogue. After replies, a separate DeepSeek call extracts durable facts when the chat is idle for 30 seconds, after five pending turns, or immediately after an explicit “remember” request. Failed extraction leaves the original dialogue available for retry. The `memory` tool searches curated facts first and can search archived wording when the agent needs older detail.

Send `/memory` for counts and extraction status, `/memory list [category]` to inspect facts, `/memory show <id>` for provenance, `/memory update` to process pending dialogue and compare facts with recent chat, or `/memory forget <id>` to remove a fact. The update command does not claim to verify external repositories or Lark resources it has not inspected. The original transcript remains after forgetting a fact. These JSON files contain private conversation text; keep the `.private/` directory local.

## Requirements

- Node.js with native TypeScript stripping support
- pnpm 10
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
pnpm test
pnpm start
```

Subscribe the app to `im.message.receive_v1` and grant only the permissions required by the operations you want the bot to perform.
The default model is `deepseek-flash`; override it with `DEEPSEEK_MODEL` if the pinned Pi catalog exposes another model ID.
Set `TAVILY_API_KEY` in the ignored `.env` to enable the `web_search` tool. Search queries are sent to Tavily; keep private documents and internal code out of them. The tool returns up to five short excerpts and URLs for attribution. Without the key, the agent continues to run without web search.

Pi source is pinned as the `vendor/pi` submodule. The two Pi dependencies link to that source, so edits under `vendor/pi/packages/agent` or `vendor/pi/packages/ai` can be rebuilt with `pnpm build:pi` and debugged in place. To update Pi, run `git submodule update --remote vendor/pi`, rebuild and verify the agent, then commit the new submodule pointer. An update to the upstream `main` branch does not silently change an existing checkout.

## Testing

`pnpm test` runs offline checks for memory persistence and the message flow, including a failed streaming card and an interrupted generation followed by another message. No Feishu app or API key is needed.

`pnpm eval:agent` calls DeepSeek using `DEEPSEEK_API_KEY` from the environment or local `.env`. It creates temporary Git workspaces and memory files, then checks whether the agent remembers a stable responsibility across a restart, corrects a mistaken repository mapping before reading Git history, and avoids treating an unsupported assistant success claim as verified progress. The run never sends Feishu messages or writes to your configured workspaces. Failures return a nonzero exit code; a local JSON report is saved under `.private/test-runs/` with the observed answers, memories, and tool calls. Model evaluations can vary between runs and consume API tokens.

## Private extensions

Public and private behavior share one codebase. The repository contains the generic runtime; machine-specific workspaces and organization-specific tools live in `.private/`, which Git ignores.

```sh
mkdir -p .private
cp config/agent.local.example.json .private/agent.json
cp config/prompt.local.example.md .private/prompt.md
```

Edit `.private/agent.json` to add named workspaces and constrained command tools. Relative workspace paths are resolved from the process working directory. Prompt file paths are resolved from the config file's directory. Set `AGENT_LOCAL_CONFIG` if the config lives elsewhere.

Configured commands use `execFile` without a shell. Policies can restrict the first argument, individual arguments, consecutive argument sequences, and regular-expression matches. This provides a useful boundary but does not turn an unsafe executable into a sandbox; expose narrowly scoped CLIs and keep their authentication outside the agent.

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
