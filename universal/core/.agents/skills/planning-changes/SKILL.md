---
name: planning-changes
description: Plans and executes a multi-file or unfamiliar code change as explore, plan, implement, verify, review. Use when a change touches several files, the approach is uncertain, or the code is unfamiliar. Skip it for changes describable in one sentence.
metadata:
  omni.arguments: "[task description]"
---

# Planning changes

Copy this checklist into your reply and keep it updated:

```
Progress:
- [ ] 1. Explore: read the relevant code, make no edits
- [ ] 2. Plan: files, approach, out of scope, verification
- [ ] 3. Confirm the plan with the user if scope or approach is ambiguous
- [ ] 4. Implement against the plan
- [ ] 5. Verify: run the checks, show the output
- [ ] 6. Review: independent review of the diff
- [ ] 7. Commit, only if the user asked
```

## 1. Explore

- Read before writing. Find existing code to reuse: similar modules, helpers, tests.
- Keep the search scoped. For a broad question, use the `explorer` role from `AGENTS.md`.

## 2. Plan

Write the plan with the template `.agents/docs/templates/plan.md`. It must contain:

- **Goal**: one sentence.
- **Files**: each file to change and why.
- **Out of scope**: what will not change.
- **Verification**: the exact command or observation that proves success.

If no check exists, first write one that fails today (for example a test that reproduces the bug).
For a large or risky change, the `planner` role can draft the plan.

## 3–4. Implement

- Follow the plan. If reality differs, update the plan and say so.
- Match the surrounding code's style, naming, and comment density.
- Fix root causes. Do not silence errors or weaken checks.

## 5. Verify

Follow `.agents/skills/verifying-changes/SKILL.md`. Report evidence, not claims.

## 6. Review

Follow `.agents/skills/reviewing-changes/SKILL.md`. Fix findings that affect correctness or the stated requirements; treat style-only findings as optional.
