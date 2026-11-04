# Omni Agent Terminal shell integration (bash --rcfile, app terminals only).
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

if [ -n "$OMNI_CLAUDE_SETTINGS" ]; then
  claude() { command claude --settings "$OMNI_CLAUDE_SETTINGS" "$@"; }
fi

__omni_cwd() { printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"; }
PROMPT_COMMAND="__omni_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
