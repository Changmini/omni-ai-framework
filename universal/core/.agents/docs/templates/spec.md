# <Feature name> — spec

Status: draft | approved · Date: <YYYY-MM-DD> · Setup: <with review | split>

<!-- How to fill each section, with good and bad sentences and a full example: .agents/skills/leading-changes/spec-guide.md -->

## Background and goal
<One paragraph: what is wrong today, and what is true once this change is done. No implementation details.>

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
<What was settled with the user or by the survey, and why; why other options were dropped.>
- K1: ...

## Open questions
- None
