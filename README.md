# Emilia Lark Agent

A self-hosted Lark/Feishu bot that streams DeepSeek responses into interactive cards and can use constrained local tools.

## Features

- Receives messages through the Lark long connection, so no public webhook is required.
- Streams intermediate model output into an interactive card.
- Exposes constrained file and Git tools for explicitly configured workspaces.
- Supports user and bot identities through `lark-cli`.
- Loads private workspaces, prompt instructions, and extra command-line tools from an ignored local config.
- Includes a macOS `launchd` service with automatic restart and `caffeinate -i` support.

## Requirements

- Node.js with native TypeScript stripping support
- pnpm 10
- A Lark/Feishu custom app with long-connection event delivery enabled
- A DeepSeek API key
- `lark-cli` if the agent should operate Lark resources

## Setup

```sh
cp .env.example .env
# Fill in FEISHU_APP_ID, FEISHU_APP_SECRET, and DEEPSEEK_API_KEY.
pnpm install
pnpm build
pnpm start
```

Subscribe the app to `im.message.receive_v1` and grant only the permissions required by the operations you want the bot to perform.

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
