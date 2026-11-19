#!/usr/bin/env bash
# Creates the sample environment the app is checked and photographed in
# (only sample values: user, sample-host, /home/user/sample-app,
# feature/sample), or puts its ~/.bashrc back after a test changed it.
#   sample-env.sh          create what is missing (idempotent)
#   sample-env.sh restore  restore ~/.bashrc, remove the fake wsl and tmux servers
set -euo pipefail
HOME_DIR=/home/user/sample-home
APP=/home/user/sample-app
BASHRC_SAMPLE="PS1='user@sample-host:\\w\$ '"

if [ "${1:-}" = restore ]; then
  printf '%s\n' "$BASHRC_SAMPLE" > "$HOME_DIR/.bashrc"
  rm -rf "$HOME_DIR/bin"
  HOME="$HOME_DIR" tmux kill-server 2>/dev/null || true
  for s in samplewsl omnitest; do tmux -L "$s" kill-server 2>/dev/null || true; done
  echo "sample env restored"
  exit 0
fi

mkdir -p "$HOME_DIR"
[ -f "$HOME_DIR/.bashrc" ] || printf '%s\n' "$BASHRC_SAMPLE" > "$HOME_DIR/.bashrc"

if [ ! -d "$APP/.git" ]; then
  mkdir -p "$APP/src/api" "$APP/test" "$APP/docs"
  printf '# sample-app\n\n사용자 API 예시 프로젝트\n' > "$APP/README.md"
  printf 'def list_users():\n    return []\n\n\ndef create_user(name):\n    return {"name": name}\n' > "$APP/src/api/users.py"
  printf 'from src.api.users import create_user\n\nassert create_user("a")\n' > "$APP/test/test_users.py"
  printf 'node_modules/\n*.log\n' > "$APP/.gitignore"
  git -C "$APP" init -q
  git -C "$APP" checkout -q -b feature/sample
  git -C "$APP" -c user.name=user -c user.email=user@example.com add -A
  git -C "$APP" -c user.name=user -c user.email=user@example.com commit -q -m "sample"
fi
echo "sample env ready: HOME=$HOME_DIR, project $APP"
