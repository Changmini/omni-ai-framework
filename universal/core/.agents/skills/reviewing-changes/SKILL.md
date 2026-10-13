---
name: reviewing-changes
description: Reviews a finished change against its plan or requirements and reports only gaps that affect correctness. Use before declaring a multi-file task done, or when the user asks for a review of a diff.
---

# Reviewing changes

An author is a poor reviewer of their own change. Review in a fresh context.

1. Collect the inputs:
   - the diff (for example `git diff` and `git diff --staged`, or the range the user names)
   - the plan, spec, or requirements; if none exist, infer the intent from the diff and say so
2. Run the `reviewer` role from `AGENTS.md` with these inputs.
   - **If you can start a sub-agent:** give it `.agents/agents/reviewer.md` as instructions and the inputs above. Do not pass your own reasoning about the change.
   - **Fallback:** follow `.agents/agents/reviewer.md` yourself as a separate pass, reading only the diff and the requirements.
3. Act on the report:
   - Fix every finding that affects correctness or a stated requirement, then run the checks again.
   - Findings about style are optional; mention them, do not chase them.
   - If a finding is wrong, say why in one line.
4. If the user asked for a written report, use `.agents/docs/templates/review.md`.
