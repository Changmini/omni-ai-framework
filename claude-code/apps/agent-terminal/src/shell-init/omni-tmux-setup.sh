#!/usr/bin/env bash
# Lets claude running inside tmux report its status to Omni Agent Terminal.
#
#   omni-tmux-setup            install (or update) the hook
#   omni-tmux-setup --remove   remove it again
#
# Copies claude-hook.sh to ~/.local/share/omni-agent-terminal/ and adds it as
# a command hook in ~/.claude/settings.json (a backup is written first). The
# hook does nothing unless the tmux session is shown in an app terminal.
# Restart claude afterwards (claude --continue keeps the conversation).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/.local/share/omni-agent-terminal"
HOOK="$DEST_DIR/claude-hook.sh"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
EVENTS="UserPromptSubmit PreToolUse PostToolUse PostToolUseFailure PermissionRequest Notification Stop StopFailure SubagentStart SubagentStop TeammateIdle TaskCreated TaskCompleted SessionEnd"
MODE="${1:-install}"

command -v python3 >/dev/null 2>&1 || { echo "python3가 필요합니다: sudo apt install -y python3" >&2; exit 1; }

if [ "$MODE" != "--remove" ]; then
  command -v curl >/dev/null 2>&1 || echo "[!] curl이 없습니다: sudo apt install -y curl" >&2
  mkdir -p "$DEST_DIR"
  # Strip CR in case the source came from a Windows checkout.
  tr -d '\r' < "$SRC_DIR/claude-hook.sh" > "$HOOK"
  chmod +x "$HOOK"
fi

mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ]; then
  BACKUP="$SETTINGS.omni-backup-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS" "$BACKUP"
fi

python3 - "$SETTINGS" "$HOOK" "$MODE" $EVENTS <<'PY'
import json, os, sys
path, hook, mode, events = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
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

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

if [ "$MODE" = "--remove" ]; then
  rm -f "$HOOK"
  echo "제거했습니다: $SETTINGS 에서 Omni 훅 삭제${BACKUP:+ (백업: $BACKUP)}"
else
  echo "설치했습니다: $HOOK"
  echo "  설정: $SETTINGS${BACKUP:+ (백업: $BACKUP)}"
  echo "  이미 실행 중인 claude는 다시 시작해야 적용됩니다 (claude --continue)."
fi
