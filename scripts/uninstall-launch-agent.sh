#!/bin/zsh
set -euo pipefail

label="${AGENT_LAUNCHD_LABEL:-com.emilia.lark-agent}"
plist_path="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || \
    launchctl bootout "$domain" "$plist_path" 2>/dev/null || true
rm -f "$plist_path"

print "Stopped and removed $label"
