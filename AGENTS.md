# omni-ai-framework

Two areas with different rules:

- `universal/` — tool- and model-neutral framework. `universal/core/` is copied verbatim into projects: never name a specific AI tool, tool API, or model there (`omni.py validate` enforces it). After adding or editing a skill or role in `universal/core/`, run `python3 universal/tools/omni.py index universal/core`; tool-specific output belongs in `universal/adapters/<tool>/`. Mark every claim about a tool's behavior as verified (with an official source link) or unverified, as in `universal/docs/STANDARDS.md`.
- `claude-code/` — Claude Code-only implementation. Its own rules and commands are in `claude-code/AGENTS.md`.

No personal data anywhere — files, examples, tests, screenshots or commit messages: no real names, account or OS user names, home paths, emails, phone numbers, account ids, company project names, issue keys or business details. Use generic placeholders (`user`, `/home/user/sample-app`, `PROJ-123`). Screenshots must be taken in a clean sample environment; `.github/scripts/check-personal-data.py` runs in CI but cannot read images.

No tool-specific files outside `claude-code/` (and later `universal/adapters/`). `claude-code/` is itself the Claude Code marketplace root.

## Checks

- `python3 .github/scripts/check-personal-data.py`
- `python3 universal/tools/omni.py validate universal/core && universal/tools/tests/run.sh`
- `cd claude-code && python3 scripts/validate.py && tests/test-hooks.sh && tests/test-jira-guard.sh`
