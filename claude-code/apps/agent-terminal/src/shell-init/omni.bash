# Omni Agent Terminal shell integration (bash --rcfile, app terminals only).
# Also loaded inside WSL when `wsl` is typed in an app PowerShell terminal;
# the OMNI_* variables then arrive through WSLENV.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

if [ -n "$OMNI_CLAUDE_SETTINGS" ]; then
  claude() { command claude --settings "$OMNI_CLAUDE_SETTINGS" "$@"; }
fi

__omni_json() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }

# POST the current folder to the app. Needed where the terminal drops OSC 7
# (Windows pseudo console, so inside WSL). WSL also sends its distro and home
# so the app can read git and ~/.claude through \\wsl.localhost.
__omni_cwd_post() {
  [ -n "$OMNI_CWD_URL" ] && command -v curl >/dev/null 2>&1 || return 1
  curl -s -f -m 1 -o /dev/null -X POST \
    -H 'Content-Type: application/json' \
    -H "X-Omni-Token: $OMNI_HOOK_TOKEN" \
    -H "X-Omni-Terminal: $OMNI_TERMINAL_ID" \
    --data "{\"cwd\":\"$(__omni_json "$PWD")\",\"wslDistro\":\"$(__omni_json "${WSL_DISTRO_NAME:-}")\",\"home\":\"$(__omni_json "$HOME")\"}" \
    "$OMNI_CWD_URL"
}

__omni_last=""
__omni_cwd() {
  printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
  if [ "$PWD" != "$__omni_last" ]; then
    __omni_last=$PWD
    ( __omni_cwd_post & )
  fi
}
PROMPT_COMMAND="__omni_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"

# Inside WSL, say once if the app cannot be reached (WSL2 NAT networking).
if [ -n "$WSL_DISTRO_NAME" ] && [ -n "$OMNI_CWD_URL" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    printf '\033[33m[Omni] curl이 없어 앱에 상태를 보낼 수 없습니다: sudo apt install curl\033[0m\n'
  elif __omni_cwd_post; then
    __omni_last=$PWD
  else
    printf '\033[33m[Omni] WSL에서 앱(%s)에 연결할 수 없습니다. Claude 상태와 경로가 표시되지 않습니다.\n' "$OMNI_CWD_URL"
    printf '       Windows의 %%UserProfile%%\\.wslconfig에 [wsl2] networkingMode=mirrored 를 넣고 wsl --shutdown 후 다시 여세요.\033[0m\n'
  fi
fi
