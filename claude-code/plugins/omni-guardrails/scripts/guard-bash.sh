#!/usr/bin/env bash
# PreToolUse hook for Bash.
#   deny: commands that can destroy the machine or the home directory
#   ask:  commands that rewrite or discard git history/work
# Any other command gets no decision, so the normal permission flow applies.
set -u

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
elif command -v python3 >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')
else
  echo "omni-guardrails: jq or python3 is required; guard skipped" >&2
  exit 1  # non-blocking error: visible to the user, command proceeds
fi

[ -z "$cmd" ] && exit 0

decide() {  # $1 = deny|ask, $2 = reason
  local reason=${2//\"/\\\"}
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$reason"
  exit 0
}

matches() { printf '%s' "$cmd" | grep -Eq -- "$1"; }

# rm with both -r and -f flags (any order/combination) aimed at /, ~, $HOME, or *
rm_rf='(^|[;&|[:space:]])rm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*|-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*|(-[rR][[:space:]]+-[fF])|(-[fF][[:space:]]+-[rR])|--recursive[[:space:]]+--force|--force[[:space:]]+--recursive)[[:space:]]+'
if matches "${rm_rf}(--no-preserve-root[[:space:]]+)?(/|/\*|~|~/|~/\*|\\\$HOME|\\\$HOME/|\\\$HOME/\*|\*)([[:space:];&|]|$)"; then
  decide deny "Blocked by omni-guardrails: recursive force delete of /, home, or a wildcard root"
fi
if matches '(^|[;&|[:space:]])mkfs(\.[a-z0-9]+)?[[:space:]]' \
  || matches 'dd[[:space:]].*of=/dev/(sd|nvme|disk|hd|xvd|vd)' \
  || matches ':\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:[[:space:]]*&[[:space:]]*\}' \
  || matches 'chmod[[:space:]]+-R[[:space:]]+[0-7]*777[[:space:]]+/([[:space:]]|$)'; then
  decide deny "Blocked by omni-guardrails: destructive system command"
fi

if matches 'git[[:space:]]+push([[:space:]].*)?[[:space:]](--force|-f)([[:space:]]|$)' \
  || matches 'git[[:space:]]+push([[:space:]].*)?[[:space:]]\+[^[:space:]]+'; then
  decide ask "omni-guardrails: force push rewrites remote history (prefer --force-with-lease)"
fi
if matches 'git[[:space:]]+reset[[:space:]]+(.*[[:space:]])?--hard' \
  || matches 'git[[:space:]]+clean[[:space:]]+(.*[[:space:]])?-[a-zA-Z]*f' \
  || matches 'git[[:space:]]+(checkout|restore)[[:space:]]+(.*[[:space:]])?--[[:space:]]+\.([[:space:]]|$)'; then
  decide ask "omni-guardrails: this discards uncommitted work"
fi
if matches '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z)?sh([[:space:]]|$)'; then
  decide ask "omni-guardrails: piping a download straight into a shell"
fi

exit 0
