#!/usr/bin/env bash
# Installs, at project scope, every omni-ai-framework plugin that <project>/.claude/settings.json enables.
# Needed because plugins with an external source (superpowers, playwright-cli) are not installed from
# project settings alone; each person runs this once per project after cloning it.
# Usage: scripts/install-plugins.sh [project-dir]   (default: current directory)
set -euo pipefail

marketplace=omni-ai-framework
here="$(cd "$(dirname "$0")/.." && pwd)"
project="$(cd "${1:-.}" && pwd)"
settings="$project/.claude/settings.json"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found; install Claude Code first" >&2; exit 1; }
[ -f "$settings" ] || { echo "no $settings" >&2; exit 1; }

if ! claude plugin marketplace list 2>/dev/null | grep -q "$marketplace"; then
  echo "Registering marketplace from $here"
  claude plugin marketplace add "$here"
fi

plugins=$(python3 -c '
import json, sys
enabled = json.load(open(sys.argv[1])).get("enabledPlugins", {})
print("\n".join(k for k, v in enabled.items() if v and k.endswith("@" + sys.argv[2])))
' "$settings" "$marketplace")

[ -z "$plugins" ] && { echo "no $marketplace plugins enabled in $settings"; exit 0; }
cd "$project"
status=0
while IFS= read -r plugin; do
  if claude plugin install "$plugin" --scope project >/dev/null 2>&1; then
    echo "installed: $plugin"
  else
    echo "FAILED:    $plugin (run: claude plugin install $plugin --scope project)" >&2; status=1
  fi
done <<< "$plugins"
exit $status
