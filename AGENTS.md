# omni-ai-framework

Two areas with different rules:

- `universal/` — tool- and model-neutral framework. `universal/core/` is copied verbatim into projects: never name a specific AI tool, tool API, or model there (`omni.py validate` enforces it). After adding or editing a skill or role in `universal/core/`, run `python3 universal/tools/omni.py index universal/core`; tool-specific output belongs in `universal/adapters/<tool>/`. Mark every claim about a tool's behavior as verified (with an official source link) or unverified, as in `universal/docs/STANDARDS.md`.
- `claude-code/` — Claude Code-only implementation. Its own rules and commands are in `claude-code/AGENTS.md`.

No tool-specific files outside `claude-code/` (and later `universal/adapters/`). `claude-code/` is itself the Claude Code marketplace root.

## Checks

- `python3 universal/tools/omni.py validate universal/core && universal/tools/tests/run.sh`
- `cd claude-code && python3 scripts/validate.py && tests/test-hooks.sh`
