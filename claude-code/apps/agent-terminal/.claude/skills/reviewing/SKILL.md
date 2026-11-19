---
name: reviewing
description: Reviews changes to the agent-terminal app the way its owner wants - only problems that would get in the way of real use, reported briefly in Korean with the conclusion first, and no new rounds for minor issues. Use when asked for a 코드 검토 or code review of claude-code/apps/agent-terminal, or before shipping a change there.
---

# Reviewing agent-terminal changes

The owner wants a short answer to "is anything going to bite me?", not a list. Each extra round of minor fixes costs more than the issue: report only what gets in the way of using the app.

## Scope

The diff since the last merged pull request (`git log --merges -1` gives its commit), plus the code it touches. Read the enclosing functions, not only the changed lines.

## What counts (report)

- Crash, hang, a loop that spins (reloading 50 times a second, a timer that never stops)
- A feature that does not work, or works on the wrong thing (another terminal's or project's state)
- Data loss: files changed or deleted wrongly, processes of other terminals ended, input lost
- Security: the preview's isolation bypassed, reading outside the project or `private/`, personal data in files or screenshots
- Noticeable CPU or memory use, especially while idle
- A regression of something that worked before

## What does not count (leave out)

Style, naming, refactors, comments, "could be cleaner", rare edge cases that harm nobody, test gaps without a concrete bug, behaviour the owner already chose. If you are unsure whether it bites, try it in the running app (verifying-app skill) instead of listing it.

## Where this app has broken before

Check these first; each caused a real bug:

- **Several terminals**: state keyed by terminal id or URL that is reused when the terminal moves to another project; an action on one terminal reaching the others (a shared tmux server, process reaping).
- **Windows + WSL**: ConPTY drops OSC sequences; input typed before WSL's shell exists is lost; `wsl.exe` prints its own warnings first; paths go through `\\wsl.localhost`.
- **Preview frame**: navigation and nested frames (reload loops), focus taken from the terminal, scripts that animate forever.
- **Keyboard**: capture-phase `Esc` handler order, Hangul composition (`isComposing`, the Enter that ends a syllable), shortcuts reaching xterm.
- **Timers and polling**: intervals that keep running when hidden, idle repaint (cursor blink), work per keystroke.
- **Processes**: what closing a terminal or quitting ends, and what it must leave alone.

## Report

In Korean, conclusion first:

- Nothing found: one line, "작업에 지장을 줄 문제는 없습니다."
- Otherwise a numbered list, each item two lines at most: what the user would see, when it happens, and the fix in a few words.

If a findings tool is in use, report only these items through it. Then ask whether to fix them, unless the user already said to fix what is found; after fixing, do not start another review round unless asked.
