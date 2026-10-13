# omni-ai-framework

Two areas with different rules:

- `universal/` — tool- and model-neutral framework (design stage). Never name a specific AI tool, tool API, or model in `universal/core/`; tool-specific output belongs in `universal/adapters/<tool>/`. Mark every claim about a tool's behavior as verified (with an official source link) or unverified, as in `universal/docs/STANDARDS.md`.
- `claude-code/` — Claude Code-only implementation. Its own rules and commands are in `claude-code/AGENTS.md`.

No tool-specific files outside `claude-code/` (and later `universal/adapters/`). `claude-code/` is itself the Claude Code marketplace root.

## Checks

- `cd claude-code && python3 scripts/validate.py && tests/test-hooks.sh`
