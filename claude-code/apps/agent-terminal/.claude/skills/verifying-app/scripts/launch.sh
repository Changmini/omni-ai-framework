#!/usr/bin/env bash
# Starts the app under a virtual display with the sample HOME and remote
# debugging on port 9333 (drive it with cdp.js or Playwright's
# connectOverCDP). Stops a copy already running first.
#   launch.sh        start (waits until the debugging port answers)
#   launch.sh stop   stop it
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"   # claude-code/apps/agent-terminal
LOG="${TMPDIR:-/tmp}/agent-terminal-verify.log"
pkill -9 -f "agent-terminal/node_modules/electron" 2>/dev/null || true
[ "${1:-}" = stop ] && { echo stopped; exit 0; }
cd "$APP_DIR"
[ -x node_modules/electron/dist/electron ] || node node_modules/electron/install.js
# NODE_OPTIONS may carry flags Electron refuses; --no-sandbox because this runs as root.
(HOME=/home/user/sample-home USER=user ${EXTRA_ENV:-} env -u NODE_OPTIONS \
  xvfb-run -a -s "-screen 0 1600x900x24" node_modules/.bin/electron --no-sandbox --disable-gpu \
  --remote-debugging-port=9333 ${INSPECT:+--inspect=9229} . > "$LOG" 2>&1 &)
for _ in $(seq 1 60); do
  curl -s http://127.0.0.1:9333/json/version >/dev/null 2>&1 && { sleep 2; echo "app up (log: $LOG)"; exit 0; }
  sleep 0.5
done
echo "app did not start; see $LOG" >&2
exit 1
