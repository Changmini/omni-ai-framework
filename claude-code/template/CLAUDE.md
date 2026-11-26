# <Project name>

<!--
Loaded into every session. Keep it under 200 lines.
For each line ask: "Would removing this cause Claude to make mistakes?" If not, cut it.
Include: commands Claude can't guess, non-default style rules, test instructions,
repo etiquette, project-specific architecture decisions, env quirks, gotchas.
Exclude: anything readable from the code, standard conventions, long tutorials,
file-by-file descriptions, frequently changing information.
Put rules for part of the codebase in .claude/rules/ with `paths:` frontmatter,
and occasional workflows in .claude/skills/.
If this repo already has AGENTS.md, replace this file's body with: @AGENTS.md
-->

## Commands

- Install: `<command>`
- Test (single file): `<command> <path>`
- Test (all): `<command>`
- Lint / format: `<command>`
- Type check / build: `<command>`

## Code style

- <only rules that differ from the language's defaults>

## Workflow

- Run the narrowest relevant tests and the type check after a series of changes.
- Branch naming: `<convention>`; commit style: `<convention>`.

## Architecture

- <decisions Claude can't infer from the code, e.g. "all DB access goes through src/db/repo.ts">

## Gotchas

- <non-obvious behaviors, required env vars, flaky areas>

## Agent pipeline

<!-- Read by the omni-pipeline and omni-jira agents. Delete rows that do not apply; agents then fall back to defaults. -->

- Specs: `<docs/specs/>` (file name `YYYY-MM-DD-<topic>-design.md`); without this row the lead writes `docs/specs/<name>.md`
- Spec template: `<docs/specs/TEMPLATE.md>` (must leave room for requirements, constraints and done-when)
- Task list (single source of truth): `<docs/tasks.md>`
- Test command, backend: `<command> <test nodes>`
- Test command, frontend: `<command> <test file>`
- Type check (ask before running): `<command>`
- Structure document (layout and boundary rules): `<docs/STRUCTURE.md>`
- Out of scope (never modify): `<services or directories>`
- Setup thresholds: solo up to `<2>` source files; split from `<6>` source files or `<3>` modules
- Risky areas (added to the common list): `<paths or topics>`
- Always ask in the interview: `<questions>`
- Extra spec sections: `<e.g. Screen states, API request/response examples>`
- Extra review focus: `<e.g. accessibility, query count>`
