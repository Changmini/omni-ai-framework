---
name: writing-specs
description: Interviews the user about a feature and writes a self-contained spec before implementation. Use when the user wants to design or scope a larger feature or asks to be interviewed about requirements.
metadata:
  omni.invocation: manual
  omni.arguments: "[feature summary]"
---

# Writing specs

1. Read enough of the codebase to ask informed questions.
2. Interview the user. Ask a few questions at a time; skip anything the code already answers. Cover:
   - technical approach and affected interfaces
   - user-facing behavior and edge cases
   - failure modes, security, performance
   - trade-offs and explicit non-goals
   If your environment has a structured question tool, you may use it; plain questions in your reply work too.
3. Stop interviewing when every section of `.agents/docs/templates/spec.md` can be filled without guessing.
4. Write the spec with `.agents/skills/writing-documents/SKILL.md`, using the spec template.
5. Recommend starting implementation in a fresh session that begins by reading the spec.
