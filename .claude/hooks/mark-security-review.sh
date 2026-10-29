#!/bin/bash
# PostToolUse(Skill): marks the last security-review run so check-security-review.sh
# (PreToolUse on `gh pr create`) can require a recent one before a PR opens.
set -euo pipefail

skill=$(python -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('skill',''))")
if [ "$skill" = "security-review" ]; then
  mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.claude"
  date -u +%s > "${CLAUDE_PROJECT_DIR:-.}/.claude/.security-review-marker"
fi
