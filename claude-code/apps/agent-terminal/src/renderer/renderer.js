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
};
function isShortcut(e) {
  return e.ctrlKey && e.shiftKey && !e.altKey && e.code in SHORTCUTS;
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
    allowProposedApi: false,
    theme: TERMINAL_THEME,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.onData((data) => api.write(info.id, data));
  term.attachCustomKeyEventHandler((e) => !isShortcut(e));
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

  agents.set(info.id, { info, term, fit, el, item });
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
  activeId = id;
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
}

const baseName = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || '';
const displayName = (info) => info.name || baseName(info.cwd) || `터미널 ${info.id}`;

// The LED shows Claude's own state (from hooks) while it runs in the terminal,
// and the shell's otherwise.
function ledStatus(info) {
  if (info.claude && info.claude.status) return info.claude.status;
  if (info.status === 'error' || info.status === 'exited') return info.status;
  return 'shell';
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
  els.activeStatus.textContent = claudeSummary(c) || SHELL_LABEL[info.status] || '';
  // Claude waiting for the user takes the banner over a shell error line.
  const claudeMsg = (c.status === 'waiting' || c.status === 'error') && c.message;
  const banner = claudeMsg || info.error;
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

function update(id, patch) {
  const a = agents.get(id);
  if (!a) return;
  Object.assign(a.info, patch);
  renderItem(id);
}

// ---------- UI -> terminal ----------

els.newTerminal.addEventListener('click', () => newTerminal());
document.addEventListener('keydown', (e) => {
  if (!isShortcut(e) || e.repeat) return;
  e.preventDefault();
  SHORTCUTS[e.code]();
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

// ---------- terminal -> UI ----------

api.onData(({ id, data }) => agents.get(id)?.term.write(data));
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
