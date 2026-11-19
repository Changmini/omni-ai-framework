---
name: shipping
description: Ships a finished agent-terminal change in one pass - syncs the branch, runs the repository's six checks, re-reads the staged diff, commits, pushes, opens a Korean pull request, merges it and syncs again, then reports briefly in Korean. Use when the user asks to commit, open a PR, merge, ship or wrap up work on claude-code/apps/agent-terminal.
disable-model-invocation: true
---

# Shipping an agent-terminal change

The owner reviews results, not process: run every step, stop only when a check fails or something below says to ask.

## Branches

- **Work branch**: the branch this session was told to develop on.
- **Base branch**: the branch the user merges into. Use the one named in the conversation or the last merged pull request; ask once if neither says.
- Never force-push or rebase a pushed branch. If the base moved ahead, fast-forward the work branch to it before committing.

## Checklist

Copy this into your progress and tick each line:

```
- [ ] 1. Sync with the base branch
- [ ] 2. Six checks pass
- [ ] 3. Staged diff re-read
- [ ] 4. Commit and push
- [ ] 5. Pull request opened
- [ ] 6. Merged and synced
- [ ] 7. Reported in Korean
```

### 1. Sync

```bash
git fetch origin <base> && git merge --ff-only origin/<base>
```

Run it before staging; if it is not a fast-forward, stop and tell the user.

### 2. Checks (from the repository root)

```bash
(cd claude-code/apps/agent-terminal && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)")
python3 .github/scripts/check-personal-data.py
python3 universal/tools/omni.py validate universal/core
universal/tools/tests/run.sh
(cd claude-code && python3 scripts/validate.py && tests/test-hooks.sh && tests/test-jira-guard.sh)
```

All must pass and the personal-data check must report 0 findings. A failing test is fixed, never skipped. The personal-data check cannot read images: open every screenshot you are about to share or commit and confirm it shows only sample values (`user`, `sample-host`, `/home/user/sample-app`, `feature/sample`).

### 3. Re-read the staged diff

```bash
git add -A claude-code/apps/agent-terminal
git diff --cached
```

Read it as a reviewer: no debugging leftovers, no personal data (real names, OS user names, home paths, emails, account ids, company or project names, issue keys), README updated when behaviour the user sees changed.

### 4. Commit and push

- Title in Korean: `agent-terminal: <무엇을 바꿨는지>`. Body: why, as short bullets.
- End the message with the attribution lines the session's reminder gives; never put a model name in the commit.

```bash
git commit -F - <<'EOF'
...
EOF
git push -u origin <work-branch>   # retry up to 4 times on network errors
```

### 5. Pull request

Create it with the GitHub tools (`owner/repo` from `git remote get-url origin`), base = base branch, head = work branch. Body in Korean with these sections, and the attribution footer from the session's reminder:

```markdown
## 요약
(한두 문장: 무엇을 왜)

## 고친 것 / 만든 것
- 사용자가 보는 동작 위주로

## 확인
- `npm test` N개 통과 (추가한 테스트)
- 실제 Electron(예시 환경)에서 확인한 것과 수치
- 개인정보 검사 0건, universal 테스트, validate·훅 테스트 통과
- 확인하지 못한 것: (Windows + WSL, macOS 등)
```

### 6. Merge and sync

```bash
git rev-parse HEAD   # the full 40-character sha
```

Merge with `merge_method: merge` and that sha as `expectedHeadSha`. Then:

```bash
git fetch origin <base> && git merge --ff-only origin/<base> && git push -u origin <work-branch>
```

### 7. Report

In Korean, conclusion first, short: the PR as a markdown link with the full URL, what changed for the user, anything not verified. No process narration.
