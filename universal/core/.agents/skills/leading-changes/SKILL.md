---
name: leading-changes
description: Leads a change from the user's request to an accepted result as the lead role. Decides whether it needs the spec, implement, review structure; interviews the user and writes the spec; hands it to the implementer and reviewer roles; and acts on the gaps they report. Use when a change touches several files or the requirements are unclear. Skip it for a one- or two-file change.
metadata:
  omni.arguments: "[request]"
---

# Leading changes

The lead talks with the user; other sessions exchange only files. The spec is the one standard every session reads.

```
user ↔ lead ──writes──▶ spec ──▶ implementer ──▶ commits, diff
                         │                           │
                         └────────▶ reviewer ◀───────┘
lead ◀── gaps only ── reviewer
```

Copy this checklist into your reply and keep it updated:

```
Progress:
- [ ] 1. Decide: direct edit or the full structure
- [ ] 2. Spec: interview the user, write the spec, confirm it
- [ ] 3. Implement: hand the spec to the implementer
- [ ] 4. Review: hand the spec and the change to the reviewer
- [ ] 5. Decide on each gap; repeat 3–4 until none is left
- [ ] 6. Report every "done when" item with its evidence
```

## 1. Decide

Use the full structure only when it pays for itself:

- **One- or two-file change:** do it directly in this session; a new session would only rebuild context. Verify with `.agents/skills/verifying-changes/SKILL.md`.
- **One implementer and the user checks every step:** a single pass of `.agents/skills/reviewing-changes/SKILL.md` at the end is enough.
- **Otherwise:** continue with step 2.

## 2. Spec

1. Read enough of the code to ask informed questions.
2. If the request is unclear, interview the user until the spec can be written without guessing. Ask a few questions at a time; skip what the code already answers. Cover behavior and edge cases, constraints (interfaces, security, performance, what must not change), and what is out of scope. A structured question tool may be used if the environment has one.
3. Write the spec. Project rules come first:
   - **The project names where specs go** (the "Project" section of `AGENTS.md`, or a rules or docs file it points to): use that folder, its file-name pattern, and its spec template or section layout.
   - **It names nothing:** write `docs/specs/<name>.md`, `<name>` being a short kebab-case name for the change, with `.agents/docs/templates/spec.md` and `.agents/skills/writing-documents/SKILL.md`. If that file already belongs to another change, pick another name.

   Whatever the format, the spec must state the requirements, the constraints, and "done when". If the project's layout has no place for one of them, add a section for it at the end. "Done when" is the core: it tells the implementer when to stop and the reviewer what to judge by, so each item must be checkable by a command or an observation.
4. Show the spec to the user and get approval before step 3.

When a decision changes later, update the spec at once.

## 3. Implement

Follow `.agents/skills/implementing-specs/SKILL.md`. Give the implementer the spec path, not a summary of the conversation. For several implementers, give each its own branch or worktree and parts of the spec that do not touch the same files.

## 4. Review

Follow `.agents/skills/reviewing-changes/SKILL.md` with the spec and the implementer's change. The reviewer must not see the conversation or the implementer's reasoning.

## 5. Decide on each gap

| The gap shows | Do |
| --- | --- |
| The change misses the spec | List the gaps in a file and hand it, with the spec path, back to the implementer (step 3) |
| The spec was wrong or incomplete | Ask the user, update the spec, then step 3 |
| The finding is wrong | Say why in one line and drop it |

Hand over files and paths, not retold findings: retelling loses detail at each hop.

## 6. Report

Check every "done when" item with a command or an observation and report the evidence. If any item is unchecked, say so instead of reporting done.
