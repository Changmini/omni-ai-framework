#!/usr/bin/env python3
"""Validates the framework against Anthropic's documented rules.

Checks every SKILL.md, agent file, and JSON config under the repo, then runs
`claude plugin validate` on the marketplace and each plugin when the CLI is
installed. Exits non-zero on any error.

Rules come from:
  https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
  https://code.claude.com/docs/en/skills
  https://code.claude.com/docs/en/sub-agents
  https://code.claude.com/docs/en/plugins-reference
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # claude-code/
REPO = ROOT.parent                             # repo root = marketplace root
MARKETPLACE_FILE = REPO / ".claude-plugin/marketplace.json"
SKIP_DIRS = {".git", "node_modules"}

SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")
SKILL_NAME_MAX = 64
SKILL_DESC_MAX = 1024
SKILL_BODY_MAX_LINES = 500
CLAUDE_MD_MAX_LINES = 200
RESERVED_WORDS = ("anthropic", "claude")
XML_TAG_RE = re.compile(r"<[^>]+>")

errors: list[str] = []
warnings: list[str] = []


def files(pattern: str):
    for p in sorted(ROOT.rglob(pattern)):
        if not SKIP_DIRS.intersection(p.relative_to(ROOT).parts):
            yield p


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT))


def parse_frontmatter(path: Path):
    """Returns (fields, body). Handles the flat `key: value` subset used here."""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    try:
        end = lines.index("---", 1)
    except ValueError:
        return None, text
    fields: dict[str, str] = {}
    for line in lines[1:end]:
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return fields, "\n".join(lines[end + 1:])


def check_skills():
    for path in files("SKILL.md"):
        fm, body = parse_frontmatter(path)
        if fm is None:
            errors.append(f"{rel(path)}: frontmatter must start on line 1 between '---' markers")
            continue
        name = fm.get("name") or path.parent.name
        desc = fm.get("description", "")
        if len(name) > SKILL_NAME_MAX:
            errors.append(f"{rel(path)}: name longer than {SKILL_NAME_MAX} chars")
        if not SKILL_NAME_RE.match(name):
            errors.append(f"{rel(path)}: name '{name}' must be lowercase letters, digits, hyphens")
        if any(w in name for w in RESERVED_WORDS):
            errors.append(f"{rel(path)}: name '{name}' contains a reserved word {RESERVED_WORDS}")
        if fm.get("name") and fm["name"] != path.parent.name:
            warnings.append(f"{rel(path)}: name '{fm['name']}' differs from folder '{path.parent.name}'")
        if not desc:
            errors.append(f"{rel(path)}: description is required")
        if len(desc) > SKILL_DESC_MAX:
            errors.append(f"{rel(path)}: description longer than {SKILL_DESC_MAX} chars")
        if XML_TAG_RE.search(name) or XML_TAG_RE.search(desc):
            errors.append(f"{rel(path)}: name/description must not contain XML tags")
        if re.match(r"^(I|You)\b", desc):
            warnings.append(f"{rel(path)}: write the description in third person")
        n = len(body.strip("\n").split("\n"))
        if n > SKILL_BODY_MAX_LINES:
            errors.append(f"{rel(path)}: body is {n} lines (max {SKILL_BODY_MAX_LINES}); move detail to reference files")
        for link in re.findall(r"\]\(([^)#]+)\)", body):
            if "://" not in link and not (path.parent / link).exists():
                errors.append(f"{rel(path)}: linked file not found: {link}")


def check_agents():
    for path in files("*.md"):
        if path.parent.name != "agents":
            continue
        fm, _ = parse_frontmatter(path)
        if fm is None:
            errors.append(f"{rel(path)}: agent file needs YAML frontmatter")
            continue
        for key in ("name", "description"):
            if not fm.get(key):
                errors.append(f"{rel(path)}: agent frontmatter requires '{key}'")
        if ":" in fm.get("name", "") or fm.get("name", "").startswith("-"):
            errors.append(f"{rel(path)}: agent name can't contain ':' or start with '-'")


def check_json():
    for path in files("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{rel(path)}: invalid JSON ({e})")


def check_claude_md():
    for path in files("CLAUDE.md"):
        n = len(path.read_text(encoding="utf-8").split("\n"))
        if n > CLAUDE_MD_MAX_LINES:
            warnings.append(f"{rel(path)}: {n} lines; target is under {CLAUDE_MD_MAX_LINES}")


def check_marketplace():
    mp = json.loads(MARKETPLACE_FILE.read_text(encoding="utf-8"))
    for entry in mp.get("plugins", []):
        src = entry.get("source")
        if not isinstance(src, str):
            continue
        manifest = REPO / src / ".claude-plugin/plugin.json"
        if not manifest.exists():
            errors.append(f"marketplace entry '{entry['name']}': {manifest.relative_to(REPO)} missing")
            continue
        if json.loads(manifest.read_text(encoding="utf-8")).get("name") != entry["name"]:
            errors.append(f"marketplace entry '{entry['name']}': name differs from plugin.json name")


def run_cli_validate():
    claude = shutil.which("claude")
    if not claude:
        warnings.append("claude CLI not found; skipped `claude plugin validate`")
        return
    mp = json.loads(MARKETPLACE_FILE.read_text(encoding="utf-8"))
    targets = ["."] + [e["source"] for e in mp["plugins"] if isinstance(e.get("source"), str)]
    for target in targets:
        res = subprocess.run([claude, "plugin", "validate", "--strict", target],
                             cwd=REPO, capture_output=True, text=True)
        status = "ok" if res.returncode == 0 else "FAILED"
        print(f"claude plugin validate --strict {target}: {status}")
        if res.returncode != 0:
            errors.append(f"`claude plugin validate {target}` failed:\n{res.stdout}{res.stderr}")


def main() -> int:
    check_json()
    check_skills()
    check_agents()
    check_claude_md()
    check_marketplace()
    if "--no-cli" not in sys.argv:
        run_cli_validate()
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}")
    print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
