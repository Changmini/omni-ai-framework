#!/usr/bin/env python3
"""Copies this marketplace's plugin components into a project's .claude/ directory.

Use this where plugins can't be installed, such as cloud sessions: a cloud session
loads the repo's .claude/skills/, .claude/agents/ and .claude/settings.json hooks,
but doesn't install plugins the repo enables under enabledPlugins
(https://code.claude.com/docs/en/cloud-environments).

  skills/<name>/      -> <project>/.claude/skills/<name>/
  agents/*.md         -> <project>/.claude/agents/
  scripts/*           -> <project>/.claude/hooks/<plugin>/
  hooks/hooks.json    -> merged into <project>/.claude/settings.json "hooks",
                         with ${CLAUDE_PLUGIN_ROOT}/scripts rewritten to the copied location

Vendored copies replace the plugin versions, so the omni entries are removed from the
project's enabledPlugins and extraKnownMarketplaces to avoid running everything twice.
Re-run to update; vendored files are overwritten.

Usage: scripts/vendor-plugins.py <target-project-dir> [plugin ...]
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKETPLACE = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
MP_NAME = MARKETPLACE["name"]


def copy_tree(src: Path, dst: Path):
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print(f"vendored: {dst}")


def vendor_plugin(plugin_dir: Path, name: str, project: Path, settings: dict):
    claude_dir = project / ".claude"
    for skill in sorted((plugin_dir / "skills").glob("*/SKILL.md")):
        copy_tree(skill.parent, claude_dir / "skills" / skill.parent.name)
    for agent in sorted((plugin_dir / "agents").glob("*.md")):
        (claude_dir / "agents").mkdir(parents=True, exist_ok=True)
        shutil.copy2(agent, claude_dir / "agents" / agent.name)
        print(f"vendored: {claude_dir / 'agents' / agent.name}")

    hooks_file = plugin_dir / "hooks/hooks.json"
    if not hooks_file.exists():
        return
    if (plugin_dir / "scripts").exists():
        copy_tree(plugin_dir / "scripts", claude_dir / "hooks" / name)
    text = hooks_file.read_text(encoding="utf-8").replace(
        '\\"${CLAUDE_PLUGIN_ROOT}\\"/scripts/',
        f'\\"${{CLAUDE_PROJECT_DIR}}\\"/.claude/hooks/{name}/',
    )
    if "CLAUDE_PLUGIN_ROOT" in text:
        sys.exit(f"{hooks_file}: unsupported ${{CLAUDE_PLUGIN_ROOT}} reference; use \"${{CLAUDE_PLUGIN_ROOT}}\"/scripts/...")
    hooks = settings.setdefault("hooks", {})
    for event, groups in json.loads(text)["hooks"].items():
        existing = hooks.setdefault(event, [])
        for group in groups:
            if group not in existing:
                existing.append(group)
                print(f"hook merged: {event} ({group.get('matcher', '*')})")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    project = Path(sys.argv[1]).resolve()
    wanted = set(sys.argv[2:])
    entries = [e for e in MARKETPLACE["plugins"] if not wanted or e["name"] in wanted]
    if wanted - {e["name"] for e in entries}:
        sys.exit(f"unknown plugin(s): {', '.join(wanted - {e['name'] for e in entries})}")

    settings_path = project / ".claude/settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {
        "$schema": "https://json.schemastore.org/claude-code-settings.json"}

    for entry in entries:
        vendor_plugin(ROOT / entry["source"], entry["name"], project, settings)
        settings.get("enabledPlugins", {}).pop(f"{entry['name']}@{MP_NAME}", None)
    if not any(k.endswith(f"@{MP_NAME}") for k in settings.get("enabledPlugins", {})):
        settings.get("extraKnownMarketplaces", {}).pop(MP_NAME, None)
    for key in ("enabledPlugins", "extraKnownMarketplaces"):
        if key in settings and not settings[key]:
            del settings[key]

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"updated: {settings_path}")


if __name__ == "__main__":
    main()
