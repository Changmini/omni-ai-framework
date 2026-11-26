# Writing the spec

The implementer and the reviewer never hear the conversation; they read only this file. Write it so that someone who missed the conversation can implement and judge the change from it alone.

Contents

1. Location and name
2. Sections
3. How to write each section
4. Good and bad sentences
5. Checklist
6. Full example

## 1. Location and name

1. **Project rules come first.** If the "Project" section of `AGENTS.md`, or a rules or docs file it points to, names where specs go, a file-name pattern, or a layout, use them.
2. **Otherwise** write `docs/specs/<name>.md`, `<name>` being a short kebab-case name for the change (for example `partial-cancel`), starting from `.agents/docs/templates/spec.md`. If that file already belongs to another change, pick another name.
3. If the project's layout has no place for a required section (requirements, scenarios, constraints, out of scope, files to change, done when, decisions), add it at the end.

## 2. Sections

```markdown
# <Feature> — spec
Status: draft | approved · Date: <YYYY-MM-DD> · Setup: <with review | split>

## Background and goal
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

### Header

- Status stays `draft` until the user approves; then `approved` with the date.
- Fill in the setup after the second call (step 4).

### Background and goal

One paragraph: what is wrong today, and what is true once this change is done. No implementation details.

### Requirements (R1, R2, ...)

- One observable behavior per requirement, stated as a fact ("... does ...").
- State the input, the result, and the errors, using the names callers see (functions, commands, screens).
- Never renumber. When a requirement is dropped, keep the line as "(dropped: reason)": the implementer and the reviewer refer to the numbers.

### Scenarios (S1, S2, ...)

The requirements as concrete situations: `state → action → result`. At least one per requirement, and all three kinds:

- **Normal**: the most common use.
- **Edge**: zero, empty, maximum, the same value twice, the same instant, exactly the threshold.
- **Error**: invalid input, a missing target, a forbidden state, and whether **nothing changes** when it fails.

Tag each scenario with the requirements it covers.

### Constraints

What must not change and the rules to keep:

- Existing public interfaces (function arguments and results, APIs, file and message formats)
- The project rules that apply to this change, **copied in** (for example "a status change publishes one event", "money is whole units"), so the implementer sees them even without reading the rules file
- Limits on performance, security, compatibility

### Out of scope

What this change deliberately does not do, so the reviewer does not report it as missing.

### Files to change

- One line per file: `<path> — <what: new / add a function / change>`. Include test files, marked `(tests)`.
- End with a total: `n source files, m modules`. The second call (with review or split) is decided from this line.
- If the work can be split between implementers, list it in groups: `Group A (R1–R3): ...`, `Group B (R4–R5): ...`. Groups never touch the same file.

### Done when (D1, D2, ...)

- One check per checkbox, decidable by a command or an observation.
- Tag each with its requirements and scenarios. Every requirement and scenario must be covered by some item.
- The last item is the project's full test and lint command.
- This section tells the implementer when to stop and the reviewer what to judge by.

### Decisions (K1, K2, ...)

What the interview and the survey settled, and why, including why other options were dropped, so the reviewer does not have to ask "why this way?".

### Open questions

Must be **none** before approval. If any remain, go back to the interview instead of asking for approval.

## 4. Good and bad sentences

| Bad | Why | Good |
| --- | --- | --- |
| Partial cancellation is supported | Says nothing about what happens | R1: `cancel_items(order_id, sku, qty)` lowers that item's line by qty and releases qty of reserved stock |
| Errors are handled properly | Cannot be decided | R4: qty of 0 or less, or above the line's quantity, is rejected as invalid input, and the order and stock stay unchanged |
| It must be fast | No measure | Constraint: one `page_orders` call over 1,000 orders takes under 0.1 s (test "page performance") |
| It works | Cannot be a "done when" item | D3: `<test command> <order tests>` passes |
| Coupons are taken into account | How? | S3: an order with coupon TEN (minimum 3,000) drops to 2,000 → no discount, total 2,000 (R2) |

## 5. Checklist

Go through it before showing the spec. Fix every "no".

- [ ] Someone who missed the conversation could implement from this file alone.
- [ ] Every requirement has scenarios, and there are normal, edge, and error ones.
- [ ] Every error scenario says whether anything changes.
- [ ] The project rules that apply are copied into the constraints.
- [ ] "Files to change" ends with the file and module totals.
- [ ] Every requirement and scenario is covered by a "done when" item, and every item is decidable by a command or an observation.
- [ ] Everything decided in conversation is in "Decisions".
- [ ] There are no open questions.
- [ ] No requirement forces an implementation choice (a data structure, an algorithm); if one is needed, it is a decision with its reason.

## 6. Full example

The spec of one sample project. Read its file names and `<test command>` as your project's (for example `python3 -m unittest`, `./gradlew test`).

```markdown
# Partial order cancellation — spec
Status: approved · Date: 2026-11-26 · Setup: with review

## Background and goal
Today only a whole order can be cancelled, so removing one item means cancelling and re-creating the order.
After this change, part of an item's quantity can be cancelled on an open order.

## Requirements
- R1: `OrderService.cancel_items(order_id, sku, qty)` lowers that item's line by qty and releases qty of reserved stock.
- R2: Subtotal, discount, and total are recalculated. Below the coupon's minimum the discount is 0.
- R3: A line that reaches 0 is removed. When no line is left, the order's status becomes `cancelled`.
- R4: qty of 0 or less, qty above the line, or an item not in the order is rejected as invalid input. An order that is not open is rejected as an order error.
- R5: It returns the changed order (a copy).

## Scenarios
- S1 (normal): A ×3, B ×1 → cancel A ×2 → A ×1, B ×1; A has 1 reserved; total 3,500 (R1, R2, R5)
- S2 (edge): coupon TEN (10%, minimum 3,000) on A ×2, B ×1 (4,500) → cancel B ×1 → total 2,000, discount 0 (R2)
- S3 (edge): A ×1, B ×1 → cancel B ×1 → one line left, A (R3)
- S4 (edge): A ×2 → cancel A ×1 twice → status cancelled, event order.cancelled exactly once (R3)
- S5 (error): A ×2 → cancel A ×3 / ×0 / ×-1 / C ×1 → invalid input; order and stock unchanged (R4)
- S6 (error): a paid order → cancel → order error (R4)

## Constraints
- The arguments and results of create_order, pay, cancel, get_order, list_orders do not change.
- Project rule: a status change calls `events.publish("order.<new status>", {"order_id": id})` once.
- Project rule: money is whole units; discounts round down.

## Out of scope
- Partial refunds of paid orders
- Merging lines of the same item

## Files to change
- orders.py — add cancel_items
- test_orders.py — new tests (tests)
- Total: 1 source file, 1 module (inventory only gets its existing release called)

## Done when
- [ ] D1 S1–S3 pass — `<test command> <partial cancel tests>` (R1, R2, R3, R5)
- [ ] D2 S4: order.cancelled published exactly once (R3, constraints)
- [ ] D3 S5–S6: rejected, order and stock unchanged (R4)
- [ ] D4 existing checks — `<test command>` all pass

## Decisions
- K1: for an item on two lines, the first line shrinks first. Creating an order does not merge equal items today, so this is rare; the user chose it.
- K2: cancelling the last line cancels the order rather than failing, so no empty open order can exist.

## Open questions
- None
```
