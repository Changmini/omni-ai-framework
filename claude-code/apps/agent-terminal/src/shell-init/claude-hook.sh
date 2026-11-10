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

# Its tmux session. $TMUX ("socket,pid,session number") still names it when
# the pane is already gone: a teammate whose pane was closed sends its
# SessionEnd after that.
session="$(tmux display-message -p -t "${TMUX_PANE:-}" '#{session_id}' 2>/dev/null)"
[ -n "$session" ] || session="\$${TMUX##*,}"
[ "$session" != '$' ] || exit 0
clients="$(tmux list-clients -t "$session" -F '#{client_pid}' 2>/dev/null)" || exit 0
[ -n "$clients" ] || exit 0

input="$(cat)"
case "$input" in *'"hook_event_name":"SessionEnd"'*|*'"hook_event_name": "SessionEnd"'*) last=1 ;; *) last=0 ;; esac
# Which pane sent it: split-pane agent teams run each teammate as its own
# claude in its own pane. Sent in the body (JSON) so non-ASCII titles survive.
pane="${TMUX_PANE:-}"
title="$(tmux display-message -p -t "$pane" '#{pane_title}' 2>/dev/null)"
esc() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }
socket="${TMUX%%,*}" # tmux server socket, so the app can select this pane
body="{\"omni\":{\"pane\":\"$(esc "$pane")\",\"title\":\"$(esc "$title")\",\"socket\":\"$(esc "$socket")\"},\"event\":$input}"
for pid in $clients; do
  [ -r "/proc/$pid/environ" ] || continue
  envs="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null)" || continue
  tid="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_TERMINAL_ID=//p' | head -1)"
  url="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_CWD_URL=//p' | head -1)"
  token="$(printf '%s\n' "$envs" | sed -n 's/^OMNI_HOOK_TOKEN=//p' | head -1)"
  [ -n "$tid" ] && [ -n "$url" ] && [ -n "$token" ] || continue
  send() {
    printf '%s' "$body" | curl -s -m 2 -o /dev/null -X POST \
      -H 'Content-Type: application/json' \
      -H "X-Omni-Token: $token" -H "X-Omni-Terminal: $tid" \
      --data-binary @- "${url%/cwd}/hook" >/dev/null 2>&1
  }
  # Fire and forget: Claude does not wait on the app. SessionEnd is sent
  # before returning: the pane may close right after, and a send left in the
  # background is killed with it.
  if [ "$last" = 1 ]; then send; else ( send & ); fi
done
exit 0
