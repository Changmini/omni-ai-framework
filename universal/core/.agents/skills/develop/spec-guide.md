# Writing the spec

The implementer and the reviewer never hear the conversation; they read only this file. One test applies: **could someone who missed the conversation implement and judge the change from this file alone?** Do not shorten what the conversation settled.

## 1. Rules to follow and where the spec goes

The rules of the project being worked on come first. Look in this order and follow the first you find. Do not search the whole repository; look only in these places.

1. **Project settings**: "Project → Change pipeline" in `AGENTS.md`. Use the spec location, file name, and layout it names.
2. **Rule files and the documents they point to**: rules that speak directly about specs, design documents, or writing documents (location, name, layout, style, language). The file names depend on the agents and tools the project uses. For example:
   - Shared by several agents: `AGENTS.md`, `AGENTS.override.md`, `AGENTS.md` in a subfolder
   - Per tool: a file named after the tool at the root (`<TOOL>.md`), `.github/<tool>-instructions.md`, `.github/instructions/*.instructions.md`, a tool's rules folder (`.<tool>/rules/`) or rules file (`.<tool>rules`), `CONVENTIONS.md`
   - For people: `CONTRIBUTING.md` (at the root, in `docs/`, or in `.github/`), `docs/README.md`, `docs/STYLE.md`, `STYLEGUIDE.md`, `docs/CONVENTIONS.md`

   The names are examples. A file not listed that tells agents or people how to work in this project counts the same: read it.
3. **Existing documents**: if specs or design documents already sit in a folder, follow their file names and section layout. Common places:
   - `docs/specs/`, `docs/spec/`, `specs/`, `spec/`
   - `docs/design/`, `docs/designs/`, `design/`, `docs/architecture/`
   - `docs/rfcs/`, `rfcs/`, `docs/proposals/`
   - `docs/adr/`, `docs/decisions/`: decision records. Do not use them as a spec layout; borrow only how they write decisions and reasons.
   - Template files: `TEMPLATE.md`, `_template.md`, `0000-template.md`, `docs/templates/`

   If the documents in a folder differ in layout, follow the most recent. If it is still unclear, ask the user.
4. **Otherwise** write `docs/specs/<name>.md` from `.agents/docs/templates/spec.md`, with the sections in "2. Sections". `<name>` is a short kebab-case name (for example `partial-cancel`); if that file belongs to another change, pick another name.

**What to follow and what to keep**

- Follow the project's: location, file name, section order and headings, style, language.
- Keep in any layout: request and clarifications, requirements, scenarios, constraints, out of scope, files to change, done when, decisions. Add any the project's layout has no place for at the end.
- Put the project's "extra spec sections" (for example screen states, API request and response examples) before "Constraints".
- Propose the rules found in 2 and 3 for the project settings ("Propose settings", step 10), so the next change reads them in 1.

## 2. Sections

```markdown
# <Feature> — spec
Status: draft | approved · Date: <YYYY-MM-DD> · Setup: <with review | split>

## Background and goal
## Request and clarifications
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

**Request and clarifications**: the implementer and the reviewer read this instead of the conversation. Do not copy the conversation: **rewrite it as spec statements, without dropping anything development needs.**

- Turn what the user said into behavior statements: what happens, when, and how. Example: "Clicking OK should just close the modal" → the selection dialog closes after OK or Cancel.
- Keep: conditions, numbers, example situations, reasons, what was chosen and what was dropped.
- Leave out: profanity, emotion, tone, small talk, anything unrelated to the change, personal data.
- Copy wording exactly only when the wording is the result: screen text, error messages, example data the user gave.

Groups:

- Request: what and why.
- Clarified (Q1, Q2, ...): what was asked, what was settled (a behavior statement), why, the options dropped, and where it went (R, S, K numbers). When it changes, keep the line and add "(changed → Q7)".
- Added requirements: requirements and preferences raised unasked, as behavior statements with reasons, and where each went (or "not used: reason").
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
| The user does not want a confirmation dialog | Blurred: the reason and the condition are lost | Added requirement: a cancel applies at once with no confirmation dialog. Reason: one more prompt is a burden for the customer |
| "Clicking OK should just close the modal" | Copies the user's words | The selection dialog closes after OK or Cancel |
| It works | Cannot be a "done when" item | D3: `<test command> <order tests>` passes |

## 5. Checklist

- [ ] Someone who missed the conversation could implement from this file alone.
- [ ] Everything said about the change since the request has a place in the spec, with its conditions, reasons, and examples.
- [ ] Nothing the user said is copied word for word (screen text, error messages, example data aside). No profanity, small talk, or personal data.
- [ ] Every requirement has scenarios, with normal, edge, and error ones; every error scenario says whether anything changes.
- [ ] The project's document rules (location, name, layout, style, language) are followed, and no required section is missing.
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

## Request and clarifications
### Request
- Cancel part of an item's quantity on an open order. Reason: an order with one item added by mistake is the most common reason to cancel.

### Clarified
- Q1 Which line shrinks when an item is on two lines → the first line shrinks first. Reason: such orders are rare. Dropped: in proportion, reject → K1
- Q2 An order whose last line goes → the order is cancelled. Reason: no empty open order remains. Dropped: reject, keep it empty → R3, K2
- Q3 Paid orders → not partially cancellable; partial refunds come in a later change → R4, out of scope

### Added requirements
- A cancel applies at once with no confirmation dialog. Reason: one more prompt is a burden for the customer → out of scope (this change has no screen)
- Totals of orders with coupons must be right. Reason: that is where problems show up most → S2, constraints (money rule)

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
