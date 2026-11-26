# Writing the spec

The implementer and the reviewer never hear the conversation; they read only this file. One test applies: **could someone who missed the conversation implement and judge the change from this file alone?** Do not shorten what the conversation settled.

## 1. Location and name

1. If the project settings ("Project → Change pipeline" in `AGENTS.md`) name where specs go, a file-name pattern, or a layout, use them.
2. Otherwise write `docs/specs/<name>.md`, `<name>` being a short kebab-case name (for example `partial-cancel`), starting from `.agents/docs/templates/spec.md`. If that file belongs to another change, pick another name.
3. If the project's layout has no place for a required section, add it at the end. Put the project's "extra spec sections" (for example screen states, API request and response examples) before "Constraints".

## 2. Sections

```markdown
# <Feature> — spec
Status: draft | approved · Date: <YYYY-MM-DD> · Setup: <with review | split>

## Background and goal
## Request and conversation
## Requirements
## Scenarios
## Constraints
## Out of scope
## Files to change
## Done when
## Decisions
## Open questions
```

## 3. How to write each section

**Header**: status stays `draft` until the user approves. Fill in the setup after the second call.

**Background and goal**: one paragraph: what is wrong today, and what is true once this change is done. No implementation details.

**Request and conversation**: the implementer and the reviewer read the conversation here. **Quote; do not summarize.** Do not edit or shorten the user's words; replace only personal data (names, paths, accounts) with sample values.

- Request: every user message that shaped the request, in order.
- Questions and answers (Q1, Q2, ...): the question, the options offered, the answer verbatim, and where it went (R, S, K numbers). When a decision changes, keep the line and add "(changed → Q7)".
- Said in passing: preferences, dislikes, example situations, worries the user raised unasked, quoted, with where each went (or "not used: reason").
- Terms: the user's words next to the code's names where they differ.
- Facts from the survey: code facts a decision relied on, with `file:line`.

**Requirements (R1, R2, ...)**: one observable behavior each, with input, result, and errors, using the names callers see (functions, commands, screens). When a mockup or screen is the source, one line per label, column, field, button, and state. Never renumber; mark dropped ones "(dropped: reason)".

**Scenarios (S1, S2, ...)**: `state → action → result`, at least one per requirement, covering normal (the most common use), edge (zero, empty, maximum, duplicates, the same instant, exactly the threshold), and error (invalid input, a missing target, a forbidden state) cases. For errors, say whether **nothing changes**. Tag each with its requirements.

**Constraints**: public interfaces that must not change, the project rules that apply (**copied in**), limits on performance, security, compatibility.

**Out of scope**: what this change deliberately does not do, so the reviewer does not report it as missing.

**Files to change**: one line per file, `<path> — <what>`, tests marked `(tests)`. End with `n source files, m modules` (the second call uses it). If the work can be split, list groups, `Group A (R1–R3): ...`; groups never touch the same file.

**Done when (D1, D2, ...)**: one check each, decidable by a command or an observation, tagged with requirements and scenarios; every requirement and scenario is covered. The last item is the project's full test and lint command.

**Decisions (K1, K2, ...)**: what was settled, why, and why other options were dropped, with the question number behind it.

**Open questions**: none before approval; otherwise go back to the interview.

## 4. Good and bad sentences

| Bad | Why | Good |
| --- | --- | --- |
| Partial cancellation is supported | Says nothing about what happens | R1: `cancel_items(order_id, sku, qty)` lowers that item's line by qty and releases qty of reserved stock |
| Errors are handled properly | Cannot be decided | R4: qty of 0 or less, or above the line's quantity, is rejected as invalid input; order and stock stay unchanged |
| The user does not want a confirmation dialog | A summary loses the reason and the scope | Said in passing: "Cancel should apply at once; another confirm dialog annoys the customer" → out of scope (for the screen work) |
| It works | Cannot be a "done when" item | D3: `<test command> <order tests>` passes |

## 5. Checklist

- [ ] Someone who missed the conversation could implement from this file alone.
- [ ] Every user message since the request has a place in the spec; answers and things said in passing are quoted.
- [ ] Every requirement has scenarios, with normal, edge, and error ones; every error scenario says whether anything changes.
- [ ] The project rules that apply are in the constraints; the project's extra spec sections are present.
- [ ] "Files to change" ends with the file and module totals.
- [ ] Every requirement and scenario is covered by a "done when" item, each decidable by a command or an observation.
- [ ] No requirement forces an implementation choice; if one is needed, it is a decision with its reason.
- [ ] There are no open questions.

## 6. Full example

The spec of one sample project. Read its file names and `<test command>` as your project's.

```markdown
# Partial order cancellation — spec
Status: approved · Date: 2026-11-26 · Setup: with review

## Background and goal
Today only a whole order can be cancelled, so removing one item means cancelling and re-creating the order.
After this change, part of an item's quantity can be cancelled on an open order.

## Request and conversation
### Request
- "Don't cancel the whole order, let me take out just a few items. Customers calling because they added one item by mistake is the most common case."

### Questions and answers
- Q1: An order holds the same item on two lines. Which line shrinks? Options: the first line first (recommended) / in proportion / reject
  Answer: "First line first. Those orders hardly happen." → K1
- Q2: What happens to the order when its last line goes? Options: cancel the order (recommended) / reject / keep an empty order
  Answer: "No empty orders left behind. Cancel it." → R3, K2
- Q3: Paid orders too? Options: open orders only (recommended) / partial refunds as well
  Answer: "Refunds next time. Open orders only for now." → R4, out of scope

### Said in passing
- "Cancel should apply at once; another confirm dialog annoys the customer" → out of scope (this change has no screen)
- "Orders with coupons are always the trouble" → S2, constraints (money rule)

### Terms
- "take out a few items" → `OrderService.cancel_items`

### Facts from the survey
- Creating an order does not merge equal items into one line (orders.py:28)
- `inventory.release(sku, qty)` already exists (inventory.py:41)

## Requirements
- R1: `OrderService.cancel_items(order_id, sku, qty)` lowers that item's line by qty and releases qty of reserved stock.
- R2: Subtotal, discount, and total are recalculated. Below the coupon's minimum the discount is 0.
- R3: A line that reaches 0 is removed. When no line is left, the order's status becomes `cancelled`.
- R4: qty of 0 or less, qty above the line, or an item not in the order is rejected as invalid input. An order that is not open is rejected as an order error.
- R5: It returns the changed order (a copy).

## Scenarios
- S1 (normal): A ×3, B ×1 → cancel A ×2 → A ×1, B ×1; A has 1 reserved; total 3,500 (R1, R2, R5)
- S2 (edge): coupon TEN (10%, minimum 3,000) on A ×2, B ×1 (4,500) → cancel B ×1 → total 2,000, discount 0 (R2)
- S3 (edge): A ×2 → cancel A ×1 twice → status cancelled, event order.cancelled exactly once (R3)
- S4 (error): A ×2 → cancel A ×3 / ×0 / ×-1 / C ×1 → invalid input; order and stock unchanged (R4)
- S5 (error): a paid order → cancel → order error, unchanged (R4)

## Constraints
- The arguments and results of create_order, pay, cancel, get_order, list_orders do not change.
- Project rule: a status change calls `events.publish("order.<new status>", {"order_id": id})` once.
- Project rule: money is whole units; discounts round down.

## Out of scope
- Partial refunds of paid orders (Q3)
- Merging lines of the same item
- A cancel screen and its confirmation dialog

## Files to change
- orders.py — add cancel_items
- test_orders.py — new tests (tests)
- Total: 1 source file, 1 module (inventory only gets its existing release called)

## Done when
- [ ] D1 S1–S2 pass — `<test command> <partial cancel tests>` (R1, R2, R5)
- [ ] D2 S3: order.cancelled published exactly once (R3, constraints)
- [ ] D3 S4–S5: rejected, order and stock unchanged (R4)
- [ ] D4 existing checks — `<test command>` all pass

## Decisions
- K1: for an item on two lines, the first line shrinks first (Q1). Such orders are rare (orders.py:28); shrinking in proportion was dropped because it leaves fractions of money.
- K2: cancelling the last line cancels the order rather than failing (Q2), so no empty open order can exist.

## Open questions
- None
```
