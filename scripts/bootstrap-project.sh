#!/usr/bin/env bash
# Copies template/ into a target project without overwriting existing files.
# Usage: scripts/bootstrap-project.sh <target-project-dir>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <target-project-dir>" >&2
  exit 2
fi

src="$(cd "$(dirname "$0")/../template" && pwd)"
dst="$(cd "$1" && pwd)"

copied=0; skipped=0
while IFS= read -r -d '' file; do
  rel="${file#"$src"/}"
  [ "$rel" = "gitignore.claude" ] && continue
  if [ -e "$dst/$rel" ]; then
    echo "skip (exists): $rel"; skipped=$((skipped + 1))
  else
    mkdir -p "$(dirname "$dst/$rel")"
    cp "$file" "$dst/$rel"
    echo "add:           $rel"; copied=$((copied + 1))
  fi
done < <(find "$src" -type f -print0 | sort -z)

# Append the gitignore entries that are missing.
touch "$dst/.gitignore"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  grep -qxF "$line" "$dst/.gitignore" || { echo "$line" >> "$dst/.gitignore"; echo "gitignore:     $line"; }
done < "$src/gitignore.claude"

echo
echo "Done: $copied added, $skipped skipped."
echo "Next: fill in CLAUDE.md, adjust .claude/settings.json permissions, commit, then start Claude Code"
echo "in the project and accept the workspace trust dialog so the marketplace and plugins install."
