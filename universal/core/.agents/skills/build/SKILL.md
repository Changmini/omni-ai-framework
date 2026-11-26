---
name: build
description: Hands a written spec to the implementer role so the work starts in a fresh context from the spec alone, on its own branch or worktree, and comes back as commits and a diff. Use when a spec exists and is approved, or the user asks to implement a spec file.
metadata:
  omni.arguments: "[spec path]"
---

# Build

A fresh context that starts from the spec beats one weighed down by the planning conversation, and the written "done when" tells it when to stop.

1. Confirm the inputs:
   - the spec path, with an approved spec
   - a branch or worktree per implementer, made from the current commit; with several implementers, parts of the spec that do not touch the same files
   - put a worktree **inside the project**: `mkdir -p .worktrees && printf '*\n' > .worktrees/.gitignore`, then `git worktree add .worktrees/<branch> -b <branch>`. The `.gitignore` inside that folder keeps it out of version control and searches without touching the project's own `.gitignore` or files under `.git/`. Tools that limit commands to the project folder block a worktree beside the repository.
   - for a fix round, a file listing the gaps to fix
2. Run the `implementer` role from `AGENTS.md`.
   - **If you can start a sub-agent:** give it `.agents/agents/implementer.md` as instructions and only the inputs above. Do not pass the conversation or your own notes on the change.
   - **Fallback:** start a new session, or do a separate pass yourself, that reads only `.agents/agents/implementer.md`, the spec, and the code.
3. Check the report:
   - each "done when" item is met with evidence, or the reason it is not
   - "Spec problems" go to the lead's decision, not straight back into code
4. Pass the branch and its diff on to `.agents/skills/spec-check/SKILL.md`.
