#!/usr/bin/env python3
"""Copies this marketplace's plugins into a project's .claude/ directory.

Use this where plugins can't be installed, such as cloud sessions: a cloud session
loads the repo's .claude/skills/, .claude/agents/, .claude/commands/ and
.claude/settings.json hooks, but doesn't install plugins the repo enables under
enabledPlugins (https://code.claude.com/docs/en/cloud-environments).

For each plugin (local, or fetched from git at the pinned sha):
  whole plugin            -> <project>/.claude/vendor/<plugin>/   (hook scripts read files here)
  skills/<name>/          -> <project>/.claude/skills/<name>/     (a root SKILL.md counts as one skill)
  agents/*.md             -> <project>/.claude/agents/
  commands/*.md           -> <project>/.claude/commands/
  hooks/hooks.json        -> merged into <project>/.claude/settings.json "hooks"; each command runs with
                             CLAUDE_PLUGIN_ROOT set to the vendored copy

Vendored copies replace the plugin versions, so their entries are removed from the
project's enabledPlugins (and the marketplace from extraKnownMarketplaces when none
remain) to avoid running everything twice. Re-run to update; vendored files are overwritten.

Usage: scripts/vendor-plugins.py <target-project-dir> [plugin ...]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]  # claude-code/ = marketplace root
MARKETPLACE = json.loads((REPO / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
MP_NAME = MARKETPLACE["name"]
VENDOR_DIR = ".claude/vendor"


def copy_tree(src: Path, dst: Path):
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".git"))


def fetch(source: dict, workdir: Path) -> Path:
    """Checks out a url or git-subdir plugin source at its sha (or ref) and returns the plugin dir."""
    url = source["url"]
    if "://" not in url and not url.startswith("git@"):
        url = f"https://github.com/{url}.git"  # owner/repo shorthand
    rev = source.get("sha") or source.get("ref") or "HEAD"
    run = lambda *args: subprocess.run(["git", "-C", str(workdir), *args], check=True,
                                       capture_output=True, text=True)
    workdir.mkdir(parents=True)
    run("init", "-q")
    run("fetch", "-q", "--depth", "1", url, rev)
    run("checkout", "-q", "FETCH_HEAD")
    return workdir / source.get("path", "")


def plugin_dir(entry: dict, tmp: Path) -> Path:
    src = entry["source"]
    if isinstance(src, str):
        return REPO / src
    if src.get("source") in ("url", "git-subdir"):
        print(f"fetching: {entry['name']} @ {src.get('sha') or src.get('ref') or 'HEAD'}")
        return fetch(src, tmp / entry["name"])
    sys.exit(f"{entry['name']}: source type '{src.get('source')}' is not supported for vendoring")


def vendor_plugin(src: Path, name: str, project: Path, settings: dict, seen_skills: dict):
    claude_dir = project / ".claude"
    vendored_root = claude_dir / "vendor" / name

    skills = sorted(p.parent for p in (src / "skills").glob("*/SKILL.md"))
    if not skills and (src / "SKILL.md").exists():
        skills = [src]
    for skill in skills:
        skill_name = skill.name if skill != src else name
        if skill_name in seen_skills and seen_skills[skill_name] != name:
            print(f"warning: skill '{skill_name}' from {name} overwrites the one from {seen_skills[skill_name]}")
        seen_skills[skill_name] = name
        if "CLAUDE_PLUGIN_ROOT" in (skill / "SKILL.md").read_text(encoding="utf-8"):
            print(f"warning: skill '{skill_name}' references CLAUDE_PLUGIN_ROOT, which is not set outside plugins")
        copy_tree(skill, claude_dir / "skills" / skill_name)
        print(f"skill:    .claude/skills/{skill_name}")

    for kind in ("agents", "commands"):
        for md in sorted((src / kind).glob("*.md")):
            (claude_dir / kind).mkdir(parents=True, exist_ok=True)
            shutil.copy2(md, claude_dir / kind / md.name)
            print(f"{kind[:-1] + ':':9} .claude/{kind}/{md.name}")

    hooks_file = src / "hooks/hooks.json"
    if not hooks_file.exists():
        return
    copy_tree(src, vendored_root)
    print(f"vendor:   {VENDOR_DIR}/{name}/")
    root_expr = f"${{CLAUDE_PROJECT_DIR}}/{VENDOR_DIR}/{name}"
    hooks = settings.setdefault("hooks", {})
    for event, groups in json.loads(hooks_file.read_text(encoding="utf-8"))["hooks"].items():
        existing = hooks.setdefault(event, [])
        for group in groups:
            for handler in group.get("hooks", []):
                if handler.get("type") == "command":
                    cmd = handler["command"].replace("${CLAUDE_PLUGIN_ROOT}", root_expr)
                    handler["command"] = f'CLAUDE_PLUGIN_ROOT="{root_expr}" {cmd}'
            if group not in existing:
                existing.append(group)
                print(f"hook:     {event} ({group.get('matcher', '*')}) from {name}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    project = Path(sys.argv[1]).resolve()
    wanted = set(sys.argv[2:])
    entries = [e for e in MARKETPLACE["plugins"] if not wanted or e["name"] in wanted]
    unknown = wanted - {e["name"] for e in entries}
    if unknown:
        sys.exit(f"unknown plugin(s): {', '.join(sorted(unknown))}")

    settings_path = project / ".claude/settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {
        "$schema": "https://json.schemastore.org/claude-code-settings.json"}

    seen_skills: dict = {}
    with tempfile.TemporaryDirectory() as tmp:
        for entry in entries:
            vendor_plugin(plugin_dir(entry, Path(tmp)), entry["name"], project, settings, seen_skills)
            settings.get("enabledPlugins", {}).pop(f"{entry['name']}@{MP_NAME}", None)
    if not any(k.endswith(f"@{MP_NAME}") for k in settings.get("enabledPlugins", {})):
        settings.get("extraKnownMarketplaces", {}).pop(MP_NAME, None)
    for key in ("enabledPlugins", "extraKnownMarketplaces"):
        if key in settings and not settings[key]:
            del settings[key]

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"updated:  {settings_path}")


if __name__ == "__main__":
    main()
