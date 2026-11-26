# <Feature name> — spec

Status: draft | approved · Date: <YYYY-MM-DD> · Setup: <with review | split>

<!-- How to fill each section, with good and bad sentences and a full example: .agents/skills/develop/spec-guide.md -->

## Background and goal
<One paragraph: what is wrong today, and what is true once this change is done. No implementation details.>

## Request and clarifications
<Behavior statements, not the user's words; keep every condition, reason and example, drop profanity, small talk and personal data. Request: what and why. Clarified: Q#, what was settled, why, options dropped, where it went. Added requirements: statement, reason, where it went. Terms. Facts from the survey with file:line.>
- Request: ...
- Q1 ... → ... Reason: ... → R1

## Requirements
<One observable behavior each: input, result, errors. Never renumber; mark dropped ones "(dropped: reason)".>
- R1: ...

## Scenarios
<state → action → result, tagged with requirements. Normal, edge (zero, empty, maximum, duplicate, same instant, exact threshold) and error cases; say whether anything changes on an error.>
- S1 (normal): ... (R1)

## Constraints
<Interfaces that must not change, the project rules that apply (copied in), limits on performance, security, compatibility.>
- ...

## Out of scope
- ...

## Files to change
<One line per file: path — what. Tests marked (tests). Groups for separate implementers if the work splits.>
- ...
- Total: <n> source files, <m> modules

## Done when
<One check each, decidable by a command or an observation, tagged with requirements and scenarios. The last item is the project's full test command.>
- [ ] D1 ...

## Decisions
<What was settled, why, why other options were dropped, and the question behind it.>
- K1: ...

## Open questions
- None
