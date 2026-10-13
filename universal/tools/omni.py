#!/usr/bin/env python3
"""omni: installs and checks the tool-neutral agent framework in a project.

Commands
  init     <project> [--hooks]   copy core/ into the project without overwriting files;
                                 add the managed block to an existing AGENTS.md
  update   <project>             overwrite framework-owned files and the managed block
                                 with this version (lists every file it replaces)
  index    <project>             rebuild the skills and agent-role tables in AGENTS.md
  validate <project>             check skills, roles, AGENTS.md and tool-neutral wording

Exit codes: 0 ok, 1 validation errors, 2 usage error. Requires only Python 3.9+.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent / "core"

FRAMEWORK_START = "<!-- omni:framework:start"
FRAMEWORK_END = "<!-- omni:framework:end -->"
SKILLS_START, SKILLS_END = "<!-- omni:skills:start -->", "<!-- omni:skills:end -->"
AGENTS_START, AGENTS_END = "<!-- omni:agents:start -->", "<!-- omni:agents:end -->"

# Agent Skills specification limits (github.com/agentskills/agentskills, docs/specification.mdx)
SKILL_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
NAME_MAX, DESC_MAX, COMPAT_MAX, BODY_MAX_LINES = 64, 1024, 500, 500
# Stricter vendor rule kept so the same skill is valid everywhere
RESERVED_IN_NAMES = ("anthropic", "claude")
AGENTS_MD_MAX_LINES = 200
ROLE_ACCESS = {"read-only", "read-write"}
METADATA_KEYS = {"omni.invocation": {"manual", "auto"}, "omni.arguments": None}

# Tool-neutral wording: framework-owned text must not name a specific product, tool API or model.
VENDOR_TERMS = re.compile(
    r"\b(claude|anthropic|openai|chatgpt|gpt-\d|codex|copilot|gemini|kimi|moonshot|"
    r"sonnet|opus|haiku|askuserquestion|claude_[a-z_]+)\b",
    re.IGNORECASE,
)


# ---------- parsing ----------

def parse_frontmatter(text: str) -> tuple[dict | None, str]:
    """Parses the YAML subset used by skills and roles: scalars and one nested map."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    try:
        end = lines.index("---", 1)
    except ValueError:
        return None, text
    data: dict = {}
    parent = None
    for raw in lines[1:end]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indented = raw.startswith((" ", "\t"))
        m = re.match(r"^\s*([A-Za-z0-9_.-]+):\s*(.*?)\s*$", raw)
        if not m:
            raise ValueError(f"unparsable frontmatter line: {raw!r}")
        key, value = m.group(1), _unquote(m.group(2))
        if indented and parent is not None:
            data[parent][key] = value
        elif value == "":
            data[key] = {}
            parent = key
        else:
            data[key] = value
            parent = None
    return data, "\n".join(lines[end + 1:])


def _unquote(v: str) -> str:
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def load_skills(root: Path) -> list[tuple[Path, dict | None, str]]:
    out = []
    for path in sorted((root / ".agents/skills").glob("*/SKILL.md")):
        fm, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        out.append((path, fm, body))
    return out


def load_roles(root: Path) -> list[tuple[Path, dict | None, str]]:
    out = []
    for path in sorted((root / ".agents/agents").glob("*.md")):
        fm, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        out.append((path, fm, body))
    return out


# ---------- index ----------

def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def render_indexes(root: Path) -> tuple[str, str]:
    skill_rows = ["| Skill | Use when | Trigger | File |", "| --- | --- | --- | --- |"]
    for path, fm, _ in load_skills(root):
        if not fm:
            continue
        trigger = (fm.get("metadata") or {}).get("omni.invocation", "auto")
        skill_rows.append(f"| {fm.get('name', path.parent.name)} | {_cell(fm.get('description', ''))} "
                          f"| {trigger} | `{path.relative_to(root).as_posix()}` |")
    role_rows = ["| Role | Use for | Access | File |", "| --- | --- | --- | --- |"]
    for path, fm, _ in load_roles(root):
        if not fm:
            continue
        role_rows.append(f"| {fm.get('name', path.stem)} | {_cell(fm.get('description', ''))} "
                         f"| {fm.get('access', 'read-only')} | `{path.relative_to(root).as_posix()}` |")
    return "\n".join(skill_rows), "\n".join(role_rows)


def _replace_between(text: str, start: str, end: str, body: str) -> str:
    i, j = text.find(start), text.find(end)
    if i < 0 or j < i:
        raise ValueError(f"markers {start} … {end} not found")
    return text[: i + len(start)] + "\n" + body + "\n" + text[j:]


def apply_indexes(root: Path) -> str:
    agents_md = root / "AGENTS.md"
    text = agents_md.read_text(encoding="utf-8")
    skills, roles = render_indexes(root)
    text = _replace_between(text, SKILLS_START, SKILLS_END, skills)
    return _replace_between(text, AGENTS_START, AGENTS_END, roles)


def cmd_index(root: Path) -> int:
    new = apply_indexes(root)
    (root / "AGENTS.md").write_text(new, encoding="utf-8")
    print(f"updated: {root / 'AGENTS.md'}")
    return 0


# ---------- init / update ----------

def framework_block(text: str) -> str:
    i, j = text.find(FRAMEWORK_START), text.find(FRAMEWORK_END)
    if i < 0 or j < i:
        raise ValueError("framework markers not found")
    return text[i: j + len(FRAMEWORK_END)]


def core_files() -> list[Path]:
    return sorted(p for p in CORE.rglob("*") if p.is_file())


def merge_agents_md(target: Path) -> str:
    core_text = (CORE / "AGENTS.md").read_text(encoding="utf-8")
    if not target.exists():
        target.write_text(core_text, encoding="utf-8")
        return "add"
    text = target.read_text(encoding="utf-8")
    block = framework_block(core_text)
    if FRAMEWORK_START in text:
        text = text.replace(framework_block(text), block)
        status = "update managed block"
    else:
        text = block + "\n\n## Project\n\n" + text
        status = "insert managed block above existing content"
    target.write_text(text, encoding="utf-8")
    return status


def install(root: Path, overwrite: bool) -> None:
    for src in core_files():
        rel = src.relative_to(CORE)
        if rel.as_posix() == "AGENTS.md":
            continue
        dst = root / rel
        if dst.exists() and not overwrite:
            print(f"skip (exists):  {rel}")
            continue
        if dst.exists() and dst.read_bytes() == src.read_bytes():
            continue
        action = "replace" if dst.exists() else "add"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        print(f"{action + ':':15} {rel}")
    print(f"{'AGENTS.md:':15} {merge_agents_md(root / 'AGENTS.md')}")
    (root / "AGENTS.md").write_text(apply_indexes(root), encoding="utf-8")


def cmd_init(root: Path, hooks: bool) -> int:
    root.mkdir(parents=True, exist_ok=True)
    install(root, overwrite=False)
    if hooks:
        res = subprocess.run(["git", "-C", str(root), "config", "core.hooksPath", ".agents/githooks"],
                             capture_output=True, text=True)
        print("git hooks:      enabled (.agents/githooks)" if res.returncode == 0
              else f"git hooks:      not enabled ({res.stderr.strip() or 'not a git repository'})")
    print("\nNext: fill in the 'Project' section of AGENTS.md (verify command first), then run "
          f"`{Path(__file__).name} validate {root}`.")
    return 0


def cmd_update(root: Path) -> int:
    if not (root / "AGENTS.md").exists():
        print("error: no AGENTS.md; run init first", file=sys.stderr)
        return 2
    install(root, overwrite=True)
    return 0


# ---------- validate ----------

class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")


def check_skills(root: Path, r: Report) -> None:
    for path, fm, body in load_skills(root):
        where = path.relative_to(root).as_posix()
        if fm is None:
            r.error(where, "frontmatter must start on line 1 between '---' lines")
            continue
        for key in fm:
            if key not in SKILL_FIELDS:
                r.error(where, f"non-standard field '{key}' (put extensions under metadata as 'omni.*')")
        name, desc = fm.get("name", ""), fm.get("description", "")
        if not NAME_RE.match(name) or len(name) > NAME_MAX:
            r.error(where, f"name '{name}' must be 1-{NAME_MAX} chars of a-z, 0-9 and single hyphens")
        if name != path.parent.name:
            r.error(where, f"name '{name}' must equal the folder name '{path.parent.name}'")
        if any(w in name for w in RESERVED_IN_NAMES):
            r.error(where, f"name '{name}' contains a reserved vendor word")
        if not desc or len(desc) > DESC_MAX:
            r.error(where, f"description must be 1-{DESC_MAX} characters")
        if re.search(r"<[^>]+>", name + desc):
            r.error(where, "name/description must not contain XML tags")
        if re.match(r"^(I|You)\b", desc):
            r.warn(where, "write the description in third person")
        if "compatibility" in fm and not (1 <= len(fm["compatibility"]) <= COMPAT_MAX):
            r.error(where, f"compatibility must be 1-{COMPAT_MAX} characters")
        meta = fm.get("metadata", {})
        if not isinstance(meta, dict):
            r.error(where, "metadata must be a map of string keys to string values")
            meta = {}
        for key, value in meta.items():
            allowed = METADATA_KEYS.get(key, "unknown")
            if key.startswith("omni.") and allowed == "unknown":
                r.error(where, f"unknown framework metadata key '{key}'")
            elif isinstance(allowed, set) and value not in allowed:
                r.error(where, f"{key} must be one of {sorted(allowed)}")
        n = len(body.strip("\n").split("\n"))
        if n > BODY_MAX_LINES:
            r.error(where, f"body is {n} lines (max {BODY_MAX_LINES}); move detail to references/")
        for link in re.findall(r"\]\(([^)#\s]+)\)", body):
            if "://" not in link and not (path.parent / link).exists():
                r.error(where, f"linked file not found: {link}")
        evals = path.parent / "evals/evals.json"
        if not evals.exists():
            r.warn(where, "no evals/evals.json")
        else:
            try:
                data = json.loads(evals.read_text(encoding="utf-8"))
                if data.get("skill_name") != name:
                    r.error(evals.relative_to(root).as_posix(), "skill_name must equal the skill name")
                if len(data.get("evals", [])) < 3:
                    r.warn(evals.relative_to(root).as_posix(), "fewer than 3 eval cases")
            except json.JSONDecodeError as e:
                r.error(evals.relative_to(root).as_posix(), f"invalid JSON ({e})")


def check_roles(root: Path, r: Report) -> None:
    for path, fm, body in load_roles(root):
        where = path.relative_to(root).as_posix()
        if fm is None:
            r.error(where, "role file needs frontmatter with name, description, access")
            continue
        if fm.get("name") != path.stem:
            r.error(where, f"name must equal the file name '{path.stem}'")
        if not fm.get("description"):
            r.error(where, "description is required")
        if fm.get("access") not in ROLE_ACCESS:
            r.error(where, f"access must be one of {sorted(ROLE_ACCESS)}")
        if "caller's conversation" not in body:
            r.warn(where, "say that the role cannot see the caller's conversation")


def check_agents_md(root: Path, r: Report) -> None:
    path = root / "AGENTS.md"
    if not path.exists():
        r.error("AGENTS.md", "missing")
        return
    text = path.read_text(encoding="utf-8")
    for marker in (FRAMEWORK_START, FRAMEWORK_END, SKILLS_START, SKILLS_END, AGENTS_START, AGENTS_END):
        if marker not in text:
            r.error("AGENTS.md", f"missing marker {marker}")
            return
    n = len(text.split("\n"))
    if n > AGENTS_MD_MAX_LINES:
        r.warn("AGENTS.md", f"{n} lines; keep it under {AGENTS_MD_MAX_LINES}")
    if apply_indexes(root) != text:
        r.error("AGENTS.md", "skills/roles index is out of date; run `omni.py index`")
    for ref in sorted(set(re.findall(r"`(\.agents/[^`*<>]+)`", text))):
        if not (root / ref.rstrip("/")).exists():
            r.error("AGENTS.md", f"referenced path does not exist: {ref}")


def check_neutral_wording(root: Path, r: Report) -> None:
    texts: list[tuple[str, str]] = []
    agents_md = root / "AGENTS.md"
    if agents_md.exists():
        try:
            texts.append(("AGENTS.md (managed block)", framework_block(agents_md.read_text(encoding="utf-8"))))
        except ValueError:
            pass
    for p in sorted((root / ".agents").rglob("*")):
        if p.is_file() and p.suffix in {".md", ".sh", ".json", ""}:
            texts.append((p.relative_to(root).as_posix(), p.read_text(encoding="utf-8", errors="replace")))
    for where, text in texts:
        for lineno, line in enumerate(text.split("\n"), 1):
            m = VENDOR_TERMS.search(line)
            if m:
                r.error(f"{where}:{lineno}", f"names a specific tool or model ('{m.group(0)}'); "
                                             "keep framework text tool-neutral")


def check_policies(root: Path, r: Report) -> None:
    for p in sorted((root / ".agents/policies").rglob("*.sh")) + [root / ".agents/githooks/pre-commit"]:
        if p.exists() and not (p.stat().st_mode & 0o111):
            r.error(p.relative_to(root).as_posix(), "must be executable (chmod +x)")


def cmd_validate(root: Path) -> int:
    r = Report()
    check_agents_md(root, r)
    check_skills(root, r)
    check_roles(root, r)
    check_neutral_wording(root, r)
    check_policies(root, r)
    for w in r.warnings:
        print(f"warning: {w}")
    for e in r.errors:
        print(f"error: {e}")
    print(f"\n{len(r.errors)} error(s), {len(r.warnings)} warning(s)")
    return 1 if r.errors else 0


# ---------- main ----------

def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in {"-h", "--help"} or argv[1] not in {"init", "update", "index", "validate"}:
        print(__doc__)
        return 0 if len(argv) > 1 and argv[1] in {"-h", "--help"} else 2
    args = [a for a in argv[2:] if not a.startswith("--")]
    flags = {a for a in argv[2:] if a.startswith("--")}
    root = Path(args[0] if args else ".").resolve()
    try:
        if argv[1] == "init":
            return cmd_init(root, "--hooks" in flags)
        if argv[1] == "update":
            return cmd_update(root)
        if argv[1] == "index":
            return cmd_index(root)
        return cmd_validate(root)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
