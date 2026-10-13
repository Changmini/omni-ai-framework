---
name: verifying-changes
description: Discovers and runs the project's own checks (tests, type checks, linters, builds) and reports the evidence. Use after editing code, before saying a task is done, or when the user asks to test or verify.
---

# Verifying changes

A claim of success needs evidence: the command that ran and what it returned.

## 1. Find the checks

Use the first source that defines them:

1. The verify command in `AGENTS.md` → "Project → Commands"
2. Task runners: `package.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`, `pyproject.toml`, `Cargo.toml`, `go.mod`
3. Continuous integration config (for example `.github/workflows/*.yml`, `.gitlab-ci.yml`): run what it runs

## 2. Run the narrowest useful checks first

1. Tests for the changed files or package
2. Type checker or compiler
3. Linter and formatter in check mode
4. The full verify command before you report the task as done

## 3. Iterate

- On failure: read the error, fix the root cause, run the same check again.
- Never skip, disable, or weaken a test to make it pass.
- If a failure also happens without your change (for example on the base branch), say so and show the evidence.

## 4. Report

```
Verification:
- <command> → <pass | fail>, <key output line>
Not verified: <what you could not check, and why>
```
