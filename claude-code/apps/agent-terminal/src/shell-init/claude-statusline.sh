#!/usr/bin/env bash
# Claude Code status line for claude running inside tmux (installed into
# ~/.claude/settings.json by omni-tmux-setup, next to claude-hook.sh).
#
# 1. Sends the status line input to the app terminal showing this tmux
#    session, found as in claude-hook.sh (the attached clients' OMNI_*
#    variables). The app takes plan usage (rate_limits) from it.
# 2. Runs the status line the user had before the setup (saved next to this
#    script) with the same input, so its output still shows.
#
# A claude started by the app's wrapper (OMNI_HOOKED) already reports through
# --settings: then only step 2 runs.
input="$(cat)"
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${OMNI_HOOKED:-}" ] && [ -n "${TMUX:-}" ] \
   && command -v curl >/dev/null 2>&1 && command -v tmux >/dev/null 2>&1; then
  session="$(tmux display-message -p -t "${TMUX_PANE:-}" '#{session_id}' 2>/dev/null)"
  clients="$([ -n "$session" ] && tmux list-clients -t "$session" -F '#{client_pid}' 2>/dev/null)"
  for pid in $clients; do
    [ -r "/proc/$pid/environ" ] || continue
    envs="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null)" || continue
    tid="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_TERMINAL_ID=//p' | head -1)"
    url="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_CWD_URL=//p' | head -1)"
    token="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_HOOK_TOKEN=//p' | head -1)"
    [ -n "$tid" ] && [ -n "$url" ] && [ -n "$token" ] || continue
    # In the background: the status line does not wait for the app.
    ( printf '%s' "$input" | curl -s -m 2 -o /dev/null -X POST \
        -H 'Content-Type: application/json' \
        -H "X-Omni-Token: $token" -H "X-Omni-Terminal: $tid" \
        --data-binary @- "${url%/cwd}/status" >/dev/null 2>&1 & )
  done
fi

orig="$dir/statusline-orig.cmd"
if [ -s "$orig" ]; then
  printf '%s' "$input" | eval "$(cat "$orig")"
fi
exit 0
