# Scenario recipes

Snippets for `node scripts/cdp.js <file>`: each is a script body (top-level `await` works).

## Contents

- Typing into a terminal, opening and closing terminals
- Simulating a Claude hook event
- HTML preview
- File viewer and file tab
- Shortcuts (바로가기) and a slow WSL start
- Shared tmux session
- Leftover processes after closing a terminal
- Timing a sequence

## Typing into a terminal, opening and closing terminals

```js
await ev(`agentApi.write(activeId, 'cd /home/user/sample-app && clear\\r'); 1`);
await key('KeyT', { ctrl: true, shift: true });       // new terminal (Ctrl+Shift+T)
const ids = await ev(`agentApi.list().then((l) => l.map((x) => x.id))`);
await ev(`agentApi.kill('${ids.at(-1)}').then(() => 1)`); // close one (the sidebar ✕)
```

Read a terminal's text: `agents.get(id).term.buffer.active` → `getLine(y).translateToString(true)`.

## Simulating a Claude hook event

Type into an app terminal (it has the token and URL in its environment):

```bash
curl -s -o /dev/null -X POST -H "X-Omni-Token: $OMNI_HOOK_TOKEN" -H "X-Omni-Terminal: $OMNI_TERMINAL_ID" \
  -H 'Content-Type: application/json' \
  --data '{"hook_event_name":"PostToolUse","tool_name":"Write","session_id":"s1","tool_use_id":"w1","tool_input":{"file_path":"/home/user/sample-app/private/index.html"}}' \
  "${OMNI_CWD_URL%/cwd}/hook"
```

## HTML preview

- Open it: `document.querySelector('#preview-toggle').click()`; frame src: `.preview-frame` `src`; head text: `.preview-mark`.
- The drawing runs in its own process: list it with `fetch('http://127.0.0.1:9333/json/list')` (type `iframe`), or evaluate in it with Playwright's `page.frames()` when it has no nested frames.
- Test pages go in a sample project's `private/index.html` (for example `/home/user/sample-grad`, made with `git init`).

## File viewer and file tab

- Files tab: `.inspector-head .tab[data-tab="files"]`; name/content mode buttons `#search-mode button[data-mode="name"|"text"]`; search box `#tree-search`; results `#tree-results .tree-result` (content hits `.text-hit`).
- Viewer: `#viewer`, body `#viewer-body`, find bar `#viewer-find` (input `#viewer-find-input`, count `#viewer-find-count`).

## Shortcuts (바로가기) and a slow WSL start

Add a shortcut, then reload the page:

```js
await ev(`localStorage.setItem('shortcuts', JSON.stringify([{ id: 's1', name: 'WSL', command: 'wsl -d Ubuntu-24.04\\ncd /home/user/sample-app && echo SHORTCUT-OK', newTerminal: true }])); location.reload(); 1`);
```

A fake `wsl` that starts silently (Linux stands in for Windows), put first on the sample PATH:

```bash
mkdir -p /home/user/sample-home/bin
cat > /home/user/sample-home/bin/wsl <<'SH'
#!/bin/sh
sleep 4
echo "[sample wsl ready]"
exec env WSL_DISTRO_NAME="$2" bash --rcfile /path/to/claude-code/apps/agent-terminal/src/shell-init/omni.bash -i
SH
chmod +x /home/user/sample-home/bin/wsl
echo 'case ":$PATH:" in *":$HOME/bin:"*) ;; *) PATH="$HOME/bin:$PATH";; esac' >> /home/user/sample-home/.bashrc
```

Variants: print a warning line after 1 s before the shell; or `exec tmux -L samplewsl new-session -A -s main` instead of bash (a `~/.bashrc` that runs tmux, no report to the app). Time when `[sample wsl ready]` and the next line appear in the new terminal's buffer.

## Shared tmux session

```bash
echo 'if [ -z "$TMUX" ] && command -v tmux >/dev/null; then exec tmux new-session -A -s main; fi' >> /home/user/sample-home/.bashrc
```

Every new terminal attaches to one session; check with `HOME=/home/user/sample-home tmux ls`.

## Leftover processes after closing a terminal

Start `nohup sleep 1001 &`, `setsid sleep 1002 &`, `(trap '' HUP TERM; exec sleep 1003) &` in one terminal, close it, then `ps -eo pid,args | grep 'sleep 100'` after 3 s.

## Timing a sequence

Poll every 250 ms and record the first time each marker appears; report the times, not "it worked".
