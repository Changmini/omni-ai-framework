---
name: authoring-skills
description: Creates or revises skills and agent role files in this framework's format. Use when the user wants to add a skill or role, turn a repeated workflow into one, or fix one that is not picked up.
metadata:
  omni.arguments: "[what the skill or role should do]"
---

# Authoring skills and roles

## Choose the right form

| Need | Form |
| --- | --- |
| A short fact needed in every task | A line in `AGENTS.md` → "Project" |
| A rule for one part of the codebase | `AGENTS.md` in that subdirectory |
| Knowledge or a workflow needed only sometimes | A skill: `.agents/skills/<name>/SKILL.md` |
| Work that needs a fresh, isolated context | A role: `.agents/agents/<name>.md` |
| Something that must happen every time | A script run by a git hook or CI, not an instruction |

## Write a skill

1. Start from [assets/skill-template.md](assets/skill-template.md).
2. Apply every rule in [references/checklist.md](references/checklist.md).
3. Create `evals/evals.json` with at least three realistic prompts, including one where the skill should not apply.

## Write a role

1. Start from [assets/role-template.md](assets/role-template.md).
2. The body is the complete instruction set: the role cannot see the caller's conversation.

## Register and validate

1. Rebuild the indexes in `AGENTS.md`: run `python3 <framework>/tools/omni.py index .` if the framework tools are available. Otherwise edit the rows between the `omni:skills` or `omni:agents` markers by hand, copying the `description` exactly.
2. Run `python3 <framework>/tools/omni.py validate .` if available, and fix every error.
3. Test: run the eval prompts with and without the skill in fresh sessions and compare.
