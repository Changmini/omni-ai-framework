#!/usr/bin/env bash
# Copies the omni-pipeline plugin from the repository's claude-code folder into
# plugins/omni-pipeline, which the app loads into the claude of its terminals
# (--plugin-dir, see src/shell-init). Run after changing the plugin there;
# test/app-skills.test.js fails while the two differ.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/../../claude-code/plugins/omni-pipeline"
[ -d "$src" ] || { echo "not found: $src (run inside the omni-ai-framework repository)" >&2; exit 1; }
rm -rf "$here/plugins/omni-pipeline"
mkdir -p "$here/plugins"
cp -R "$src" "$here/plugins/omni-pipeline"
echo "copied $src -> plugins/omni-pipeline"
