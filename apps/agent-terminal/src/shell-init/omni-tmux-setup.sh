#!/usr/bin/env bash
# Lets claude running inside tmux report its status to Omni Agent Terminal.
#
#   omni-tmux-setup            install (or update) the hook
#   omni-tmux-setup --remove   remove it again
#
# Copies claude-hook.sh and claude-statusline.sh to
# ~/.local/share/omni-agent-terminal/ and adds them to ~/.claude/settings.json
# (a backup is written first): the hook as a command hook for the status, the
# status line for plan usage. The user's own statusLine is saved next to them
# (statusline-orig.json / .cmd), still runs from ours, and comes back on
# --remove. Both do nothing for the app unless the tmux session is shown in
# an app terminal. Restart claude afterwards (claude --continue keeps the
# conversation).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/.local/share/omni-agent-terminal"
HOOK="$DEST_DIR/claude-hook.sh"
STATUSLINE="$DEST_DIR/claude-statusline.sh"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
EVENTS="UserPromptSubmit PreToolUse PostToolUse PostToolUseFailure PermissionRequest Notification Stop StopFailure SubagentStart SubagentStop TeammateIdle TaskCreated TaskCompleted SessionEnd"
MODE="${1:-install}"

command -v python3 >/dev/null 2>&1 || { echo "python3가 필요합니다: sudo apt install -y python3" >&2; exit 1; }

if [ "$MODE" != "--remove" ]; then
  command -v curl >/dev/null 2>&1 || echo "[!] curl이 없습니다: sudo apt install -y curl" >&2
  mkdir -p "$DEST_DIR"
  # Strip CR in case the source came from a Windows checkout.
  tr -d '\r' < "$SRC_DIR/claude-hook.sh" > "$HOOK"
  tr -d '\r' < "$SRC_DIR/claude-statusline.sh" > "$STATUSLINE"
  chmod +x "$HOOK" "$STATUSLINE"
fi

mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ]; then
  BACKUP="$SETTINGS.omni-backup-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS" "$BACKUP"
fi

python3 - "$SETTINGS" "$HOOK" "$STATUSLINE" "$MODE" $EVENTS <<'PY'
import json, os, sys
path, hook, statusline, mode, events = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
orig_json = os.path.join(os.path.dirname(statusline), "statusline-orig.json")
orig_cmd = os.path.join(os.path.dirname(statusline), "statusline-orig.cmd")
data = {}
if os.path.exists(path) and os.path.getsize(path) > 0:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
hooks = data.setdefault("hooks", {})

def ours(h):
    return isinstance(h, dict) and h.get("type") == "command" and str(h.get("command", "")).endswith("omni-agent-terminal/claude-hook.sh")

# Drop any earlier copy of our hook, keep everything else untouched.
for event in list(hooks):
    groups = []
    for g in hooks[event] if isinstance(hooks[event], list) else []:
        if isinstance(g, dict) and isinstance(g.get("hooks"), list):
            g = {**g, "hooks": [h for h in g["hooks"] if not ours(h)]}
            if not g["hooks"]:
                continue
        groups.append(g)
    if groups:
        hooks[event] = groups
    else:
        del hooks[event]

if mode != "--remove":
    for event in events:
        hooks.setdefault(event, []).append({"hooks": [{"type": "command", "command": hook, "timeout": 5}]})
if not hooks:
    del data["hooks"]

# The status line: ours replaces the user's, which is saved and run from ours.
def our_statusline(s):
    return isinstance(s, dict) and str(s.get("command", "")).endswith("omni-agent-terminal/claude-statusline.sh")

current = data.get("statusLine")
if mode == "--remove":
    if our_statusline(current):
        saved = None
        if os.path.exists(orig_json):
            with open(orig_json, encoding="utf-8") as f:
                saved = json.load(f)
        if saved:
            data["statusLine"] = saved
        else:
            del data["statusLine"]
    for f in (orig_json, orig_cmd):
        if os.path.exists(f):
            os.remove(f)
else:
    if not our_statusline(current):
        # First install, or the user set a new status line since: keep it.
        with open(orig_json, "w", encoding="utf-8") as f:
            json.dump(current, f)
        cmd = current.get("command", "") if isinstance(current, dict) and current.get("type", "command") == "command" else ""
        with open(orig_cmd, "w", encoding="utf-8") as f:
            f.write(cmd if isinstance(cmd, str) else "")
        base = dict(current) if isinstance(current, dict) else {}
    else:
        base = dict(current)
    # padding and refreshInterval of the user's status line still apply.
    data["statusLine"] = {**base, "type": "command", "command": statusline}

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

if [ "$MODE" = "--remove" ]; then
  rm -f "$HOOK" "$STATUSLINE"
  echo "제거했습니다: $SETTINGS 에서 Omni 훅 삭제${BACKUP:+ (백업: $BACKUP)}"
else
  echo "설치했습니다: $HOOK, $STATUSLINE"
  echo "  설정: $SETTINGS${BACKUP:+ (백업: $BACKUP)}"
  echo "  이미 실행 중인 claude는 다시 시작해야 적용됩니다 (claude --continue)."
fi
