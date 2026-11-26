# Picking the setup

The rules for picking a change's setup (solo / with review / split). The **router role** decides; the lead hands it the inputs and follows the result. Like the routing step in RAG that picks a path before answering, this keeps the decision away from the conversation and makes it the same way every time.

The router does not know the conversation. It sees only the inputs the lead gives it and the repository, so the lead's expectations or the mood of the conversation do not pull it toward a lighter setup.

## 1. When to call it

| Point | The lead gives | The router decides |
| --- | --- | --- |
| First call: right after the request | The request brief (section 2) | Solo / spec needed, and a scope note |
| Second call: after the spec is approved | The spec path; whether the session has grown long | With review / split, and work groups |
| Re-check: just before reporting | The starting commit, the current setup, the spec path (if any) | Unchanged / raised to with review |

- If the user chose the setup ("do it yourself", "get it reviewed", "split it"), skip the first and second calls. Always run the re-check.
- If the scope changes a lot during implementation (a module outside "files to change" must change), a re-check may be run then too.

## 2. The request brief (first-call input)

The router does not know the conversation, so the lead writes down what the decision needs. Do not paste what the user said; write behavior statements.

```
Request brief
- Request: cancel part of an item's quantity on an open order. Reason: an order with one item added by mistake is the most common reason to cancel.
- Conditions the user gave: paid orders are not part of this change.
- Decided by the user: none
- Names involved: order cancel, OrderService
- Risks known only from the conversation: orders with coupons are where problems usually show up
```

- "Risks known only from the conversation" are what the code alone cannot show. Leave them out and the router misses them.
- If the result lacks a fact the lead knows, do not edit the result: add the fact to the brief and call again.

## 3. Surveying the scope (router)

### 3-1. What to read

1. The project settings ("Project → Change pipeline" in `AGENTS.md`): setup thresholds, added risky areas, out of scope. Defaults below where missing.
2. Search the code for the names in the request and open their definitions.
3. Follow one step further: who calls that code, who uses the same data (tables, files, state), which tests cover it.
4. If something listed as out of scope would have to change, record that as an unknown.

### 3-2. How to count

- **Source files**: code files expected to change. Do not count tests, docs, or generated files (build output, lock files). Count new files. An import that only changes a name counts as one file.
- **Modules**: as the project settings define them; otherwise one top-level unit of the code (a Python package, a Java domain package, a folder directly under `src/`). Several files in one module count as one module.
- When the estimate is a range (2–4 files), decide on the high end.

### 3-3. Finding risky areas

Search with these cues, then **open the code and confirm the lines that change actually touch that calculation, check, or format**. A word in a name alone does not make it risky.

| Risky area | Cues | Risky / not risky |
| --- | --- | --- |
| Money, payment, settlement | price, amount, total, fee, discount, tax, refund | A formula, rounding, or currency changes / an amount is only displayed |
| Deleting data, stored formats, migration | delete, drop, truncate, migration, schema, ALTER, serialization | Stored values or their format change or go away / only a read filter changes |
| Authentication, permissions, secrets | auth, login, token, session, permission, role, secret, password | Who may do what changes / only a log message changes |
| Interfaces other code relies on | public API routes, functions other modules call, file and message formats | Arguments, results, or formats change / only internals change |
| Concurrency, transactions, retries | lock, transaction, retry, async, queue, job, cron | Ordering, locking, or retries change / one calculation inside changes |

Check the project's added risky areas the same way. Count the brief's "risks known only from the conversation" as risky without confirming.

### 3-4. Unknowns

A choice that neither the request nor the code answers, where the answer changes the result.

- Unknown: "which line shrinks when the item is on two lines" (the code does not decide).
- Not unknown: "is stock released after a cancel" (`release` exists and a full cancel already does it). When the code answers, cite it and move on.

## 4. First-call rules

Take the first that fits, from the top.

| No. | Condition | Setup |
| --- | --- | --- |
| 1-1 | The user chose the setup | As chosen (the router is not called) |
| 1-2 | Source files within the solo threshold (default 1–2), 0 unknowns, 0 risky areas | Solo |
| 1-3 | Everything else | Spec needed |

- A change to docs, comments, or tests only counts as 0 source files; apply 1-2.
- One risky area makes it spec needed even for one file, down to a single rounding line in a money calculation.
- With low confidence (section 7), pick spec needed: redoing a wrong solo costs more than writing a spec.

## 5. Second-call rules

Count again from the approved spec's "files to change" (3-2). Take the first that fits.

| No. | Condition | Setup |
| --- | --- | --- |
| 2-1 | The user chose the setup | As chosen |
| 2-2 | Source files reach the split threshold (default 6), or modules reach it (default 3) | Split |
| 2-3 | Two or more independent work groups | Split |
| 2-4 | The lead says the session has grown long and a fresh start is better | Split |
| 2-5 | Everything else | With review |

**Independent groups** change no file in common, and neither uses a function, data, or format the other creates. If one must wait for the other's result, they are not independent. For a split, return the requirement numbers (R1–R3, ...) of each group.

An unclear request is not a reason to split: the spec has resolved it.

## 6. Re-check rules

Count the changed source files from `git diff --stat <start>` plus uncommitted changes, and look for risky areas again (3-3).

| No. | Current setup | The real change | Result |
| --- | --- | --- | --- |
| 3-1 | Solo | Beyond the solo threshold, or touches a risky area | Raised to with review |
| 3-2 | With review or split | Changes files outside "files to change" | Unchanged; return the list of those files |
| 3-3 | Any | Within its limits | Unchanged |

Never return a lighter setup. Even when the user chose solo, return "raised" if 3-1 applies, and put the reason under "For the lead" as a question for the user.

## 7. Confidence

- **High**: the code that changes was opened and confirmed, and exactly one rule applies.
- **Low**: unsure the search found everything (dynamic calls, code called by string), right at a threshold, or a risky area is borderline.

When low, pick the heavier setup and say in one line why confidence is low. If only the user can settle it, put a question under "For the lead".

## 8. Output

```
Decision: first call | second call | re-check
Setup: solo | spec needed | with review | split | unchanged | raised to with review
Rule: <no.> — <condition>
Scope note (first call only):
- Will change (estimate): <file — what> ... (n source files, m modules)
- Risky areas: <kind — file:line, or "none">
- Unknowns: <choices that change the result, or "none">
Work groups (split only): Group A (R1–R3): <files> / Group B (R4–R5): <files>
Risky areas (second call only): <requirement — kind, or "none">
Files outside "files to change" (re-check only): <list, or "none">
Evidence: <file:line> ...
Confidence: high | low — <why>
For the lead: <questions for the user, or "none">
```

## 9. When the lead gets the result

1. Open a few of the cited lines to confirm them. If one is wrong, note it in the brief and call again.
2. Announce it in one line: `Setup (first call): spec needed — 1-3, money (coupon recalculation), 2 unknowns`.
3. Do not overturn the result yourself. To go lighter, ask the user and follow their choice (1-1, 2-1).
   - If the user chose solo and the re-check raises it (3-1), ask the user with the reason before raising. If they want to finish as is, do so and report "no review (user's choice)".
   - Add the second call's risky areas to the review focus, and for a split to the inputs of the group's implementer.
4. Use the questions under "For the lead" as the first interview questions.

## 10. Examples

| Request | Result | Rule |
| --- | --- | --- |
| Fix a typo in the README heading | Solo | 1-2 (0 source files) |
| Reject creating a user with a blank name | Solo | 1-2 (users, 1 file, no unknowns or risks) |
| Round each line's refund down instead of the total, one function | Spec needed | 1-3 (money) |
| Export user data, format not decided | Spec needed | 1-3 (unknowns: format, columns) |
| Spec lists 2 files in 2 modules | With review | 2-5 |
| Spec lists 8 files; the payment and notification groups share no file | Split | 2-2, groups A and B |
| Started solo; a date label fix spread to 4 files in payment and invoicing | Raised to with review | 3-1 |
