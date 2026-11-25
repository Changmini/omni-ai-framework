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

# Closing an app terminal ends everything started from it (src/reap.js finds
# them by OMNI_TERMINAL_RUN in their environment). Programs with a window of
# their own (an editor, a browser opened by xdg-open) are meant to go on:
# they start without that marker. `omni-keep <command>` does the same for
# anything else that should outlive the terminal (a daemon, pm2).
omni-keep() { env -u OMNI_TERMINAL_RUN -u OMNI_TERMINAL_ID "$@"; }
for __omni_gui in code code-insiders codium cursor windsurf subl zed xdg-open gio open; do
  typeset -f "$__omni_gui" >/dev/null 2>&1 && continue # the user's own function stays
  command -v "$__omni_gui" >/dev/null 2>&1 || continue
  # "function name": an alias of the same name is not expanded here.
  eval "function $__omni_gui { omni-keep $__omni_gui \"\$@\"; }"
done
unset __omni_gui

__omni_cwd() { printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "$PWD"; }
autoload -Uz add-zsh-hook && add-zsh-hook precmd __omni_cwd
