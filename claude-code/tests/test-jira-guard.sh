#!/usr/bin/env bash
# Regression tests for omni-jira's jira-owner-guard.py with synthetic hook payloads.
# The Atlassian MCP response shape is not verified against the live server; record() accepts
# issue objects anywhere in tool_response, including JSON inside text content blocks.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
guard="$root/plugins/omni-jira/scripts/jira-owner-guard.py"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export CLAUDE_PLUGIN_DATA="$tmp" CLAUDE_PLUGIN_OPTION_ASSIGNEE_ACCOUNT_ID="me-123" CLAUDE_PLUGIN_OPTION_GUARD_ALL_SESSIONS=false
P=mcp__plugin_atlassian_atlassian__
AGENT=omni-jira:jira-manager
fail=0

record() {  # $1 tool, $2 tool_response JSON
  printf '{"tool_name":"%s%s","tool_input":{"cloudId":"c1"},"tool_response":%s}' "$P" "$1" "$2" | python3 "$guard" record
}
check() {  # $1 expected allow|deny, $2 tool, $3 tool_input JSON, $4 agent_type, $5 label
  local out got
  out=$(printf '{"tool_name":"%s%s","tool_input":%s,"agent_type":"%s"}' "$P" "$2" "$3" "$4" | python3 "$guard" check)
  got=$(printf '%s' "$out" | python3 -c 'import json,sys; d=sys.stdin.read().strip(); print(json.loads(d)["hookSpecificOutput"]["permissionDecision"] if d else "allow")')
  [ "$got" = "$1" ] && echo "ok   $1: $5" || { echo "FAIL expected=$1 got=$got: $5 ($out)"; fail=1; }
}

# records: mine (JSON in a text block), someone else's, unassigned, one without accountId
record getJiraIssue '{"content":[{"type":"text","text":"{\"id\":\"10001\",\"key\":\"PROJ-1\",\"fields\":{\"assignee\":{\"accountId\":\"me-123\"}}}"}]}'
record searchJiraIssuesUsingJql '{"issues":[{"key":"PROJ-2","fields":{"assignee":{"accountId":"other-9"}}},{"key":"PROJ-3","fields":{"assignee":null}}]}'
record getJiraIssue '{"key":"PROJ-4","fields":{"summary":"no assignee field in this view"}}'

check allow getJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-2"}' "$AGENT" "reads are always allowed"
check allow editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1","fields":{"summary":"x"}}' "$AGENT" "edit own issue"
check allow editJiraIssue '{"cloudId":"c1","issueIdOrKey":"10001","fields":{"summary":"x"}}' "$AGENT" "edit own issue by numeric id"
check allow transitionJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1","transition":{"id":"31"}}' "$AGENT" "transition own issue"
check allow addOrEditJiraIssueComment '{"cloudId":"c1","issueIdOrKey":"PROJ-1","commentBody":"hi"}' "$AGENT" "comment on own issue"
check deny  editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-2","fields":{"summary":"x"}}' "$AGENT" "edit someone else's issue"
check deny  addOrEditJiraIssueComment '{"cloudId":"c1","issueIdOrKey":"PROJ-3","commentBody":"hi"}' "$AGENT" "comment on unassigned issue"
check deny  editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-4","fields":{"summary":"x"}}' "$AGENT" "no accountId was recorded"
check deny  editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-99","fields":{"summary":"x"}}' "$AGENT" "issue never read"
check deny  editJiraIssue '{"cloudId":"c2","issueIdOrKey":"PROJ-1","fields":{"summary":"x"}}' "$AGENT" "different cloudId"
check deny  editJiraIssue '{"cloudId":"c1","issueIdOrKey":"https://x.atlassian.net/browse/PROJ-1"}' "$AGENT" "URL as issue id"
check deny  editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1","fields":{"assignee":{"accountId":"other-9"}}}' "$AGENT" "reassign to someone else"
check allow createJiraIssue '{"cloudId":"c1","projectKey":"PROJ","issueTypeName":"Task","summary":"s","assignee_account_id":"me-123"}' "$AGENT" "create assigned to me"
check deny  createJiraIssue '{"cloudId":"c1","projectKey":"PROJ","issueTypeName":"Task","summary":"s"}' "$AGENT" "create without assignee"
check deny  createJiraIssue '{"cloudId":"c1","projectKey":"PROJ","issueTypeName":"Task","summary":"s","assignee_account_id":"other-9"}' "$AGENT" "create for someone else"
check allow createJiraIssue '{"cloudId":"c1","projectKey":"PROJ","issueTypeName":"Sub-task","summary":"s","assignee_account_id":"me-123","parent":"PROJ-1"}' "$AGENT" "subtask under own parent"
check deny  createJiraIssue '{"cloudId":"c1","projectKey":"PROJ","issueTypeName":"Sub-task","summary":"s","assignee_account_id":"me-123","additional_fields":{"parent":{"key":"PROJ-2"}}}' "$AGENT" "subtask under someone else's parent"
check deny  deleteJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1"}' "$AGENT" "delete"
check deny  addWorklogToJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1"}' "$AGENT" "unknown Jira write"
check deny  createConfluencePage '{"cloudId":"c1"}' "$AGENT" "non-Jira write inside jira-manager"
check allow editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-2","fields":{"summary":"x"}}' "" "main session is not guarded by default"
CLAUDE_PLUGIN_OPTION_GUARD_ALL_SESSIONS=true check deny editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-2","fields":{"summary":"x"}}' "" "guard_all_sessions guards main session"
CLAUDE_PLUGIN_OPTION_GUARD_ALL_SESSIONS=true check allow createConfluencePage '{"cloudId":"c1"}' "" "guard_all_sessions leaves non-Jira tools alone"
CLAUDE_PLUGIN_OPTION_ASSIGNEE_ACCOUNT_ID= check deny editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1","fields":{"summary":"x"}}' "$AGENT" "unconfigured assignee"

# expired record
python3 - "$tmp/jira-owner-records.json" <<'PY'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["c1|PROJ-1"]["ts"]-=3601; json.dump(d,open(p,"w"))
PY
check deny editJiraIssue '{"cloudId":"c1","issueIdOrKey":"PROJ-1","fields":{"summary":"x"}}' "$AGENT" "record older than one hour"

exit $fail
