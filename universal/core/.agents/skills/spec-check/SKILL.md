---
name: spec-check
description: Reviews a finished change against its spec through the reviewer role, which only reads, does not know how the change was made, and reports only the gaps. Use after implementation and before accepting a change, or when the user asks for a review of a diff.
---

# Spec check

A reviewer who did not see how the change was made is not pulled along by its reasoning. Give it the standard and the result, nothing else.

1. Collect the inputs:
   - the spec path; if there is none, write the requirements you were given into a short file and say the review is against that
   - the change as a file: the diff of the implementer's branch against its base (for example `git diff <base>...<branch>`), saved outside the repository
   - optionally a scope limit, for example "skip style; report anything that affects correctness"
2. Run the `reviewer` role from `AGENTS.md` with these inputs.
   - **If you can start a sub-agent:** give it `.agents/agents/reviewer.md` as instructions and only the inputs above, with read and search access only. Do not pass the conversation or the implementer's report.
   - **Fallback:** follow `.agents/agents/reviewer.md` yourself as a separate pass, reading only the spec and the diff.
3. Act on the gaps as the lead (`.agents/skills/develop/SKILL.md`, step 8 "Act on gaps"). If the report is long, keep it as a file and pass its path on.
4. If the user asked for a written report, use `.agents/docs/templates/review.md`.
