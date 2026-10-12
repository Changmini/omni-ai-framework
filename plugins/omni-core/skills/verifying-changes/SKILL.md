---
name: verifying-changes
description: Discovers and runs a project's own checks (tests, type checks, linters, builds) and reports the evidence. Use after editing code, before claiming a task is done, or when the user asks to verify, test, or validate a change.
---

# Verifying changes

Claims of success need evidence: the command that ran and what it returned.

## 1. Discover the checks

Look in this order and use the first that defines them:

1. `CLAUDE.md` / `AGENTS.md` — documented build, test, and lint commands
2. Task runners: `package.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`, `pyproject.toml` (`[tool.*]`), `Cargo.toml`, `go.mod`
3. CI config: `.github/workflows/*.yml`, `.gitlab-ci.yml` — mirror what CI runs

## 2. Run the narrowest useful checks first

1. Tests for the changed files or package
2. Type checker / compiler
3. Linter and formatter (check mode)
4. Full suite only when the change is cross-cutting or the user asks

## 3. Iterate

- On failure: read the error, fix the root cause, re-run the same check.
- Do not skip, disable, or weaken a test to make it pass.
- If a failure is unrelated to the change (also fails on the base branch), say so explicitly with the evidence.

## 4. Report

```
Verification:
- <command> → <pass/fail, key output line>
- <command> → <pass/fail, key output line>
Not verified: <anything you could not check, and why>
```
