#!/usr/bin/env bash
# Change policy: blocks commits that add secrets or secret files.
#
# Usage: .agents/policies/change/check-secrets.sh [--staged | <git-diff-range>]
#   --staged (default)  check the staged changes (pre-commit)
#   <range>             check a range, e.g. origin/main...HEAD (CI)
# Exit: 0 = clean, 1 = findings (printed as "path: reason" lines), 2 = usage error
# Allow a known false positive by adding "omni:allow-secret" on the same line.
set -u

mode=${1:---staged}
if [ "$mode" = "--help" ]; then sed -n '2,8p' "$0"; exit 0; fi
if [ "$mode" = "--staged" ]; then diff_args=(--cached); else diff_args=("$mode"); fi

git rev-parse --git-dir >/dev/null 2>&1 || { echo "check-secrets: not a git repository" >&2; exit 2; }

found=0
report() { echo "$1: $2"; found=1; }

# 1. Files that should never be committed
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$(basename "$path")" in
    .env|.env.*) case "$path" in *.example|*.sample|*.template) ;; *) report "$path" "environment file (commit a .env.example instead)";; esac ;;
    *.pem|*.key|*.p12|*.pfx|id_rsa|id_ed25519|id_ecdsa) report "$path" "private key or certificate file" ;;
  esac
done < <(git diff "${diff_args[@]}" --name-only --diff-filter=AR)

# 2. Secret-looking values in added lines
patterns=(
  'AKIA[0-9A-Z]{16}|aws access key id'
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|private key block'
  'gh[pousr]_[A-Za-z0-9]{36,}|GitHub token'
  'xox[abprs]-[A-Za-z0-9-]{10,}|Slack token'
  'sk-[A-Za-z0-9_-]{32,}|API secret key'
  '(api[_-]?key|secret|password|passwd|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{12,}["'"'"']|hard-coded credential'
)
current=""
while IFS= read -r line; do
  case "$line" in
    "+++ b/"*) current=${line#+++ b/}; continue ;;
    "+++ "*) continue ;;
    +*) ;;
    *) continue ;;
  esac
  case "$line" in *omni:allow-secret*) continue ;; esac
  for entry in "${patterns[@]}"; do
    regex=${entry%|*}; label=${entry##*|}
    if printf '%s' "${line:1}" | grep -Eiq -- "$regex"; then report "$current" "$label"; fi
  done
done < <(git diff "${diff_args[@]}" -U0 --no-color)

exit $found
