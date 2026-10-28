#!/bin/bash
# Run an E1 script with the gateway key in the child env only (never echoed).
set -a; source ~/.local/etc/fjdac-api-key; set +a
export ANTHROPIC_BASE_URL=$(grep -E "^export ANTHROPIC_BASE_URL=" ~/.local/bin/claude-fjdac | sed -E 's/^export ANTHROPIC_BASE_URL="?([^"]+)"?/\1/')
cd /data/home/yale/work/claudecodeui && exec python3 -I "experiments/cockpit-decision-judge/$1" "${@:2}"
