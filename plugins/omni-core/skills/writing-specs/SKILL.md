---
name: writing-specs
description: Interviews the user about a feature and writes a self-contained SPEC.md before implementation starts. Use when the user wants to design or scope a larger feature, or asks to be interviewed about requirements.
argument-hint: "[feature summary]"
disable-model-invocation: true
---

# Writing specs

Feature: $ARGUMENTS

1. Read enough of the codebase to ask informed questions.
2. Interview the user with the AskUserQuestion tool. Skip obvious questions; dig into the hard parts:
   - technical approach and affected interfaces
   - UI/UX and edge cases
   - failure modes, security, performance
   - tradeoffs and explicit non-goals
3. Keep interviewing until every section of the template below can be filled without guessing.
4. Write `SPEC.md` using this template:

```markdown
# <Feature name>

## Goal
<one paragraph: the problem and the outcome>

## Scope
- In: ...
- Out: ...

## Design
<files, modules, and interfaces involved; data flow>

## Edge cases
- ...

## Verification
<end-to-end steps or commands that prove the feature works>

## Open questions
- ...
```

5. Recommend implementing in a fresh session that starts from `SPEC.md`.
