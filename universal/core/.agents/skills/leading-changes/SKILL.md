---
name: leading-changes
description: Leads a change from the user's request to an accepted result as the lead role. Reads the project's pipeline settings, surveys the scope, picks one of three setups by fixed rules in two steps (solo before any spec; with an independent review, or split work, once the spec fixes the scope), interviews the user and writes the spec keeping every development-relevant detail of the conversation, implements or hands the work to the implementer role, has the reviewer role check it, acts on each reported gap, re-checks the setup against the real diff, and proposes settings worth keeping. Use when a change touches several files or the requirements are unclear, when defining a task's goal and done criteria before work, or when the user asks to run the development pipeline.
metadata:
  omni.arguments: "[request]"
---

# Leading changes

The lead talks with the user; the implementer and the reviewer never hear the conversation, only the files the lead gives them. The spec is the one standard every session reads, so what the conversation settles for development goes into it organized but not shortened.

There are three setups. Steps 2 and 4 pick one for each change.

| Setup | Who implements | Spec | Independent review |
| --- | --- | --- | --- |
| **Solo** | This session | None ("done when" in the reply only) | None |
| **With review** | This session | Yes | Reviewer role |
| **Split** | Implementer role | Yes | Reviewer role |

The values in this skill are defaults. What differs per project is set in the "Project → Change pipeline" section of `AGENTS.md` (the **project settings**). Step 1 reads them; step 10 proposes what this change taught.

Copy this checklist into your reply and keep it updated. Each step is explained under the heading with the same number.

```
Progress:
- [ ] 1. Survey the scope: read the project settings, write the scope note
- [ ] 2. First call: solo, or a spec is needed
- [ ] 3. "Done when" and spec: solo writes "done when" only; otherwise interview, spec, conversation check, approval
- [ ] 4. Second call: with review or split, from the spec
- [ ] 5. Implement: solo and with review here; split through the implementer
- [ ] 6. Verify: check every "done when" item with a command
- [ ] 7. Review: with review and split go to the reviewer
- [ ] 8. Act on gaps: decide each, back to 5 (at most 3 review rounds)
- [ ] 9. Re-check against the real change: did the diff outgrow the setup?
- [ ] 10. Report: every "done when" item with its evidence; propose settings
```

**Re-read** the spec (solo: the "done when" lines) instead of relying on memory when a step changes, after the conversation is compacted, and when a new request or review finding arrives mid-work. A new request outside the goal goes to "out of scope"; ask the user whether to take it in.

File names in the examples come from one sample project; read `<test command>` as the project's own (for example `python3 -m unittest`, `./gradlew test`, `npm test`).

---

## 1. Survey the scope

Before picking a setup, find out briefly what will change. The pick is an estimate; this step makes it a better one.

1. Read the project settings. Use the default for any item that is missing.

   | Setting | Used in step | Default |
   | --- | --- | --- |
   | Spec location and layout | 3 | `docs/specs/<name>.md`, layout in spec-guide.md |
   | Setup thresholds | 2, 4, 9 | Solo 1–2 source files; split from 6 source files or 3 modules |
   | Risky areas (added) | 1, 2, 9 | The common list below |
   | Always ask in the interview | 3 | None |
   | Extra spec sections | 3 | None |
   | Test and check commands, run check | 6 | What `.agents/skills/verifying-changes/SKILL.md` finds |
   | Extra review focus | 7 | Correctness only |
   | Out of scope | 5, 9 | None |

   If there are no project settings at all, draft them from what the survey finds (test command, where money, permissions, or migrations live, an existing spec folder) and show the draft with the scope note. Write it into `AGENTS.md` only when the user approves. If they decline, go on with the defaults and do not ask again in this session.
2. Look for an existing spec or record of the same work in the spec location.
3. Search the code for the features, functions, and data the request names; open their definitions and callers. Follow one step further: who calls the code that changes, who uses the same data, which tests cover it.
4. Write a **scope note** in your reply:

```
Scope note
- Request: cancel part of the quantity of an open order
- Project settings: present — specs in docs/specs/, risky area "stock counts" added
- Will change (estimate): orders — add cancel_items; inventory — calls release only (1 source file, 2 modules)
- Risky areas: money (coupon discount is recalculated)
- Unknowns: which line shrinks when the item appears twice; the order's status after its last line goes
```

**Risky areas** (the same meaning everywhere in this skill; add the project's own):

- Money, payment, or settlement calculations
- Deleting data, changing a stored format or schema, migrating data
- Authentication, permissions, secrets
- Interfaces other code or outside users rely on: public APIs, arguments and return values of functions other modules call, file and message formats
- Concurrency, transactions, retries: places where failures show up late

## 2. First call

Decide from the scope note only whether the change is **solo** or **needs a spec**. "With review" versus "split" waits for step 4, because the number of files is only clear once the spec is written.

Take the first that fits, from the top:

1. **The user decided**: "do it yourself", "get it reviewed", "split it": follow it.
2. **Solo**: the source files expected to change (tests and docs excluded) are within the solo threshold, and "unknowns" and "risky areas" are both empty.
3. **Spec needed**: everything else. When unsure, pick this one: redoing a wrong solo costs more than writing a spec.

Announce it in one line: `Setup (first call): spec needed — coupon recalculation (money), 2 unknowns`.

## 3. "Done when" and spec

### 3-1. Solo: "done when" only

Before implementing, write 2–5 "done when" lines in your reply, each decidable by a command or an observation. Then go to step 5.

```
Done when
- [ ] A blank name is rejected as invalid input (new test "blank name")
- [ ] All existing tests pass (`<test command>`)
```

### 3-2. Interview

Ask about the "unknowns" and the project's "always ask" questions that apply. Stop when **"done when" can be written without guessing**.

- Ask 1–4 questions at a time. Offer options and put a recommended one first, marked "(recommended)". A structured question tool may be used if the environment has one.
- Do not ask what the code already answers; quote what you found as the reason.
- Cover the normal behavior, edge cases (zero, empty, maximum, duplicates, the same instant), errors, what must not change, and what is out of scope.
- Write each answer into the draft spec **right away**: the chosen answer with its reasons, conditions, and examples under "Request and clarifications", and its effect in the section it changes (requirements, constraints, decisions). Also record what the user says unasked that matters for development (preferences, dislikes, example situations). A long conversation gets compacted and is lost.
- Do not copy what the user said; rewrite it as a behavior statement (for example "Clicking OK should just close the modal" → the selection dialog closes after OK or Cancel). Leave out profanity, small talk, and personal data; keep every condition, reason, and example. See "Request and clarifications" in spec-guide.md.

```
Question: an order holds the same item on two lines. Which line shrinks on a partial cancel?
- The first line first (recommended) — creating an order does not merge equal items (orders: create_order)
- Both lines in proportion
- Reject the cancel when an item is on more than one line
```

### 3-3. Write the spec

**Read [spec-guide.md](spec-guide.md) and follow it.** It covers location, sections, how to write each, and a full example. Step 4 decides from "files to change", so list every file and module.

### 3-4. Conversation check

Before showing the spec, check both and fix what fails:

1. **Conversation check**: re-read every user message since the request. Everything said about the change needs a place in the spec (a requirement, scenario, constraint, out of scope, decision, or "not used: reason"). Add what has none and give it a place. Skip small talk and emotion.
2. The checklist in spec-guide.md.

### 3-5. Approval

Show the spec path and a summary (requirements and scenarios, files to change, `Conversation check: 12 user messages — all placed`) and get approval. Do not implement before it. When a decision changes later, update the spec at once and tell the user which lines changed.

## 4. Second call

From the approved spec's "files to change", settle the setup.

**Split** when any of these holds:

- The source files or modules to change reach the split threshold.
- There are two or more groups of work that change different files and do not wait for each other.
- The interview and survey have made this session long, and starting clean from the spec alone is better.

**With review**: everything else. A separate implementer has to rebuild context, which costs time and tokens, so split only for the reasons above.

Announce it in one line: `Setup (final): with review — 2 source files, 2 modules`.

## 5. Implement

### Solo and with review: in this session

1. Note the starting commit (`git rev-parse HEAD` or equivalent); steps 7 and 9 use it.
2. Where a "done when" item can become a test, write the test first and see it fail.
3. If a file outside "files to change" must change, stop and decide whether to update the spec or tell the user.
4. If the spec turns out wrong or incomplete, do not paper over it in code: go back to 3-2 and update the spec.

### Split: through the implementer

Follow `.agents/skills/implementing-specs/SKILL.md`. Give the implementer the spec path (and, on a fix round, the file listing the gaps) and nothing else: the conversation is already organized in the spec. With separate groups, give each its own implementer, divided by requirement numbers.

## 6. Verify

Run the project's tests and checks with `.agents/skills/verifying-changes/SKILL.md` and keep the results per "done when" item:

```
| Done when | Check | Result |
| --- | --- | --- |
| D1 stock released after a partial cancel | `<test command> <partial cancel tests>` | passed |
| D2 existing tests | `<test command>` | 14 passed |
```

- Do not move on until it passes. If the same failure survives two fixes, rethink the cause; if it still fails, ask the user.
- In a split, run the implementer's commands yourself.

## 7. Review

With review and split: follow `.agents/skills/reviewing-changes/SKILL.md`.

- Give: the spec path, the change as a diff file (with review: since the starting commit, uncommitted changes included; split: the implementer's branch), and the scope "only gaps that affect correctness" plus the project's "extra review focus".
- Do not give: explanations from you or the implementer. The reviewer is useful because it has not seen how the change was made.
- Do not skip it or replace it with reading the diff yourself. Only if the user checks every step of a with-review change themselves may a single review pass at the end replace the reviewer role.

## 8. Act on gaps

For each reported gap, open the file and line yourself, confirm the evidence, then decide:

| The gap shows | Do |
| --- | --- |
| The change misses the spec | With review: fix it. Split: list the gaps in a file for the implementer (step 5) |
| The spec was wrong or incomplete | Ask the user (3-2), update the spec, then step 5 |
| The finding is wrong | Say why in one line and drop it |

```
Gaps (review round 1)
1. R3 no event when the last line is cancelled — orders:71 — right → fixed
2. S4 negative quantity — already rejected (orders:62) — wrong finding → dropped
```

After fixing, run steps 6 and 7 again. If gaps remain after 3 rounds, stop, show them with your decisions, and ask.

## 9. Re-check against the real change

Count the changed source files since the starting commit (`git diff --stat <start>`) and look for risky areas among them.

| Setup used | The real change | Do |
| --- | --- | --- |
| Solo | Beyond the solo threshold, or a risky area | Write a short spec from what was decided and add step 7. Tell the user |
| With review or split | Touches files outside "files to change" | Give a reason for each or revert it. If the scope widens, update the spec and review again |
| Any | Within its limits | Step 10 |

Never move down to a lighter setup unless the user says so.

## 10. Report

```
Setup: with review — coupon recalculation (money), 2 files to change
Decisions: the first line shrinks for a repeated item; cancelling the last line cancels the order (spec K1, K2)
Requirements: R1–R4 done, R5 deferred (user's call, next change)
Done when:
- [x] D1 ... — `<test command> ...` → passed
Review: 2 rounds, 3 gaps (2 fixed, 1 wrong finding)
Left: none
```

- Each requirement is done, deferred (why), or not done (why). Never "almost done".
- If any "done when" item is unchecked, do not report done; name the missing evidence.
- Commit or push only when the user asks.

**Propose settings** only when this change found something the next one will need: one or two lines for the project settings (a risky area found late, a question to ask every time, a check command, an added spec section). If the settings have grown long, also propose lines to merge or drop. Write only the lines the user approves.

```
Proposed setting: add risky area "stock count calculation (inventory)" — found late, at step 9
```

---

## Common mistakes

- Picking a setup without reading the project settings and surveying the scope, then meeting a risky area late.
- Leaving a decision out of the spec, or blurring it, so the implementer and reviewer miss its conditions and reasons.
- Pasting the conversation, so profanity, small talk, or personal data land in the spec.
- Getting approval without the conversation check, so a requirement raised unasked is lost.
- Always splitting, spending two to three times the cost on small changes.
- Passing a reviewer's finding to the implementer without checking its evidence.
- Skipping step 9, so a solo change that grew ends without a review.
