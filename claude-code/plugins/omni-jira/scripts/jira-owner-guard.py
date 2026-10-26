#!/usr/bin/env python3
"""Jira owner guard for the omni-jira plugin.

  record  PostToolUse on getJiraIssue / searchJiraIssuesUsingJql: remembers each returned
          issue's assignee accountId per (cloudId, issue) for one hour.
  check   PreToolUse on Atlassian MCP tools: lets reads through and allows a Jira write only
          when it targets an issue last seen (within the hour, same cloudId) assigned to the
          configured accountId. Creates must assign that accountId; reassigning, deleting,
          URL-style issue ids and unknown Jira writes are denied.

Scope: only inside the jira-manager agent unless the plugin option guard_all_sessions is on.
Config comes from plugin options (CLAUDE_PLUGIN_OPTION_ASSIGNEE_ACCOUNT_ID,
CLAUDE_PLUGIN_OPTION_GUARD_ALL_SESSIONS); state lives in CLAUDE_PLUGIN_DATA.
Fails closed: an error while checking a Jira write denies it.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

RECORD_TTL_SECONDS = 3600  # matches the agent's documented one-hour validity
AGENT_NAMES = {"jira-manager", "omni-jira:jira-manager"}
ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
ISSUE_ID_RE = re.compile(r"^\d+$")
READ_PREFIXES = ("get", "search", "lookup", "discover", "fetch", "list", "atlassianUserInfo", "executeRead")
# Jira writes the agent is allowed to make, with the input key naming the target issue
OWNED_ISSUE_WRITES = {"editJiraIssue", "transitionJiraIssue", "addOrEditJiraIssueComment", "addCommentToJiraIssue"}


def state_path() -> Path:
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or os.path.join(os.path.expanduser("~"), ".claude", "omni-jira")
    return Path(base) / "jira-owner-records.json"


def load_state() -> dict:
    try:
        return json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    now = time.time()
    state = {k: v for k, v in state.items() if now - v.get("ts", 0) < RECORD_TTL_SECONDS}
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    tmp.replace(path)


def decide(decision: str, reason: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                             "permissionDecision": decision,
                                             "permissionDecisionReason": f"jira-owner-guard: {reason}"}},
                     ensure_ascii=False))
    sys.exit(0)


def short_tool_name(tool_name: str) -> str:
    return tool_name.rsplit("__", 1)[-1]


def is_read(name: str) -> bool:
    return name.startswith(READ_PREFIXES)


def iter_json(value):
    """Yields every dict in a tool response, parsing JSON embedded in text blocks."""
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from iter_json(v)
    elif isinstance(value, list):
        for v in value:
            yield from iter_json(v)
    elif isinstance(value, str):
        text = value.strip()
        if text[:1] in "{[":
            try:
                yield from iter_json(json.loads(text))
            except ValueError:
                pass


def assignee_of(issue: dict):
    """Returns (found, accountId|None) from an issue object."""
    fields = issue.get("fields") if isinstance(issue.get("fields"), dict) else issue
    if "assignee" not in fields:
        return False, None
    assignee = fields["assignee"]
    if assignee is None:
        return True, None
    if isinstance(assignee, dict) and "accountId" in assignee:
        return True, assignee["accountId"]
    return False, None


def record(event: dict) -> None:
    cloud = str(event.get("tool_input", {}).get("cloudId", ""))
    state = load_state()
    now = time.time()
    for obj in iter_json(event.get("tool_response")):
        key = obj.get("key")
        if not (isinstance(key, str) and ISSUE_KEY_RE.match(key)):
            continue
        found, account = assignee_of(obj)
        if not found:
            continue  # no accountId in this view (e.g. without view: "evidence"): nothing to record
        entry = {"assignee": account, "ts": now, "key": key}
        state[f"{cloud}|{key}"] = entry
        if obj.get("id") is not None:
            state[f"{cloud}|{obj['id']}"] = entry
    save_state(state)


def owned_record(state: dict, cloud: str, issue: str, owner: str):
    """Returns None when the issue may be changed, otherwise the denial reason."""
    entry = state.get(f"{cloud}|{issue}")
    if not entry or time.time() - entry.get("ts", 0) >= RECORD_TTL_SECONDS:
        return (f"{issue} has no assignee record from the last hour for this cloudId; call getJiraIssue "
                'with view: "evidence" and no fields, then retry')
    if entry.get("assignee") != owner:
        who = entry.get("assignee") or "nobody"
        return f"{issue} is assigned to {who}, not the configured assignee"
    return None


def account_ids_under(value, key_hint="assignee"):
    """Collects accountIds the input assigns, from assignee_account_id or *assignee* objects."""
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k == "assignee_account_id":
                found.append(v)
            elif key_hint in k.lower():
                if v is None:
                    found.append(None)
                elif isinstance(v, dict):
                    found.append(v.get("accountId", v.get("id")))
                elif isinstance(v, str):
                    found.append(v)
            else:
                found.extend(account_ids_under(v, key_hint))
    elif isinstance(value, list):
        for v in value:
            found.extend(account_ids_under(v, key_hint))
    return found


def parent_key(tool_input: dict):
    for container in (tool_input, tool_input.get("additional_fields") or {}, tool_input.get("fields") or {}):
        parent = container.get("parent") if isinstance(container, dict) else None
        if isinstance(parent, str):
            return parent
        if isinstance(parent, dict):
            return parent.get("key") or parent.get("id")
    return None


def check(event: dict) -> None:
    name = short_tool_name(event.get("tool_name", ""))
    in_agent = event.get("agent_type") in AGENT_NAMES
    guard_all = os.environ.get("CLAUDE_PLUGIN_OPTION_GUARD_ALL_SESSIONS", "").lower() in {"1", "true", "yes", "on"}
    if not (in_agent or guard_all):
        sys.exit(0)
    if is_read(name):
        sys.exit(0)
    if "jira" not in name.lower():
        if in_agent:
            decide("deny", f"{name} is outside jira-manager's scope (Jira only)")
        sys.exit(0)

    owner = os.environ.get("CLAUDE_PLUGIN_OPTION_ASSIGNEE_ACCOUNT_ID", "").strip()
    if not owner:
        decide("deny", "assignee_account_id is not configured for the omni-jira plugin")
    if "delete" in name.lower():
        decide("deny", "deleting Jira content is not allowed")

    tool_input = event.get("tool_input") or {}
    cloud = str(tool_input.get("cloudId", ""))
    state = load_state()

    if name == "createJiraIssue":
        assigned = account_ids_under(tool_input)
        if not assigned or any(a != owner for a in assigned):
            decide("deny", "new issues must set assignee_account_id to the configured assignee")
        parent = parent_key(tool_input)
        if parent:
            reason = owned_record(state, cloud, str(parent), owner)
            if reason:
                decide("deny", f"parent {reason}")
        sys.exit(0)

    if name in OWNED_ISSUE_WRITES:
        issue = str(tool_input.get("issueIdOrKey", "")).strip()
        if not (ISSUE_KEY_RE.match(issue) or ISSUE_ID_RE.match(issue)):
            decide("deny", "issueIdOrKey must be an issue key like PROJ-123 or a numeric id, not a URL")
        reason = owned_record(state, cloud, issue, owner)
        if reason:
            decide("deny", reason)
        if name == "editJiraIssue":
            reassigned = account_ids_under(tool_input.get("fields") or {})
            if any(a != owner for a in reassigned):
                decide("deny", "changing the assignee to someone else is not allowed")
        sys.exit(0)

    decide("deny", f"{name} is not an allowed Jira write for jira-manager")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in {"check", "record"}:
        print("usage: jira-owner-guard.py check|record  (hook JSON on stdin)", file=sys.stderr)
        sys.exit(2)
    try:
        event = json.load(sys.stdin)
    except ValueError:
        if mode == "check":
            decide("deny", "could not parse hook input")
        sys.exit(0)
    if mode == "record":
        try:
            record(event)
        except Exception as e:  # recording must never break the read itself
            print(f"jira-owner-guard record failed: {e}", file=sys.stderr)
        sys.exit(0)
    try:
        check(event)
    except SystemExit:
        raise
    except Exception as e:
        decide("deny", f"guard error ({e}); write blocked")


if __name__ == "__main__":
    main()
