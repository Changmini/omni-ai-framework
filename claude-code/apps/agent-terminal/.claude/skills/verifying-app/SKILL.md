---
name: verifying-app
description: Runs the real agent-terminal Electron app in a sample environment and checks a change there - drives it over the debugging port, reproduces bugs, measures CPU and memory, takes screenshots safe to share. Use after changing claude-code/apps/agent-terminal, or when asked to 실제 앱에서 확인, 재현, 스크린샷, 자원(CPU·메모리) 확인 for it.
---

# Verifying the agent-terminal app

Unit tests miss what broke most often here: state shared between terminals, focus, timing (WSL starting silently, tmux), the sandboxed preview frame, idle CPU. Check those in the running app, in the sample environment only.

## Workflow

```
- [ ] 1. Sample environment ready   scripts/sample-env.sh
- [ ] 2. App started                scripts/launch.sh
- [ ] 3. Scenario driven, state read back (numbers, not impressions)
- [ ] 4. Screenshots opened and checked (if any are shared)
- [ ] 5. Environment restored, app stopped
```

Scripts live in `scripts/` next to this file; run them, don't read them first.

1. **Sample environment**: `scripts/sample-env.sh` creates `/home/user/sample-home` (prompt `user@sample-host`) and the git project `/home/user/sample-app` on `feature/sample`. Never use the real home, real projects or real logs as test data.
2. **Start**: `scripts/launch.sh` (stops a running copy, waits for port 9333). `INSPECT=1 scripts/launch.sh` also opens the main process to a debugger on 9229 (heap snapshots). `EXTRA_ENV="SHELL=/bin/sh" scripts/launch.sh` starts terminals with another shell.
3. **Drive and read back**: `node scripts/cdp.js my-check.js` runs a script in the main window (see the header of `cdp.js` for `ev`, `send`, `key`, `type`). Playwright `chromium.connectOverCDP('http://127.0.0.1:9333')` also works, except on pages with nested cross-origin frames, where it crashes: use `cdp.js` there. Read results from the page (`agents`, `activeId`, element text, `term.buffer`), not from screenshots. Recipes for recurring scenarios: [scenarios.md](scenarios.md).
4. **Screenshots**: take them only in the sample environment. Open every image (Read) before sending or committing and check the prompt, window title, paths, branch, tab names, terminal names and shortcuts list show sample values only; if anything else shows, retake it. The personal-data check cannot read images.
5. **Clean up**: `scripts/sample-env.sh restore` (puts `~/.bashrc` back, removes the fake `wsl`, stops tmux servers) and `scripts/launch.sh stop`. Remove test shortcuts you added to `localStorage`.

## Measuring resources

`node scripts/cpu.js 30` prints CPU seconds and memory per process type for 30 s. Measure a state, change one thing, measure again, and report both numbers. For idle checks, first stop the cursor blinking or wait 30 s (it rests by itself); otherwise its repaint dominates. This environment renders without a GPU, so absolute numbers are higher than on a user's machine; compare before/after, not against a fixed limit.

## Reporting

Say what was checked, the numbers, and what could not be checked here (Windows + WSL, macOS, a real IME, GPU rendering).
