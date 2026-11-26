#!/bin/sh
# Omni Agent Terminal: ends what an app terminal started, inside WSL (run by
# the Windows app with wsl.exe; see src/reap.js, which does the same on
# Linux and macOS). Every process started from an app terminal carries
# OMNI_TERMINAL_RUN (the app's run) and OMNI_TERMINAL_ID (the terminal).
#   $1 the run, $2 the closed terminal (empty: the app quits, every terminal),
#   $3 the terminals still open ("1 3"): a tmux server started from a closed
#      terminal stays, whole, while one of them is attached to it, and ends
#      once none is (as tmuxPlan in src/reap.js). While one is kept, this
#      looks again every minute; terminals opened since have higher numbers
#      than any it was told of, so they count as open too.
run=$1; id=$2; live=" $3 "
envof() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null; }
val() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1; }
has() { case " $1 " in *" $2 "*) return 0;; esac; return 1; }
maxid=0
for t in $live $id; do case "$t" in *[!0-9]*|'') ;; *) [ "$t" -gt "$maxid" ] && maxid=$t;; esac; done
# A terminal still open: one of $3, or one opened after this began.
open_id() {
  has "$live" "$1" && return 0
  case "$1" in *[!0-9]*|'') return 1;; esac
  [ -n "$id" ] && [ "$1" -gt "$maxid" ]
}
# mine: the closed terminal's processes (every terminal's when $id is empty);
# closed: those of every terminal no longer open; others: of those still open.
scan() {
  mine=""; closed=""; others=""
  for d in /proc/[0-9]*; do
    p=${d#/proc/}; [ "$p" = "$$" ] && continue
    e=$(envof "$p") || continue
    [ "$(val "$e" OMNI_TERMINAL_RUN)" = "$run" ] || continue
    t=$(val "$e" OMNI_TERMINAL_ID)
    if [ -z "$id" ] || [ "$t" = "$id" ]; then mine="$mine $p"; fi
    if open_id "$t"; then others="$others $p"; else closed="$closed $p"; fi
  done
}
# The tmux server a process runs in (TMUX=socket,pid,n), or nothing.
tmuxsrv() { x=$(val "$(envof "$1")" TMUX); [ -n "$x" ] || return 1; s=${x%,*}; echo "${s##*,}"; }
# tmux servers of closed terminals: kept while an open terminal is attached,
# else ended.
spare=""; ended=""
plan() {
  seen=" "
  for d in /proc/[0-9]*; do
    p=${d#/proc/}; x=$(val "$(envof "$p")" TMUX); [ -n "$x" ] || continue
    s=${x%,*}; srv=${s##*,}; sock=${s%,*}
    has "$closed" "$srv" || continue
    has "$seen" "$srv" && continue
    seen="$seen$srv "
    if [ -z "$others" ]; then ended="$ended $srv"; continue; fi
    c=$(tmux -S "$sock" list-clients -F '#{client_pid}' 2>/dev/null) || { spare="$spare $srv"; continue; }
    attached=""
    for cp in $c; do has "$others" "$cp" && attached=1; done
    if [ -n "$attached" ]; then spare="$spare $srv"; else ended="$ended $srv"; fi
  done
}
# The processes to end: the closed terminal's and the ended servers' (with
# what runs in them), never a kept server's.
pick() {
  out=""
  for p in $closed; do
    has "$spare" "$p" && continue
    srv=$(tmuxsrv "$p") || srv=""
    [ -n "$srv" ] && has "$spare" "$srv" && continue
    if has "$mine" "$p" || has "$ended" "$p" || { [ -n "$srv" ] && has "$ended" "$srv"; }; then out="$out $p"; fi
  done
  echo $out
}
end_picked() {
  p=$(pick); [ -z "$p" ] && return 0
  kill -HUP $p 2>/dev/null; kill -TERM $p 2>/dev/null; sleep 2
  scan; p=$(pick); [ -n "$p" ] && kill -KILL $p 2>/dev/null
  return 0
}
scan; plan; end_picked
# A server kept for an open terminal: looked at again every minute until
# none is kept (it ended, or the app quit and ended it). One such loop per
# run of the app (a lock folder): a later close leaves the looking to it.
# ${OMNI_REAP_EVERY} shortens the wait in tests.
lock="${TMPDIR:-/tmp}/omni-reap-$run"
if [ -n "$id" ] && [ -n "$spare" ] && mkdir "$lock" 2>/dev/null; then
  trap 'rmdir "$lock" 2>/dev/null' EXIT
  trap 'exit 0' HUP INT TERM
  while [ -n "$spare" ]; do
    sleep "${OMNI_REAP_EVERY:-60}"
    scan; spare=""; ended=""; plan; end_picked
  done
fi
exit 0
