---
name: leading-changes
description: Leads a change from the user's request to an accepted result as the lead role. Surveys the scope, picks one of three setups by fixed rules in two steps (solo before any spec; solo with an independent review, or split work, once the spec fixes the scope), interviews the user and writes the spec when the setup needs one, implements or hands the work to the implementer role, has the reviewer role check it, acts on each reported gap, and re-checks the setup against the real diff before reporting. Use when a change touches several files or the requirements are unclear, or the user asks to run the development pipeline.
metadata:
  omni.arguments: "[request]"
---

# Leading changes

The lead talks with the user; the implementer and the reviewer never hear the conversation, only the files the lead gives them. The spec is the one standard every session reads.

There are three setups. Steps 2 and 4 below pick one for each change.

| Setup | Who implements | Spec | Independent review |
| --- | --- | --- | --- |
| **Solo** | This session | None ("done when" in the reply only) | None |
| **With review** | This session | Yes | Reviewer role |
| **Split** | Implementer role | Yes | Reviewer role |

Copy this checklist into your reply and keep it updated. Each step is explained under the heading with the same number.

```
Progress:
- [ ] 1. Survey the scope: what changes, risky areas, unknowns
- [ ] 2. First call: solo, or a spec is needed
- [ ] 3. "Done when" and spec: solo writes "done when" only; otherwise interview, spec, approval
- [ ] 4. Second call: with review or split, from the spec
- [ ] 5. Implement: solo and with review here; split through the implementer
- [ ] 6. Verify: check every "done when" item with a command
- [ ] 7. Review: with review and split go to the reviewer
- [ ] 8. Act on gaps: decide each, back to 5 (at most 3 review rounds)
- [ ] 9. Re-check against the real change: did the diff outgrow the setup?
- [ ] 10. Report: every "done when" item with its evidence
```

File names in the examples come from one sample project; read `<test command>` as the project's own (for example `python3 -m unittest`, `./gradlew test`, `npm test`). Use the commands the project rules name or `.agents/skills/verifying-changes/SKILL.md` finds.

---

## 1. Survey the scope

Before picking a setup, find out briefly what will change. The pick is an estimate, since no scenarios are written yet; this step makes it a better one.

1. Read the project rules (`AGENTS.md`, its "Project" section, and the files it points to): where specs go and their layout, the test command, services out of scope, setup thresholds.
2. Search the code for the features, functions, and data the request names. Open their definitions and their callers.
3. Follow one step further: who calls the code that changes, who uses the same data, which tests cover it.
4. Write a **scope note** in your reply:

```
Scope note
- Request: <one line>
- Will change (estimate): <file — what>, ...  (n source files, m modules)
- Risky areas: <from the list below, or "none">
- Unknowns: <what only the user can decide, or "none">
```

**Risky areas** (the same meaning everywhere in this skill):

- Money, payment, or settlement calculations
- Deleting data, changing a stored format or schema, migrating data
- Authentication, permissions, secrets
- Interfaces other code or outside users rely on: public APIs, arguments and return values of functions other modules call, file and message formats
- Concurrency, transactions, retries: places where failures show up late

Example:

```
Scope note
- Request: cancel part of the quantity of an open order
- Will change (estimate): orders — add cancel_items; inventory — calls release only (1 source file, 2 modules)
- Risky areas: money (coupon discount is recalculated)
- Unknowns: which line shrinks when the item appears twice; the order's status after its last line goes
```

## 2. First call

Decide from the scope note only whether the change is **solo** or **needs a spec**. "With review" versus "split" waits for the spec (step 4), because the number of files to change is only clear once the spec is written.

Take the first that fits, from the top:

1. **The user decided**: "do it yourself", "get it reviewed", "split it": follow it (with review or split go on to step 3).
2. **Solo**: all of these hold:
   - 1–2 source files (tests and docs excluded) are expected to change.
   - "Unknowns" is empty.
   - "Risky areas" is empty.
3. **Spec needed**: everything else. When unsure, pick this one: a wrong solo (a missed condition, redoing the work) costs more than writing a spec.

Announce it in one line: `Setup (first call): <solo | spec needed> — <what matched>`.

- `Setup (first call): solo — 1 source file, no unknowns, no risky areas`
- `Setup (first call): spec needed — coupon recalculation (money), 2 unknowns`

The thresholds (1–2 files) are defaults. If the project rules set others, use those.

## 3. "Done when" and spec

### 3-1. Solo: "done when" only

Before implementing, write 2–5 "done when" lines in your reply, each decidable by a command or an observation:

```
Done when
- [ ] `<test command> <user tests>` passes
- [ ] A blank name is rejected as invalid input (new test "blank name")
- [ ] All existing tests pass (`<test command>`)
```

Then go to step 5 (there is no step 4).

### 3-2. Interview

Ask about the scope note's "unknowns" first. Stop when one thing is true: **"done when" can be written without guessing, and every item can be decided.**

- Ask 1–4 questions at a time. Offer options and put a recommended one first, marked "(recommended)". A structured question tool may be used if the environment has one.
- Do not ask what the code already answers; quote what you found in the code as the reason.
- Cover the normal behavior, edge cases (zero, empty, maximum, duplicates, the same instant), what to do on errors, what must not change, and what is out of scope.
- Write each answer into the draft spec right away. A decision made only in conversation does not exist for the implementer and the reviewer.

Example question:

```
Question: an order holds the same item on two lines. Which line shrinks on a partial cancel?
- The first line first (recommended) — creating an order does not merge equal items today (orders: create_order)
- Both lines in proportion
- Reject the cancel when an item is on more than one line
```

### 3-3. Write the spec

**Read [spec-guide.md](spec-guide.md) and follow it.** It covers where the spec goes, its sections, how to write each one, good and bad sentences, and a full example.

In short:

- Project rules on spec location and layout come first. Without any, write `docs/specs/<name>.md` from `.agents/docs/templates/spec.md`.
- It must contain requirements, scenarios (normal, edge, error), constraints, out of scope, **files to change**, **done when**, and decisions with reasons.
- Step 4 decides from "files to change", so list every file and module.

### 3-4. Check it yourself

Before showing it, go through the checklist in spec-guide.md. Fix anything that fails first.

### 3-5. Approval

Show the spec path and a summary (number of requirements and scenarios, files to change, questions needing a decision) and get approval. Do not implement before it. When a decision changes later, update the spec at once and tell the user which lines changed.

## 4. Second call

From the approved spec's "files to change" and requirements, settle on **with review** or **split**.

**Split** when any of these holds:

- 6 or more source files change, or the change spans 3 or more modules.
- There are two or more groups of work that change different files and do not wait for each other's results (several implementers at once).
- The interview and survey have already made this session long, and starting clean from the spec alone is better.

**With review**: everything else.

An unclear request is not a reason to split: the spec has resolved it. A separate implementer has to rebuild context in a new session, which costs time and tokens, so split only when one of the reasons above holds.

Announce it in one line: `Setup (final): <with review | split> — <what matched>`.

- `Setup (final): with review — 2 source files, 2 modules`
- `Setup (final): split — 7 files; payment and notification groups are independent`

The thresholds (6 files, 3 modules) are defaults. If the project rules set others, use those.

## 5. Implement

### Solo and with review: in this session

1. Note the starting commit first (`git rev-parse HEAD` or your version control's equivalent); steps 7 and 9 use it.
2. Where a "done when" item can become a test, write the test first and see it fail.
3. Work in small steps. If a file outside "files to change" must change, stop and decide whether to update the spec (with review) or tell the user.
4. If the spec turns out wrong or incomplete, do not paper over it in code: go back to 3-2, ask the user, and update the spec.

### Split: through the implementer

Follow `.agents/skills/implementing-specs/SKILL.md`. Give the implementer the spec path (and, on a fix round, the file listing the gaps) and nothing from the conversation. If step 4 found separate groups, give each group its own implementer, divided by requirement numbers.

## 6. Verify

Run the project's tests and checks with `.agents/skills/verifying-changes/SKILL.md`, check each "done when" item, and keep the results as a table:

```
| Done when | Check | Result |
| --- | --- | --- |
| D1 stock released after a partial cancel | `<test command> <partial cancel tests>` | passed |
| D2 no discount below the coupon minimum | same tests, "coupon dropped" | passed |
| D3 existing tests | `<test command>` | 14 passed |
```

- On a failure, fix and run again. Do not move on until it passes.
- If the same failure survives two fixes, stop before a third and rethink the cause. If it still fails, show the situation to the user and ask.
- In a split, do not take the implementer's evidence on trust: run the same commands yourself.

## 7. Review

With review and split: follow `.agents/skills/reviewing-changes/SKILL.md`. Solo has no review here (step 9 re-checks it).

- Give the reviewer: the spec path, the change as a diff file (with review: everything since the starting commit, uncommitted changes included; split: the implementer's branch), and the scope "only gaps that affect correctness; skip style".
- Do not give: the conversation, or explanations from you or the implementer. The reviewer is useful because it has not seen how the change was made.
- Do not skip it, and do not replace it with reading the diff yourself.
- If the user checks every step of a with-review change themselves, a single review pass at the end replaces the reviewer role.

## 8. Act on gaps

For each reported gap, open the file and line yourself and confirm the evidence, then decide:

| The gap shows | Do |
| --- | --- |
| The change misses the spec | With review: fix it yourself. Split: list the gaps in a file and hand it, with the spec path, to the implementer (step 5). |
| The spec was wrong or incomplete | Ask the user (3-2), update the spec, then step 5 |
| The finding is wrong | Say why in one line and drop it |

Record the decisions, for example:

```
Gaps (review round 1)
1. R3 no event when the last line is cancelled — orders:71 — right → fixed
2. S4 negative quantity — already rejected (orders:62) — wrong finding → dropped
3. Same item on two lines — not in the spec → asked the user
```

- After fixing, run step 6 (verify) and step 7 (review) again.
- If gaps remain after 3 review rounds, stop, show the remaining gaps with your decisions, and ask the user how to proceed.
- Hand over files and paths, not retold findings: retelling loses detail at each hop.

## 9. Re-check against the real change

Steps 2 and 4 were estimates. Before finishing, check the real change.

1. Count the changed source files since the starting commit (`git diff --stat <start>` or equivalent) and look for risky areas among them.
2. Then:

| Setup used | The real change | Do |
| --- | --- | --- |
| Solo | 3 or more source files, or a risky area | Write a short spec from what was decided (spec-guide.md) and add step 7. Tell the user |
| With review or split | Touches files outside "files to change" | Give a reason for each or revert it. If the reason widens the spec, update the spec and review again |
| Any | Within its limits | Go to step 10 |

Example: `Re-check: done solo, but 4 files changed (price calculation included) → raised to with review; spec docs/specs/price-rounding.md written, then reviewed`.

Never move down to a lighter setup unless the user says so.

## 10. Report

In this order:

```
Setup: with review — coupon recalculation (money), 2 files to change
Decisions: the first line shrinks for a repeated item; cancelling the last line cancels the order (spec K1, K2)
Done: cancel_items added to orders, 6 tests
Done when:
- [x] D1 ... — `<test command> ...` → passed
- [x] D2 ... — ...
Review: 2 rounds, 3 gaps (2 fixed, 1 wrong finding)
Left: none
```

- If any "done when" item is unchecked, do not report done; name the missing evidence.
- Commit or push only when the user asks.

---

## Common mistakes

- Picking a setup without surveying the scope, then meeting a risky area late in a solo change.
- Not picking at all and always splitting, spending two to three times the cost on small changes.
- Not announcing the setup, so the user cannot tell why a review ran (or did not).
- Deciding something in conversation and not writing it into the spec.
- Giving the implementer a conversation summary instead of the spec, or the reviewer the implementer's explanation.
- Skipping the review because "I read the diff".
- Passing a reviewer's finding to the implementer without checking its evidence.
- Writing "done when" items that no command can decide ("works well").
- Skipping step 9, so a solo change that grew ends without a review.
