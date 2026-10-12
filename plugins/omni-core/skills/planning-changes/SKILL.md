---
name: planning-changes
description: Runs the explore, plan, implement, verify, commit workflow for a multi-file or unfamiliar change. Use when the user asks for a feature, refactor, or fix that touches several files, when the approach is uncertain, or when the code being changed is unfamiliar. Skip it for changes describable in one sentence.
argument-hint: "[task description]"
---

# Planning changes

Task: $ARGUMENTS

Copy this checklist into your response and keep it updated:

```
Progress:
- [ ] 1. Explore: read the relevant code, no edits
- [ ] 2. Plan: list files to change, approach, and the check that proves it works
- [ ] 3. Confirm the plan with the user when scope or approach is ambiguous
- [ ] 4. Implement against the plan
- [ ] 5. Verify: run the check, show its output
- [ ] 6. Review: run the adversarial-reviewer subagent on the diff
- [ ] 7. Commit with a descriptive message (only if the user asked)
```

## 1. Explore

- Read before writing. Find existing patterns to reuse (similar modules, helpers, tests).
- Scope the search. For broad investigations, delegate to a subagent so the main context stays clean.

## 2. Plan

Write a short plan:

- **Goal**: one sentence.
- **Files**: each file to change and why.
- **Out of scope**: what will not change.
- **Verification**: the exact command(s) or observation that will show success (test, build, lint, screenshot).

If no verification exists, propose one (for example a failing test that reproduces the bug) before implementing.

## 3–4. Implement

- Follow the plan; if reality diverges, update the plan and say so.
- Match the surrounding code's style, naming, and comment density.
- Fix root causes; do not suppress errors.

## 5. Verify

Run the checks from the plan. Report evidence (command + result), not assertions. On failure, fix and re-run until green. See the `verifying-changes` skill for how to discover checks.

## 6. Review

Delegate to the `adversarial-reviewer` subagent with the plan and the diff. Fix findings that affect correctness or stated requirements; treat style-only findings as optional.
