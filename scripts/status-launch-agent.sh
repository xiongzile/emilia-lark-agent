#!/bin/zsh
set -euo pipefail

label="${AGENT_LAUNCHD_LABEL:-com.emilia.lark-agent}"
domain="gui/$(id -u)"

launchctl print "$domain/$label"

print "\nPower assertions owned by caffeinate:"
pmset -g assertions | grep -E 'caffeinate|PreventUserIdleSystemSleep' || true
