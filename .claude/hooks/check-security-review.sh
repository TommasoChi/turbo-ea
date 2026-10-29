#!/bin/bash
# PreToolUse(Bash, if: Bash(gh pr create*)): blocks `gh pr create` unless
# security-review ran in the last 30 minutes (marker from mark-security-review.sh).
set -euo pipefail

# The `if` filter also fires on commands the harness cannot parse (heredocs), so re-check here.
cmd=$(python -c "import sys,json; print(json.loads(sys.stdin.buffer.read().decode('utf-8-sig')).get('tool_input',{}).get('command',''))")
case "$cmd" in *"gh pr create"*) ;; *) exit 0 ;; esac

marker="${CLAUDE_PROJECT_DIR:-.}/.claude/.security-review-marker"
now=$(date -u +%s)
if [ -f "$marker" ]; then
  age=$(( now - $(cat "$marker") ))
else
  age=999999
fi

if [ "$age" -gt 1800 ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Esegui la skill security-review prima di aprire la PR (nessun controllo recente negli ultimi 30 minuti)."}}'
fi
