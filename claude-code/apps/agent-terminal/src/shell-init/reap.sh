#!/bin/sh
# Omni Agent Terminal: ends what an app terminal started, inside WSL (run by
# the Windows app with wsl.exe; see src/reap.js, which does the same on
# Linux and macOS). Every process started from an app terminal carries
# OMNI_TERMINAL_RUN (the app's run) and OMNI_TERMINAL_ID (the terminal).
#   $1 the run, $2 the closed terminal (empty: the app quits, every terminal),
#   $3 the terminals still open ("1 3"): a tmux server one of them is attached
#      to stays, with the sessions they show; its other sessions are ended.
run=$1; id=$2; live=" $3 "
envof() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null; }
val() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1; }
scan() {
  mine=""; others=""
  for d in /proc/[0-9]*; do
    p=${d#/proc/}; [ "$p" = "$$" ] && continue
    e=$(envof "$p") || continue
    [ "$(val "$e" OMNI_TERMINAL_RUN)" = "$run" ] || continue
    t=$(val "$e" OMNI_TERMINAL_ID)
    if [ -z "$id" ] || [ "$t" = "$id" ]; then mine="$mine $p"
    else case "$live" in *" $t "*) others="$others $p";; esac; fi
  done
}
spare=""
tmuxsrv() { x=$(val "$(envof "$1")" TMUX); [ -n "$x" ] || return 1; s=${x%,*}; echo "${s##*,}"; }
keep() {
  out=""
  for p in $mine; do
    case " $spare " in *" $p "*) continue;; esac
    srv=$(tmuxsrv "$p") && case " $spare " in *" $srv "*) continue;; esac
    out="$out $p"
  done
  echo $out
}
scan
if [ -n "$id" ] && [ -n "$others" ]; then
  done_srv=" "
  for d in /proc/[0-9]*; do
    p=${d#/proc/}; x=$(val "$(envof "$p")" TMUX); [ -n "$x" ] || continue
    s=${x%,*}; srv=${s##*,}; sock=${s%,*}
    case " $mine " in *" $srv "*) ;; *) continue;; esac
    case "$done_srv" in *" $srv "*) continue;; esac
    done_srv="$done_srv$srv "
    c=$(tmux -S "$sock" list-clients -F '#{client_pid} #{session_name}' 2>/dev/null) || { spare="$spare $srv"; continue; }
    shown=$(printf '%s\n' "$c" | while read -r cp sn; do case " $others " in *" $cp "*) echo "$sn";; esac; done)
    [ -n "$shown" ] || continue
    spare="$spare $srv"
    tmux -S "$sock" list-sessions -F '#{session_name}' 2>/dev/null | while IFS= read -r sn; do
      printf '%s\n' "$shown" | grep -qxF -- "$sn" || tmux -S "$sock" kill-session -t "=$sn"
    done
  done
fi
p=$(keep); [ -z "$p" ] && exit 0
kill -HUP $p 2>/dev/null; kill -TERM $p 2>/dev/null; sleep 2
scan; p=$(keep); [ -n "$p" ] && kill -KILL $p 2>/dev/null; exit 0
