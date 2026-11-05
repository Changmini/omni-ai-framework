'use strict';

/* global Terminal, FitAddon */

const api = window.agentApi;

const TERMINAL_THEME = {
  background: '#14161c', // = --bg in styles.css
  foreground: '#d7dae0',
  cursor: '#d97757',
  cursorAccent: '#14161c',
  selectionBackground: '#3a3f4f',
  black: '#1b1e26', red: '#f0616d', green: '#4fc08d', yellow: '#e6b450',
  blue: '#6ea8fe', magenta: '#c792ea', cyan: '#5fd4d4', white: '#d7dae0',
  brightBlack: '#545a68', brightRed: '#ff7a85', brightGreen: '#6fdcaa', brightYellow: '#f5ca6e',
  brightBlue: '#8fbcff', brightMagenta: '#dcaaf5', brightCyan: '#80e6e6', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(125, 132, 148, 0.28)',
  scrollbarSliderHoverBackground: 'rgba(125, 132, 148, 0.5)',
  scrollbarSliderActiveBackground: 'rgba(217, 119, 87, 0.7)',
  overviewRulerBorder: 'transparent',
};
const FONT_FAMILY = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
const CLAUDE_LABEL = { working: '작업 중', waiting: '승인 대기', idle: '대기', error: '오류' };
const SHELL_LABEL = { error: '오류 감지', exited: '종료됨' };

const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#agent-list'),
  count: $('#agent-count'),
  terminals: $('#terminals'),
  newTerminal: $('#new-terminal'),
  fontSize: $('#font-size'),
  fontSizeValue: $('#font-size-value'),
  activeLed: $('#active-led'),
  activeName: $('#active-name'),
  activeCwd: $('#active-cwd'),
  activeStatus: $('#active-status'),
  banner: $('#error-banner'),
};

const agents = new Map(); // id -> { info, term, fit, el, item }
let activeId = null;
let fontSize = Number(readPref('fontSize', 14));

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

// ---------- terminal lifecycle ----------

// A plain shell in the home folder; the user cds and runs claude as usual.
async function newTerminal() {
  const info = await api.create({ cols: 100, rows: 30 });
  addAgent(info);
  select(info.id);
  return info.id;
}

function closeTerminal(id) {
  if (id) api.kill(id);
}

// Ctrl+Shift+T / Ctrl+Shift+W. Handled once, on document; xterm only has to
// leave these keys alone (see attachCustomKeyEventHandler below).
const SHORTCUTS = {
  KeyT: () => newTerminal(),
  KeyW: () => closeTerminal(activeId),
  PageUp: () => moveTerminal(activeId, -1), // like moving a browser tab
  PageDown: () => moveTerminal(activeId, 1),
  KeyB: () => setSidebarCollapsed(!app.classList.contains('collapsed')),
  KeyC: () => copySelection(activeId),
  KeyV: () => pasteInto(activeId),
  KeyA: () => agents.get(activeId)?.term.selectAll(),
  KeyF: () => openSearch(),
};
function isShortcut(e) {
  return (e.ctrlKey && e.shiftKey && !e.altKey && e.code in SHORTCUTS) || navTarget(e) !== null;
}

// Ctrl+1..9: n-th terminal in the sidebar order; Ctrl+Tab / Ctrl+Shift+Tab:
// next / previous (wrapping). Returns the terminal id to show, or null.
function navTarget(e) {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const ids = [...agents.keys()];
  if (!ids.length) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.shiftKey) return ids[Number(digit[1]) - 1] ?? null;
  if (e.code === 'Tab') {
    const i = Math.max(0, ids.indexOf(activeId));
    return ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length];
  }
  return null;
}

function addAgent(info) {
  const el = document.createElement('div');
  el.className = 'term';
  els.terminals.appendChild(el);

  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true, // search result decorations and counts
    // xterm 6 sizes its vertical scrollbar from the overview ruler width
    // (default 14px); the ruler also marks search matches.
    overviewRuler: { width: 6 },
    theme: TERMINAL_THEME,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(search);
  search.onDidChangeResults((r) => { if (info.id === activeId) showSearchCount(r); });
  // URLs: underline on hover, open in the browser with Ctrl+click (a plain
  // click is often just focusing or selecting).
  term.loadAddon(new WebLinksAddon.WebLinksAddon((event, uri) => {
    if (event.ctrlKey || event.metaKey) api.openExternal(uri);
  }, {
    hover: () => { el.title = 'Ctrl+클릭으로 열기'; },
    leave: () => { el.title = ''; },
  }));
  term.open(el);
  term.onData((data) => api.write(info.id, data));
  term.attachCustomKeyEventHandler((e) => {
    if (isShortcut(e)) return false;
    // Ctrl+C copies while text is selected (like Windows Terminal); otherwise
    // it reaches the shell as ^C.
    if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyC' && term.hasSelection()) {
      e.preventDefault();
      copySelection(info.id);
      return false;
    }
    return true;
  });
  // Right-click: copy the selection, or paste when nothing is selected.
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) copySelection(info.id);
    else pasteInto(info.id);
  });
  term.onResize(({ cols, rows }) => api.resize(info.id, cols, rows));
  // The shell integration reports its folder before each prompt.
  term.parser.registerOscHandler(7, (data) => { api.reportCwd(info.id, 7, data); return true; });
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith('9;')) return false;
    api.reportCwd(info.id, 9, data);
    return true;
  });

  const item = document.createElement('li');
  item.className = 'agent';
  item.dataset.id = info.id;
  item.draggable = true;
  item.innerHTML = `
    <div class="agent-row" tabindex="0">
      <span class="agent-num" aria-hidden="true"></span>
      <span class="led"></span>
      <span class="agent-meta">
        <div class="agent-name ellipsis"></div>
        <div class="agent-sub ellipsis"></div>
        <div class="agent-claude ellipsis"></div>
      </span>
      <button class="agent-close" title="터미널 닫기 (Ctrl+Shift+W)" aria-label="터미널 닫기">✕</button>
    </div>
    <ul class="agent-children"></ul>
    <div class="agent-tasks ellipsis"></div>`;
  const row = item.querySelector('.agent-row');
  row.addEventListener('click', () => select(info.id));
  item.querySelector('.agent-claude').addEventListener('click', (e) => {
    if (!e.currentTarget.classList.contains('focusable')) return;
    e.stopPropagation();
    focusPane(info.id, 'main');
  });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return; // typing in the rename box
    if (e.key === 'Enter') select(info.id);
    if (e.key === 'F2') { e.preventDefault(); startRename(info.id); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveTerminal(info.id, e.key === 'ArrowUp' ? -1 : 1);
      row.focus();
    }
  });
  const nameEl = item.querySelector('.agent-name');
  nameEl.title = '더블클릭(또는 F2)해서 이름 바꾸기';
  nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(info.id); });
  item.querySelector('.agent-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminal(info.id);
  });
  enableDrag(item, info.id);
  els.list.appendChild(item);

  agents.set(info.id, { info, term, fit, el, item, search });
  renderItem(info.id);
  renderList();
}

function removeAgent(id) {
  const a = agents.get(id);
  if (!a) return;
  a.term.dispose();
  a.el.remove();
  a.item.remove();
  agents.delete(id);
  // Closing the last terminal closes the window, like a regular terminal app.
  if (agents.size === 0) { window.close(); return; }
  if (activeId === id) {
    activeId = null;
    select([...agents.keys()].at(-1));
  }
  renderList();
  renderActive();
}

function select(id) {
  if (!agents.has(id)) return;
  if (activeId !== id) closeSearch(false);
  activeId = id;
  loadConfig();
  for (const [aid, a] of agents) {
    const on = aid === id;
    a.el.classList.toggle('active', on);
    a.item.classList.toggle('active', on);
  }
  const a = agents.get(id);
  requestAnimationFrame(() => {
    fitActive();
    // A double-click on a name selects first; leave focus in the rename box.
    if (![...agents.values()].some((x) => x.renaming)) a.term.focus();
  });
  renderActive();
}

function fitActive() {
  const a = agents.get(activeId);
  if (!a) return;
  try { a.fit.fit(); } catch { /* element hidden or not laid out yet */ }
}

// ---------- rendering ----------

function renderList() {
  els.count.textContent = String(agents.size);
  // Position badges for Ctrl+1..9, in sidebar order.
  [...agents.values()].forEach((a, i) => {
    const n = a.item.querySelector('.agent-num');
    n.textContent = i < 9 ? String(i + 1) : '';
    n.title = i < 9 ? `Ctrl+${i + 1}` : '';
  });
}

const baseName = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || '';
const displayName = (info) => info.name || baseName(info.cwd) || `터미널 ${info.id}`;

// The LED shows Claude's own state (from hooks) while it runs in the terminal,
// and the shell's otherwise.
function ledStatus(info) {
  if (info.claude && info.claude.status) return info.claude.status;
  if (info.status === 'exited') return 'exited';
  if (shellError(info)) return 'error';
  return 'shell';
}

// The output-pattern error (status.js) is meant for plain shells, e.g. a dev
// server failing. It is ignored while Claude runs in the terminal (its own
// errors come through hooks, and its screen often shows the word "Error:"),
// while a full-screen program such as tmux or vim is up, or once dismissed.
function shellError(info) {
  if (!info.error || info.errorDismissed === info.error) return null;
  if (info.claude && info.claude.status) return null;
  const a = agents.get(info.id);
  if (a && a.term.buffer.active.type === 'alternate') return null;
  return info.error;
}

function claudeSummary(c) {
  if (!c || !c.status) return '';
  if (c.status === 'working' && c.tool) return `Claude · ${c.tool} 실행 중`;
  return `Claude · ${CLAUDE_LABEL[c.status] || ''}`;
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderItem(id) {
  const a = agents.get(id);
  if (!a) return;
  const { info, item } = a;
  const c = info.claude || {};
  item.querySelector('.led').dataset.status = ledStatus(info);
  if (!a.renaming) item.querySelector('.agent-name').textContent = displayName(info);
  item.querySelector('.agent-sub').textContent = info.branch ? `⎇ ${info.branch}` : info.cwd;
  const claudeLine = item.querySelector('.agent-claude');
  claudeLine.textContent = claudeSummary(c);
  claudeLine.dataset.status = c.status || '';
  claudeLine.classList.toggle('focusable', Boolean(c.focusable));
  claudeLine.title = c.focusable ? '클릭: 이 Claude의 tmux 창으로 이동' : '';
  item.title = info.cwd;

  // Subagents and teammates, live from hooks and the team config.
  const children = item.querySelector('.agent-children');
  children.replaceChildren(...(c.agents || []).map((ag) => {
    const li = h('li', 'child');
    const led = h('span', 'led small');
    led.dataset.status = ag.status || 'working';
    const kind = ag.teammate ? '팀원' : '서브에이전트';
    li.append(
      led,
      h('span', 'child-name ellipsis', ag.name || ag.type || 'agent'),
      h('span', 'child-meta ellipsis', ag.tool ? `${ag.tool}` : kind),
    );
    li.title = [kind, ag.name, ag.type, CLAUDE_LABEL[ag.status]].filter(Boolean).join(' · ');
    if (ag.focusable) {
      // Split-pane teammate: jump to its tmux pane.
      li.classList.add('focusable');
      li.title += '\n클릭: tmux 창으로 이동';
      li.addEventListener('click', (e) => { e.stopPropagation(); focusPane(id, ag.id); });
    }
    return li;
  }));

  const tasks = item.querySelector('.agent-tasks');
  const t = c.tasks;
  tasks.hidden = !t;
  if (t) {
    const now = t.inProgress && t.inProgress[0];
    const head = `${c.team ? '팀 작업' : '작업'} ${t.done}/${t.total}`;
    tasks.textContent = now ? `${head} · ${now.owner ? `${now.owner}: ` : ''}${now.subject}` : head;
  }
  if (id === activeId) renderActive();
}

function renderActive() {
  const a = agents.get(activeId);
  if (!a) {
    els.activeLed.dataset.status = 'none';
    els.activeName.textContent = '';
    els.activeCwd.textContent = '';
    els.activeStatus.textContent = '';
    els.banner.hidden = true;
    return;
  }
  const { info } = a;
  const c = info.claude || {};
  els.activeLed.dataset.status = ledStatus(info);
  els.activeName.textContent = displayName(info);
  els.activeCwd.textContent = [info.cwd, info.branch ? `⎇ ${info.branch}` : ''].filter(Boolean).join('  ');
  // '오류 감지' only when the error is actually shown (see shellError).
  const shellLabel = info.status === 'exited' ? SHELL_LABEL.exited : shellError(info) ? SHELL_LABEL.error : '';
  els.activeStatus.textContent = claudeSummary(c) || shellLabel;
  // Claude waiting for the user takes the banner over a shell error line.
  const claudeMsg = (c.status === 'waiting' || c.status === 'error') && c.message;
  const banner = claudeMsg || shellError(info);
  const waiting = Boolean(claudeMsg) && c.status === 'waiting';
  els.banner.hidden = !banner;
  els.banner.dataset.kind = waiting ? 'waiting' : 'error';
  els.banner.textContent = banner ? `${waiting ? '⏳' : '⚠'} ${banner}` : '';
}

// ---------- reorder ----------
// Drag a terminal in the sidebar, or Ctrl+Shift+PageUp/PageDown (Alt+Up/Down
// on a focused row). The main process keeps the order for page reloads.
let dragId = null;

function saveOrder() {
  const ids = [...els.list.children].map((li) => li.dataset.id).filter((id) => agents.has(id));
  const reordered = new Map(ids.map((id) => [id, agents.get(id)]));
  agents.clear();
  for (const [id, a] of reordered) agents.set(id, a);
  api.reorder(ids);
  renderList();
}

function moveTerminal(id, delta) {
  const li = agents.get(id)?.item;
  if (!li) return;
  if (delta < 0 && li.previousElementSibling) els.list.insertBefore(li, li.previousElementSibling);
  else if (delta > 0 && li.nextElementSibling) els.list.insertBefore(li.nextElementSibling, li);
  else return;
  saveOrder();
}

function clearDropMarks() {
  for (const li of els.list.children) li.classList.remove('drop-before', 'drop-after');
}

function enableDrag(item, id) {
  item.addEventListener('dragstart', (e) => {
    if (agents.get(id)?.renaming) { e.preventDefault(); return; }
    dragId = id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  });
  item.addEventListener('dragend', () => {
    dragId = null;
    item.classList.remove('dragging');
    clearDropMarks();
  });
  item.addEventListener('dragover', (e) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    item.classList.add(after ? 'drop-after' : 'drop-before');
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    const moving = dragId && dragId !== id ? agents.get(dragId)?.item : null;
    const after = item.classList.contains('drop-after');
    clearDropMarks();
    if (!moving) return;
    els.list.insertBefore(moving, after ? item.nextSibling : item);
    saveOrder();
  });
}

// ---------- tmux pane focus ----------
async function focusPane(id, target) {
  select(id);
  const ok = await api.focusPane(id, target).catch(() => false);
  const a = agents.get(id);
  if (!ok && a) {
    a.item.classList.add('focus-failed');
    setTimeout(() => a.item.classList.remove('focus-failed'), 600);
  }
}

// ---------- rename ----------
// Double-click a name (sidebar or top bar) or press F2 on a row. Enter or
// leaving the box saves; Esc cancels; an empty name follows the folder again.
function startRename(id) {
  const a = agents.get(id);
  if (!a || a.renaming) return;
  a.renaming = true;
  const nameEl = a.item.querySelector('.agent-name');
  const input = document.createElement('input');
  input.className = 'rename';
  const initial = a.info.name || displayName(a.info);
  input.value = initial;
  input.maxLength = 80;
  input.setAttribute('aria-label', '터미널 이름');
  nameEl.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  let ready = false; // ignore a blur from the click that opened the box
  requestAnimationFrame(() => requestAnimationFrame(() => { ready = true; if (document.activeElement !== input) { input.focus(); input.select(); } }));
  const finish = (save) => {
    if (done) return;
    done = true;
    a.renaming = false;
    // Unchanged text is not saved: the name keeps following the folder.
    if (save && input.value.trim() !== initial) {
      const name = input.value.trim();
      a.info.name = name || null;
      api.rename(id, name);
    }
    renderItem(id);
    if (id === activeId) a.term.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('blur', () => { if (ready) finish(true); });
}

els.activeName.title = '더블클릭해서 이름 바꾸기';
els.activeName.addEventListener('dblclick', () => { if (activeId) startRename(activeId); });

els.banner.title = '클릭해서 닫기';
els.banner.addEventListener('click', () => {
  const a = agents.get(activeId);
  if (!a) return;
  a.info.errorDismissed = a.info.error;
  if (a.info.claude && a.info.claude.message) a.info.claude = { ...a.info.claude, message: null };
  renderItem(activeId);
});

function update(id, patch) {
  const a = agents.get(id);
  if (!a) return;
  if (id === activeId && 'cwd' in patch && patch.cwd !== a.info.cwd) loadConfig(); // new project
  Object.assign(a.info, patch);
  renderItem(id);
}

// ---------- UI -> terminal ----------

els.newTerminal.addEventListener('click', () => newTerminal());
document.addEventListener('keydown', (e) => {
  if (!isShortcut(e)) return;
  e.preventDefault();
  const target = navTarget(e);
  if (target !== null) { select(target); return; } // repeat allowed: hold Ctrl+Tab to cycle
  if (!e.repeat) SHORTCUTS[e.code]();
});

function applyFontSize(size) {
  fontSize = size;
  els.fontSize.value = String(size);
  els.fontSizeValue.textContent = String(size);
  for (const a of agents.values()) a.term.options.fontSize = size;
  fitActive();
  writePref('fontSize', size);
}
els.fontSize.addEventListener('input', () => applyFontSize(Number(els.fontSize.value)));

// ---------- sidebar width and collapse ----------
// Drag the sidebar's right edge (double-click: default width), or collapse it
// with the top-bar button / Ctrl+Shift+B. Both are remembered.
const app = document.querySelector('.app');
const SIDEBAR = { def: 300, min: 200, max: 600 };
const sidebarToggle = $('#sidebar-toggle');
const resizer = $('#sidebar-resizer');

function setSidebarWidth(w, save = true) {
  const width = Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w)));
  document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
  if (save) writePref('sidebarWidth', width);
  requestAnimationFrame(fitActive);
}

function setSidebarCollapsed(on) {
  app.classList.toggle('collapsed', on);
  sidebarToggle.setAttribute('aria-pressed', String(on));
  writePref('sidebarCollapsed', on);
  requestAnimationFrame(fitActive);
}

resizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const left = app.getBoundingClientRect().left;
  const move = (ev) => setSidebarWidth(ev.clientX - left, false);
  const up = (ev) => {
    resizer.releasePointerCapture(ev.pointerId);
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing');
    setSidebarWidth(ev.clientX - left);
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
});
resizer.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR.def));
sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!app.classList.contains('collapsed'));
  agents.get(activeId)?.term.focus();
});
setSidebarWidth(Number(readPref('sidebarWidth', SIDEBAR.def)) || SIDEBAR.def, false);
setSidebarCollapsed(readPref('sidebarCollapsed', 'false') === 'true');

// ---------- shortcuts ----------
// A saved list of commands. Clicking one types them into a terminal, one line
// at a time: each line waits until the previous one's output has settled, so
// a line like `wsl` gets its new shell before the next line arrives. Works the
// same on Windows, WSL and Linux because it is just typing.
const scEls = {
  list: $('#shortcut-list'), empty: $('#shortcut-empty'), add: $('#shortcut-add'),
  form: $('#shortcut-form'), cancel: $('#shortcut-cancel'),
};
let shortcuts = [];
try { shortcuts = JSON.parse(readPref('shortcuts', '[]')); } catch { shortcuts = []; }
if (!Array.isArray(shortcuts)) shortcuts = [];
let editingShortcut = null; // id being edited, or 'new'

const saveShortcuts = () => writePref('shortcuts', JSON.stringify(shortcuts));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves once the terminal printed nothing for `quietMs` (or after `maxMs`).
async function waitQuiet(id, quietMs = 500, maxMs = 8000) {
  const start = Date.now();
  await sleep(quietMs);
  for (;;) {
    const a = agents.get(id);
    if (!a) return;
    if (Date.now() - (a.lastDataAt || 0) >= quietMs || Date.now() - start >= maxMs) return;
    await sleep(100);
  }
}

const runningShortcuts = new Set(); // a second click while one runs is ignored

async function runShortcut(sc) {
  const lines = sc.command.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length || runningShortcuts.has(sc.id)) return;
  runningShortcuts.add(sc.id);
  try {
    await typeShortcut(sc, lines);
  } finally {
    runningShortcuts.delete(sc.id);
  }
}

async function typeShortcut(sc, lines) {
  let id = activeId;
  if (sc.newTerminal || !id) {
    id = await newTerminal();
    if (sc.name) { agents.get(id).info.name = sc.name; api.rename(id, sc.name); renderItem(id); }
    await waitQuiet(id, 700); // first prompt
  }
  for (const line of lines) {
    if (!agents.has(id)) return;
    api.sendLine(id, line);
    await waitQuiet(id);
  }
  agents.get(id)?.term.focus();
}

function renderShortcuts() {
  scEls.empty.hidden = shortcuts.length > 0 || !scEls.form.hidden;
  $('#shortcut-count').textContent = String(shortcuts.length);
  scEls.list.replaceChildren(...shortcuts.flatMap((sc) => {
    const li = h('li', 'shortcut');
    // Editing: the form opens right under the item being edited.
    const editingThis = editingShortcut === sc.id && !scEls.form.hidden;
    if (editingThis) li.classList.add('editing');
    li.tabIndex = 0;
    const first = sc.command.split(/\r?\n/).find((l) => l.trim()) || '';
    const more = sc.command.split(/\r?\n/).filter((l) => l.trim()).length - 1;
    const meta = h('span', 'shortcut-meta');
    meta.append(h('div', 'shortcut-name ellipsis', sc.name), h('div', 'shortcut-cmd ellipsis', more > 0 ? `${first}  (+${more})` : first));
    const edit = h('button', 'shortcut-btn', '✎');
    edit.title = '편집';
    const del = h('button', 'shortcut-btn', '✕');
    del.title = '삭제';
    const icon = h('span', 'shortcut-icon', sc.newTerminal ? '⧉' : '▶');
    icon.title = sc.newTerminal ? '새 터미널에서 실행' : '현재 터미널에서 실행';
    li.append(icon, meta, edit, del);
    li.title = `${sc.newTerminal ? '새 터미널에서' : '현재 터미널에서'} 실행:\n${sc.command}`;
    li.addEventListener('click', () => runShortcut(sc));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) runShortcut(sc); });
    edit.addEventListener('click', (e) => { e.stopPropagation(); openShortcutForm(sc); });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm(`바로가기 "${sc.name}"을(를) 삭제할까요?`)) return;
      shortcuts = shortcuts.filter((x) => x.id !== sc.id);
      if (editingShortcut === sc.id) { editingShortcut = null; scEls.form.hidden = true; }
      saveShortcuts();
      renderShortcuts();
    });
    if (!editingThis) return [li];
    const slot = h('li', 'shortcut-edit-slot');
    slot.append(scEls.form);
    return [li, slot];
  }));
  // Adding a new one (or nothing open): the form sits below the list.
  if (editingShortcut === null || editingShortcut === 'new') scEls.empty.after(scEls.form);
}

function openShortcutForm(sc) {
  editingShortcut = sc ? sc.id : 'new';
  const f = scEls.form.elements;
  f.name.value = sc ? sc.name : '';
  f.command.value = sc ? sc.command : '';
  fitCommandBox();
  f.newTerminal.checked = sc ? sc.newTerminal : true;
  scEls.form.hidden = false;
  renderShortcuts();
  f.name.focus();
}

function closeShortcutForm() {
  editingShortcut = null;
  scEls.form.hidden = true;
  renderShortcuts();
}

// The command box grows with its lines (3 to 8), so a whole shortcut is visible.
function fitCommandBox() {
  const box = scEls.form.elements.command;
  box.rows = Math.min(8, Math.max(3, box.value.split('\n').length));
}
scEls.form.elements.command.addEventListener('input', fitCommandBox);

scEls.add.addEventListener('click', () => openShortcutForm(null));
scEls.cancel.addEventListener('click', () => closeShortcutForm());
scEls.form.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeShortcutForm(); });
scEls.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = scEls.form.elements;
  const item = {
    id: editingShortcut === 'new' ? `sc-${Date.now().toString(36)}` : editingShortcut,
    name: f.name.value.trim().slice(0, 80),
    command: f.command.value.replace(/\s+$/, ''),
    newTerminal: f.newTerminal.checked,
  };
  if (!item.name || !item.command.trim()) return;
  const i = shortcuts.findIndex((x) => x.id === item.id);
  if (i >= 0) shortcuts[i] = item; else shortcuts.push(item);
  saveShortcuts();
  closeShortcutForm();
});
renderShortcuts();

// ---------- copy, paste, search ----------
function copySelection(id) {
  const a = agents.get(id);
  if (!a || !a.term.hasSelection()) return;
  api.clipboardWrite(a.term.getSelection());
  a.term.clearSelection();
}

async function pasteInto(id) {
  const a = agents.get(id);
  if (!a) return;
  let text = '';
  try { text = await api.clipboardRead(); } catch { return; }
  if (text) a.term.paste(text); // honours bracketed paste, like typing it
  a.term.focus();
}

const searchEls = {
  bar: $('#search-bar'), input: $('#search-input'), count: $('#search-count'),
  prev: $('#search-prev'), next: $('#search-next'), close: $('#search-close'),
};
const SEARCH_LOOK = {
  decorations: {
    // Distinct from the selection colour (#3a3f4f), which also marks the active match.
    matchBackground: '#2b4a6b',
    matchOverviewRuler: '#6ea8fe',
    activeMatchBackground: '#7a3d26',
    activeMatchBorder: '#d97757',
    activeMatchColorOverviewRuler: '#d97757',
  },
};

function openSearch() {
  const a = agents.get(activeId);
  if (!a) return;
  const sel = a.term.hasSelection() ? a.term.getSelection() : '';
  if (sel && !sel.includes('\n')) searchEls.input.value = sel;
  searchEls.bar.hidden = false;
  searchEls.input.focus();
  searchEls.input.select();
  if (searchEls.input.value) findInTerminal(1, true);
}

function closeSearch(focus = true) {
  if (searchEls.bar.hidden) return;
  searchEls.bar.hidden = true;
  searchEls.count.textContent = '';
  for (const a of agents.values()) a.search.clearDecorations();
  if (focus) agents.get(activeId)?.term.focus();
}

function findInTerminal(dir, incremental = false) {
  const a = agents.get(activeId);
  const q = searchEls.input.value;
  if (!a) return;
  if (!q) { a.search.clearDecorations(); searchEls.count.textContent = ''; return; }
  const opts = { ...SEARCH_LOOK, incremental };
  const found = dir < 0 ? a.search.findPrevious(q, opts) : a.search.findNext(q, opts);
  if (!found) searchEls.count.textContent = '없음';
}

function showSearchCount({ resultIndex, resultCount }) {
  if (searchEls.bar.hidden) return;
  searchEls.count.textContent = resultCount === 0 ? '없음'
    : resultIndex >= 0 ? `${resultIndex + 1}/${resultCount}` : `${resultCount}건`;
}

searchEls.input.addEventListener('input', () => findInTerminal(1, true));
searchEls.input.addEventListener('keydown', (e) => {
  e.stopPropagation(); // Ctrl+Shift+V/A/C here act on the search box, not the terminal
  if (e.key === 'Enter') { e.preventDefault(); findInTerminal(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
searchEls.next.addEventListener('click', () => findInTerminal(1));
searchEls.prev.addEventListener('click', () => findInTerminal(-1));
searchEls.close.addEventListener('click', () => closeSearch());

// ---------- Claude config list ----------
// Skills, plugins, hooks, subagents and MCP servers for the active terminal's
// project, read by the main process (claude-config.js). Reloaded when the
// terminal or its folder changes, on window focus, and with the ⟳ button.
const cfgEls = { body: $('#config-body'), project: $('#config-project'), refresh: $('#config-refresh') };
const CFG_GROUPS = [
  ['skills', '스킬', (x) => [x.name, x.source, x.description]],
  ['plugins', '플러그인', (x) => [`${x.name}${x.version ? ` ${x.version}` : ''}`, x.missing ? '미설치' : x.enabled ? (x.marketplace || '') : '꺼짐', `${x.id}${x.scope ? ` (${x.scope})` : ''}`]],
  ['hooks', '훅', (x) => [`${x.event}${x.matcher ? ` · ${x.matcher}` : ''}`, x.omni ? 'Omni' : x.source, `${x.type}: ${x.target}`]],
  ['agents', '서브에이전트', (x) => [x.name, x.source, x.description]],
  ['mcp', 'MCP 서버', (x) => [x.name, x.source, `${x.type}: ${x.description}`]],
];
let cfgTimer = null;
let lastConfigAt = 0;
let cfgOpen = {};
try { cfgOpen = JSON.parse(readPref('cfgOpen', '{"skills":true}')); } catch { cfgOpen = { skills: true }; }

function loadConfig(delay = 150) {
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(async () => {
    const id = activeId;
    if (!id || !api.claudeConfig) return;
    let data = null;
    try { data = await api.claudeConfig(id); } catch { data = null; }
    lastConfigAt = Date.now();
    if (id === activeId) renderConfig(data); // null shows '읽을 수 없습니다', not the previous list
  }, delay);
}

function renderConfig(data) {
  if (!data) {
    cfgEls.project.textContent = '';
    cfgEls.body.replaceChildren(h('div', 'cfg-empty', '읽을 수 없습니다'));
    return;
  }
  cfgEls.project.textContent = data.project ? `프로젝트: ${data.project}` : '';
  cfgEls.project.title = data.project || '';
  cfgEls.body.replaceChildren(...CFG_GROUPS.map(([key, label, row]) => {
    const items = data[key] || [];
    const d = document.createElement('details');
    d.className = 'cfg-group';
    d.open = Boolean(cfgOpen[key]);
    const sum = document.createElement('summary');
    sum.append(h('span', null, label), h('span', 'count', String(items.length)));
    d.append(sum);
    d.addEventListener('toggle', () => { cfgOpen[key] = d.open; writePref('cfgOpen', JSON.stringify(cfgOpen)); });
    if (!items.length) { d.append(h('div', 'cfg-empty', '없음')); return d; }
    const ul = h('ul', 'cfg-list');
    for (const x of items) {
      const [fullName, rawSrc, tip] = row(x);
      // Plugin items: "omni-core:planning-changes" + "플러그인 omni-core" would
      // say the plugin twice; show the short name with the plugin as source.
      const plugin = /^플러그인 (.+)$/.exec(rawSrc || '');
      const name = plugin ? fullName.replace(`${plugin[1]}:`, '') : fullName;
      const src = plugin ? plugin[1] : rawSrc;
      const li = h('li', 'cfg-item');
      if (key === 'plugins' && (!x.enabled || x.missing)) li.classList.add('off');
      if (key === 'hooks' && x.omni) li.classList.add('omni');
      li.title = [fullName, plugin ? `플러그인: ${plugin[1]}` : rawSrc, tip].filter(Boolean).join('\n');
      li.append(h('span', 'cfg-name', name), h('span', 'cfg-src', src || ''));
      ul.append(li);
    }
    d.append(ul);
    return d;
  }));
}

cfgEls.refresh.addEventListener('click', () => loadConfig(0));
// Coming back to the window: re-read, but not more than every 5s (the scan
// is synchronous file I/O in the main process, slow over \\wsl.localhost).
window.addEventListener('focus', () => { if (Date.now() - lastConfigAt > 5000) loadConfig(); });

// ---------- terminals | config height ----------
// Drag the border between the terminal list and the config list. Dragging to
// within SNAP px of either end hides that side completely (the other one
// takes the whole height); the border stays as a grip to drag it back, and a
// double-click restores the default split. The state is remembered.
const split = $('#sidebar-split');
const splitResizer = $('#split-resizer');
const SNAP = 40;

function applySplit(state) {
  // state: null (default) | 'top' (terminals hidden) | 'bottom' (config hidden) | px
  split.classList.toggle('top-collapsed', state === 'top');
  split.classList.toggle('bottom-collapsed', state === 'bottom');
  if (typeof state === 'number') document.documentElement.style.setProperty('--terminals-h', `${state}px`);
  else if (state === null) document.documentElement.style.removeProperty('--terminals-h');
  splitResizer.title = state === 'top' || state === 'bottom'
    ? '끌거나 더블클릭해서 다시 펼치기'
    : '끌어서 높이 조절 (끝까지 끌면 한쪽 숨기기) · 더블클릭: 기본 높이';
}

function splitStateAt(y) {
  const total = split.getBoundingClientRect().height;
  if (y < SNAP) return 'top';
  if (y > total - SNAP) return 'bottom';
  return Math.round(y);
}

function saveSplit(state) {
  writePref('terminalsHeight', state === null ? '' : String(state));
}

splitResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitResizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing-v');
  const top = split.getBoundingClientRect().top;
  const move = (ev) => applySplit(splitStateAt(ev.clientY - top));
  const up = (ev) => {
    splitResizer.releasePointerCapture(ev.pointerId);
    splitResizer.removeEventListener('pointermove', move);
    splitResizer.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing-v');
    const state = splitStateAt(ev.clientY - top);
    applySplit(state);
    saveSplit(state);
  };
  splitResizer.addEventListener('pointermove', move);
  splitResizer.addEventListener('pointerup', up);
});
splitResizer.addEventListener('dblclick', () => { applySplit(null); saveSplit(null); });
{
  const saved = readPref('terminalsHeight', '');
  if (saved === 'top' || saved === 'bottom') applySplit(saved);
  else if (Number(saved) > 0) applySplit(Number(saved));
}

// ---------- terminal -> UI ----------

api.onData(({ id, data }) => {
  const a = agents.get(id);
  if (!a) return;
  a.lastDataAt = Date.now();
  a.term.write(data);
});
api.onStatus(({ id, status, error }) => update(id, { status, error }));
api.onAgent(({ id, claude }) => update(id, { claude }));
api.onMeta(({ id, ...patch }) => update(id, patch)); // cwd/branch, or name
api.onExit(({ id, exitCode }) => {
  const a = agents.get(id);
  if (!a) return;
  a.term.write(`\r\n\x1b[90m[프로세스 종료: 코드 ${exitCode}]\x1b[0m\r\n`);
  update(id, { status: 'exited' });
});
api.onRemoved(({ id }) => removeAgent(id));

window.addEventListener('resize', () => requestAnimationFrame(fitActive));
new ResizeObserver(() => fitActive()).observe(els.terminals);

// Restore agents still running in the main process (e.g. after a reload).
(async () => {
  // xterm measures the font when a terminal opens: load the bundled font
  // (Latin and Hangul subsets) first. Local files, so this is quick.
  try {
    await Promise.race([
      document.fonts.load(`${fontSize}px "Nanum Gothic Coding"`, 'W가'),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* fall back to whatever is installed */ }
  applyFontSize(fontSize);
  for (const info of await api.list()) addAgent(info);
  // Open straight into a shell; nothing to set up first.
  if (agents.size === 0) await newTerminal();
  else select(agents.keys().next().value);
})();
