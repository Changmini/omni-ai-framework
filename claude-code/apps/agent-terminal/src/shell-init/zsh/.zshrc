# Omni Agent Terminal shell integration (ZDOTDIR, app terminals only).
[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"

__omni_dir="${${(%):-%x}:A:h:h}" # src/shell-init

# The user's own statusLine command (see omni.bash).
__omni_user_statusline() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 "$__omni_dir/user-statusline.py" "$PWD/.claude/settings.local.json" "$PWD/.claude/settings.json" \
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" 2>/dev/null
}

if [ -n "$OMNI_CLAUDE_SETTINGS" ]; then
  claude() {
    OMNI_USER_STATUSLINE="$(__omni_user_statusline)" OMNI_HOOKED=1 \
      command claude --settings "$OMNI_CLAUDE_SETTINGS" "$@"
  }
fi

__omni_cwd() { printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "$PWD"; }
autoload -Uz add-zsh-hook && add-zsh-hook precmd __omni_cwd
