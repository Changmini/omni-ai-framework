# Omni Agent Terminal shell integration (ZDOTDIR, app terminals only).
[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"

if [ -n "$OMNI_CLAUDE_SETTINGS" ]; then
  claude() { command claude --settings "$OMNI_CLAUDE_SETTINGS" "$@"; }
fi

__omni_cwd() { printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "$PWD"; }
autoload -Uz add-zsh-hook && add-zsh-hook precmd __omni_cwd
