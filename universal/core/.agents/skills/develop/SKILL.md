---
name: develop
description: Leads a change from the user's request to an accepted result as the lead role. Reads the project's pipeline settings, has the router role survey the scope and pick one of three setups by fixed rules at each decision point (solo or spec first; with an independent review, or split work, once the spec fixes the scope; a re-check against the real diff), interviews the user and writes the spec keeping every development-relevant detail of the conversation, implements or hands the work to the implementer role, has the reviewer role check it, acts on each reported gap, and proposes settings worth keeping. Use when a change touches several files or the requirements are unclear, when defining a task's goal and done criteria before work, or when the user asks to run the development pipeline.
metadata:
  omni.arguments: "[request]"
---

# Develop

The lead talks with the user; the implementer and the reviewer never hear the conversation, only the files the lead gives them. The spec is the one standard every session reads, so what the conversation settles for development goes into it organized but not shortened.

There are three setups. For each change the **router role** picks one (steps 2, 4, and 9); the rules and what to give it are in [setup-guide.md](setup-guide.md).

| Setup | Who implements | Spec | Independent review |
| --- | --- | --- | --- |
| **Solo** | This session | None ("done when" in the reply only) | None |
| **With review** | This session | Yes | Reviewer role |
| **Split** | Implementer role | Yes | Reviewer role |

The values in this skill are defaults. What differs per project is set in the "Project → Change pipeline" section of `AGENTS.md` (the **project settings**). Step 1 reads them; step 10 proposes what this change taught.

Copy this checklist into your reply and keep it updated. Each step is explained under the heading with the same number.

```
Progress:
- [ ] 1. Prepare: read the project settings, write the request brief
- [ ] 2. First call (router): solo, or a spec is needed
- [ ] 3. "Done when" and spec: solo writes "done when" only; otherwise interview, spec, conversation check, approval
- [ ] 4. Second call (router): with review or split, from the spec
- [ ] 5. Implement: solo and with review here; split through the implementer
- [ ] 6. Verify: check every "done when" item with a command
- [ ] 7. Review: with review and split go to the reviewer
- [ ] 8. Act on gaps: decide each, back to 5 (at most 3 review rounds)
- [ ] 9. Re-check (router): did the real change outgrow the setup?
- [ ] 10. Report: every "done when" item with its evidence; propose settings
```

**Re-read** the spec (solo: the "done when" lines) instead of relying on memory when a step changes, after the conversation is compacted, and when a new request or review finding arrives mid-work. A new request outside the goal goes to "out of scope"; ask the user whether to take it in.

File names in the examples come from one sample project; read `<test command>` as the project's own (for example `python3 -m unittest`, `./gradlew test`, `npm test`).

---

## 1. Prepare

1. Read the project settings. Use the default for any item that is missing.

   | Setting | Used in step | Default |
   | --- | --- | --- |
   | Spec location and layout | 3 | `docs/specs/<name>.md`, layout in spec-guide.md |
   | Setup thresholds | 2, 4, 9 | Solo 1–2 source files; split from 6 source files or 3 modules |
   | Risky areas (added) | 2, 4, 9 | The common list in setup-guide.md 3-3 |
   | Always ask in the interview | 3 | None |
   | Extra spec sections | 3 | None |
   | Test and check commands, run check | 6 | What `.agents/skills/test/SKILL.md` finds |
   | Extra review focus | 7 | Correctness only |
   | Out of scope | 5, 9 | None |

2. Look for an existing spec or record of the same work in the spec location.
3. Write the **request brief** for the router (setup-guide.md section 2): behavior statements, not the user's words, including any risk known only from the conversation.

## 2. First call (router)

If the user chose the setup, follow it and skip this step. Otherwise run the `router` role from `AGENTS.md`.

- **If you can start a sub-agent:** give it `.agents/agents/router.md` as instructions and only "Decision: first call" and the request brief, with read and search access only. Do not pass the conversation or the setup you expect.
- **Fallback:** follow `.agents/agents/router.md` yourself as a separate pass, using only the brief and the repository.
- You get back: the setup, the rule, a scope note (will change, risky areas, unknowns), evidence, confidence, and "For the lead".
- Then, per setup-guide.md section 9, open a few cited lines and announce it in one line: `Setup (first call): spec needed — 1-3, money (coupon recalculation), 2 unknowns`. Include the scope note in your reply.
- Do not overturn the result yourself. If it misses a fact only you know, add it to the brief and call again.
- If there are no project settings at all, draft them from the scope note and evidence and show the draft. Write it into `AGENTS.md` only when the user approves; if they decline, use the defaults and do not ask again in this session.

## 3. "Done when" and spec

### 3-1. Solo: "done when" only

Before implementing, write 2–5 "done when" lines in your reply, each decidable by a command or an observation. Then go to step 5.

```
Done when
- [ ] A blank name is rejected as invalid input (new test "blank name")
- [ ] All existing tests pass (`<test command>`)
```

### 3-2. Interview

Ask about the router's "unknowns" and "For the lead", and the project's "always ask" questions that apply. Stop when **"done when" can be written without guessing**.

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

## 4. Second call (router)

If the user chose the setup, follow it. Otherwise run the router again, the same way as step 2.

- Give: "Decision: second call", the approved spec path, and whether the interview and survey have made this session long enough that a fresh start is better.
- You get back: with review or split, the rule, for a split the work groups (requirement numbers and files), and the risky areas per requirement (add them to the step 7 review focus).
- Announce it in one line, `Setup (final): with review — 2-5, 2 source files, 2 modules`, and fill in the spec header's setup.

## 5. Implement

### Solo and with review: in this session

1. Note the starting commit (`git rev-parse HEAD` or equivalent); steps 7 and 9 use it.
2. Where a "done when" item can become a test, write the test first and see it fail.
3. If a file outside "files to change" must change, stop and decide whether to update the spec or tell the user.
4. If the spec turns out wrong or incomplete, do not paper over it in code: go back to 3-2 and update the spec.

### Split: through the implementer

Follow `.agents/skills/build/SKILL.md`. The starting commit is the one the branch or worktree was created from. Give the implementer the spec path (and, on a fix round, the file listing the gaps) and nothing else: the conversation is already organized in the spec. With separate groups, give each its own implementer, divided by requirement numbers.

## 6. Verify

Run the project's tests and checks with `.agents/skills/test/SKILL.md` and keep the results per "done when" item:

```
| Done when | Check | Result |
| --- | --- | --- |
| D1 stock released after a partial cancel | `<test command> <partial cancel tests>` | passed |
| D2 existing tests | `<test command>` | 14 passed |
```

- Do not move on until it passes. If the same failure survives two fixes, rethink the cause; if it still fails, ask the user.
- In a split, run the implementer's commands yourself.

## 7. Review

With review and split: follow `.agents/skills/spec-check/SKILL.md`.

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

## 9. Re-check (router)

The first and second calls were estimates. Before finishing, run the router again, even if the user chose the setup.

- Give: "Decision: re-check", the starting commit, the current setup, and the spec path if there is one.
- Then:

| Router result | Do |
| --- | --- |
| Raised to with review (solo outgrew its limits) | Write a short spec from what was decided (spec-guide.md) and add step 7. Tell the user; if the user had chosen solo, ask first and follow the answer |
| Unchanged, with files outside "files to change" | Give a reason for each or revert it. If the scope widens, update the spec and review again |
| Unchanged | Step 10 |

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

- Picking a setup by guess instead of calling the router, then meeting a risky area late.
- Giving the router part of the conversation instead of a request brief, or overturning its result without checking the evidence.
- Leaving a decision out of the spec, or blurring it, so the implementer and reviewer miss its conditions and reasons.
- Pasting the conversation, so profanity, small talk, or personal data land in the spec.
- Getting approval without the conversation check, so a requirement raised unasked is lost.
- Always splitting, spending two to three times the cost on small changes.
- Passing a reviewer's finding to the implementer without checking its evidence.
- Skipping the router at step 9, so a solo change that grew ends without a review.
