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
const STATUS_LABEL = {
  working: '작업 중', idle: '대기', error: '오류 감지', exited: '종료됨',
};

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
const SHORTCUTS = { KeyT: () => newTerminal(), KeyW: () => closeTerminal(activeId) };
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

  const item = document.createElement('li');
  item.className = 'agent';
  item.tabIndex = 0;
  item.innerHTML = `
    <span class="led" data-status="${info.status}"></span>
    <span class="agent-meta">
      <div class="agent-name ellipsis"></div>
      <div class="agent-sub ellipsis"></div>
    </span>
    <button class="agent-close" title="터미널 닫기" aria-label="터미널 닫기">✕</button>`;
  item.querySelector('.agent-name').textContent = info.name;
  item.querySelector('.agent-sub').textContent = info.cwd;
  item.addEventListener('click', () => select(info.id));
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(info.id); });
  item.querySelector('.agent-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminal(info.id);
  });
  els.list.appendChild(item);

  agents.set(info.id, { info, term, fit, el, item });
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
    a.term.focus();
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
  els.activeLed.dataset.status = info.status;
  els.activeName.textContent = info.name;
  els.activeCwd.textContent = info.cwd;
  els.activeStatus.textContent = STATUS_LABEL[info.status] || '';
  els.banner.hidden = !info.error;
  els.banner.textContent = info.error ? `⚠ ${info.error}` : '';
}

function setStatus(id, status, error) {
  const a = agents.get(id);
  if (!a) return;
  a.info.status = status;
  a.info.error = error;
  a.item.querySelector('.led').dataset.status = status;
  a.item.title = error ? `오류: ${error}` : STATUS_LABEL[status] || '';
  if (id === activeId) renderActive();
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

// ---------- terminal -> UI ----------

api.onData(({ id, data }) => agents.get(id)?.term.write(data));
api.onStatus(({ id, status, error }) => setStatus(id, status, error));
api.onExit(({ id, exitCode }) => {
  const a = agents.get(id);
  if (!a) return;
  a.term.write(`\r\n\x1b[90m[프로세스 종료: 코드 ${exitCode}]\x1b[0m\r\n`);
  setStatus(id, 'exited', a.info.error);
});
api.onRemoved(({ id }) => removeAgent(id));

window.addEventListener('resize', () => requestAnimationFrame(fitActive));
new ResizeObserver(() => fitActive()).observe(els.terminals);

// Restore agents still running in the main process (e.g. after a reload).
(async () => {
  applyFontSize(fontSize);
  for (const info of await api.list()) addAgent(info);
  // Open straight into a shell; nothing to set up first.
  if (agents.size === 0) await newTerminal();
  else select(agents.keys().next().value);
})();
