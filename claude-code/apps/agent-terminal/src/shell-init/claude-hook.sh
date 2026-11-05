#!/usr/bin/env bash
# Claude Code command hook for claude running inside tmux (installed into
# ~/.claude/settings.json by omni-tmux-setup).
#
# A tmux pane's shell does not carry the app's variables, but the tmux client
# showing the session was started from an app terminal and does: find the
# clients attached to this pane's session, read OMNI_* from their
# environment (/proc/<pid>/environ) and POST the hook event to that app.
#
# Silent no-op (exit 0, no output) when not in tmux, when no attached client
# came from the app, or for a claude started by the app's wrapper (OMNI_HOOKED:
# it already reports through --settings). A pane's own OMNI_* variables are not
# used: they are whatever the tmux server started with and may be stale.
[ -n "${OMNI_HOOKED:-}" ] && exit 0
[ -n "${TMUX:-}" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

session="$(tmux display-message -p -t "${TMUX_PANE:-}" '#{session_id}' 2>/dev/null)" || exit 0
[ -n "$session" ] || exit 0
clients="$(tmux list-clients -t "$session" -F '#{client_pid}' 2>/dev/null)" || exit 0
[ -n "$clients" ] || exit 0

input="$(cat)"
for pid in $clients; do
  [ -r "/proc/$pid/environ" ] || continue
  envs="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null)" || continue
  tid="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_TERMINAL_ID=//p' | head -1)"
  url="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_CWD_URL=//p' | head -1)"
  token="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_HOOK_TOKEN=//p' | head -1)"
  [ -n "$tid" ] && [ -n "$url" ] && [ -n "$token" ] || continue
  # Fire and forget: Claude does not wait on the app.
  ( printf '%s' "$input" | curl -s -m 2 -o /dev/null -X POST \
      -H 'Content-Type: application/json' \
      -H "X-Omni-Token: $token" -H "X-Omni-Terminal: $tid" \
      --data-binary @- "${url%/cwd}/hook" >/dev/null 2>&1 & )
done
exit 0
