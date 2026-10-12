---
name: authoring-skills
description: Creates or revises Agent Skills (SKILL.md folders) that follow Anthropic's authoring rules for naming, descriptions, progressive disclosure, and size. Use when the user wants to add a new skill, turn a repeated workflow into a skill, or fix a skill that does not trigger.
argument-hint: "[what the skill should do]"
---

# Authoring skills

Request: $ARGUMENTS

## Decide where it lives

| Scope | Path |
| --- | --- |
| This project only | `.claude/skills/<name>/SKILL.md` |
| All your projects on this machine | `~/.claude/skills/<name>/SKILL.md` |
| Every project that enables this framework | `plugins/omni-core/skills/<name>/SKILL.md` in the omni-ai-framework repo |

Prefer CLAUDE.md for short facts needed every session, a skill for knowledge or workflows needed only sometimes, and a hook for anything that must happen every time.

## Write it

1. Start from [template.md](template.md).
2. Apply every rule in [checklist.md](checklist.md).
3. Put long reference material in separate files linked directly from SKILL.md (one level deep).
4. Put deterministic steps in scripts under `scripts/` and reference them with `${CLAUDE_SKILL_DIR}/scripts/...`.

## Validate

If working in the omni-ai-framework repo, run `python3 scripts/validate.py` and fix every error. Otherwise check the result manually against [checklist.md](checklist.md).

Then test: run the same representative request in a fresh session with and without the skill and compare.
