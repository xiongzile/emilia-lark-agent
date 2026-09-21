#!/bin/zsh
set -euo pipefail

label="${AGENT_LAUNCHD_LABEL:-com.emilia.lark-agent}"
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
project_dir="$(cd "$script_dir/.." && pwd -P)"
node_bin="${AGENT_NODE_BIN:-$(command -v node)}"
node_dir="$(dirname "$node_bin")"
service_path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [[ "$node_dir" != "/opt/homebrew/bin" ]]; then
    service_path="$node_dir:$service_path"
fi
launch_agents_dir="$HOME/Library/LaunchAgents"
plist_path="$launch_agents_dir/$label.plist"
log_dir="$project_dir/logs"
domain="gui/$(id -u)"

if [[ ! -x "$node_bin" ]]; then
    print -u2 "Node executable not found: $node_bin"
    exit 1
fi

if [[ ! -f "$project_dir/.env" ]]; then
    print -u2 "Missing $project_dir/.env. Copy .env.example and configure it first."
    exit 1
fi

mkdir -p "$launch_agents_dir" "$log_dir"

LABEL="$label" \
PROJECT_DIR="$project_dir" \
NODE_BIN="$node_bin" \
SERVICE_PATH="$service_path" \
PLIST_PATH="$plist_path" \
LOG_DIR="$log_dir" \
python3 <<'PY'
import os
import plistlib
from pathlib import Path

payload = {
    "Label": os.environ["LABEL"],
    "ProgramArguments": [
        "/usr/bin/caffeinate",
        "-i",
        os.environ["NODE_BIN"],
        "--env-file-if-exists=.env",
        "--enable-source-maps",
        "src/index.ts",
    ],
    "WorkingDirectory": os.environ["PROJECT_DIR"],
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "ProcessType": "Background",
    "StandardOutPath": str(Path(os.environ["LOG_DIR"]) / "agent.stdout.log"),
    "StandardErrorPath": str(Path(os.environ["LOG_DIR"]) / "agent.stderr.log"),
    "EnvironmentVariables": {
        "PATH": os.environ["SERVICE_PATH"],
    },
}

with open(os.environ["PLIST_PATH"], "wb") as stream:
    plistlib.dump(payload, stream, sort_keys=False)
PY

if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label"
    # launchd can briefly retain the old label after bootout and reject an
    # immediate bootstrap with error 5. Give deregistration time to finish.
    sleep 2
fi

if ! launchctl bootstrap "$domain" "$plist_path"; then
    sleep 2
    launchctl bootstrap "$domain" "$plist_path"
fi
launchctl enable "$domain/$label"
launchctl kickstart -k "$domain/$label"

print "Installed and started $label"
print "Logs: $log_dir/agent.stdout.log and $log_dir/agent.stderr.log"
