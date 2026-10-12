#!/usr/bin/env bash
# SessionStart hook: prints a short git summary. Plain-text stdout is added to Claude's context.
# Never fails the session: any error results in no output.
set -u

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch=$(git -C "$dir" branch --show-current 2>/dev/null)
changed=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
recent=$(git -C "$dir" log --oneline -5 2>/dev/null)

echo "Git context (from omni-core SessionStart hook):"
echo "- Branch: ${branch:-detached HEAD}"
echo "- Uncommitted files: ${changed}"
if [ -n "$recent" ]; then
  echo "- Recent commits:"
  echo "$recent" | sed 's/^/    /'
fi
exit 0
