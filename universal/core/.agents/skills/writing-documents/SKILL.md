---
name: writing-documents
description: Writes specs, plans, decision records, and review reports using the repository's document templates and style rules. Use when the user asks for any of these documents or a skill step produces one.
---

# Writing documents

1. Pick the template:

   | Document | Template |
   | --- | --- |
   | Feature spec | `.agents/docs/templates/spec.md` |
   | Implementation plan | `.agents/docs/templates/plan.md` |
   | Decision record | `.agents/docs/templates/decision.md` |
   | Review report | `.agents/docs/templates/review.md` |

   If none fits, use the closest one and drop sections that do not apply.
2. Read `.agents/docs/STYLE.md` once per session.
3. Fill every section. Write "None" for an empty section instead of deleting it, unless the template says it is optional.
4. Save to the location in `AGENTS.md` section 4, unless the user or the project section says otherwise.
5. Check the result against this list and fix every miss:

   ```
   - [ ] First paragraph says what the document is for and who decides
   - [ ] Every claim about external behavior is marked verified (with a source) or unverified
   - [ ] Dates are absolute (YYYY-MM-DD), no "recently" or "next week"
   - [ ] Links are relative paths that exist
   - [ ] No section repeats another
   ```
