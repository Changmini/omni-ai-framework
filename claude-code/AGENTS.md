# claude-code/ — Claude Code-only distribution

Everything in this folder works only with Claude Code: a plugin marketplace plus a per-project template. Tool-neutral work belongs in `../universal/`. Paths below are relative to this folder. Everything here follows the official docs at code.claude.com/docs and platform.claude.com/docs; see ARCHITECTURE.md for the source of each convention.

## Commands

- Validate everything (frontmatter rules + `claude plugin validate --strict`): `python3 scripts/validate.py`
- Hook tests: `tests/test-hooks.sh`
- Try a plugin locally without installing: `claude --plugin-dir ./plugins/omni-core`
- Reload after edits inside a session: `/reload-plugins`

## Layout

- `.claude-plugin/marketplace.json` — catalog; this folder is the marketplace root, so users register it from a local clone (`claude plugin marketplace add <clone>/claude-code`). Entry sources are `./plugins/<name>`; each entry `name` must equal its `plugin.json` `name`. GitHub `owner/repo` registration and a GitHub source with `path` don't work for a subfolder marketplace (`cache-miss` on v2.1.296), so don't document them as install routes
- `plugins/<plugin>/` — one plugin each; only `plugin.json` goes inside `.claude-plugin/`
- `template/` — files `scripts/bootstrap-project.sh` copies into a target project; bootstrap then runs `scripts/install-plugins.sh`, because externally sourced plugins are not installed from project `enabledPlugins` alone
- `scripts/vendor-plugins.py` — copies every marketplace plugin (local, or fetched from git at its pinned sha) into a project's `.claude/` for cloud sessions, which don't install repo-enabled plugins. Hook plugins are copied whole to `.claude/vendor/<plugin>/` and their hook commands run with `CLAUDE_PLUGIN_ROOT` set to that copy

## Rules

- Third-party marketplace entries (`superpowers`, `playwright-cli`) must pin a full 40-character `sha` and name the upstream repository and license in `description`. Bump the sha only after reviewing the upstream diff, then rerun the install test in README "기본 탑재 플러그인".

- Skills: gerund names (`verifying-changes`), third-person description stating what + when, body under 500 lines, reference files one level deep. Checklist: `plugins/omni-core/skills/authoring-skills/checklist.md`.
- Hook scripts must exit 0 with no output when they have no decision; use exit 2 or JSON `permissionDecision` only to block. Quote `"${CLAUDE_PLUGIN_ROOT}"` in commands.
- Bump `version` in a plugin's `plugin.json` on every user-visible change; installed users stay pinned to the old version until it changes.
- Add a test case to `tests/test-hooks.sh` for every guardrail pattern change.
- Run `python3 scripts/validate.py` and `tests/test-hooks.sh` before committing.
