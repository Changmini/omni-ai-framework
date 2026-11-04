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
  empty: $('#agent-empty'),
  count: $('#agent-count'),
  terminals: $('#terminals'),
  welcome: $('#welcome'),
  form: $('#new-agent'),
  pick: $('#pick-folder'),
  controls: $('#controls'),
  controlTarget: $('#control-target'),
  promptForm: $('#prompt-form'),
  prompt: $('#prompt'),
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

// ---------- agent lifecycle ----------

async function startAgent({ name, cwd, command }) {
  const info = await api.create({ name, cwd, command, cols: 100, rows: 30 });
  addAgent(info);
  select(info.id);
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
    <button class="agent-close" title="에이전트 종료" aria-label="에이전트 종료">✕</button>`;
  item.querySelector('.agent-name').textContent = info.name;
  item.querySelector('.agent-sub').textContent = info.cwd;
  item.addEventListener('click', () => select(info.id));
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(info.id); });
  item.querySelector('.agent-close').addEventListener('click', (e) => {
    e.stopPropagation();
    api.kill(info.id);
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
  if (activeId === id) {
    activeId = null;
    const next = agents.keys().next();
    if (!next.done) select(next.value);
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
  els.empty.hidden = agents.size > 0;
  els.welcome.hidden = agents.size > 0;
}

function renderActive() {
  const a = agents.get(activeId);
  els.controls.setAttribute('aria-disabled', a && a.info.status !== 'exited' ? 'false' : 'true');
  if (!a) {
    els.activeLed.dataset.status = 'none';
    els.activeName.textContent = '에이전트를 시작하세요';
    els.activeCwd.textContent = '';
    els.activeStatus.textContent = '';
    els.controlTarget.textContent = '';
    els.banner.hidden = true;
    return;
  }
  const { info } = a;
  els.activeLed.dataset.status = info.status;
  els.activeName.textContent = info.name;
  els.activeCwd.textContent = info.cwd;
  els.activeStatus.textContent = STATUS_LABEL[info.status] || '';
  els.controlTarget.textContent = `→ ${info.name}`;
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

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(els.form));
  await startAgent(data);
  els.form.elements.name.value = '';
});

els.pick.addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (dir) els.form.elements.cwd.value = dir;
});

els.controls.querySelector('.quick').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !activeId) return;
  if (btn.dataset.line) api.sendLine(activeId, btn.dataset.line);
  else if (btn.dataset.key) api.write(activeId, btn.dataset.key);
  agents.get(activeId).term.focus();
});

function sendPrompt() {
  const text = els.prompt.value.trim();
  if (!text || !activeId) return;
  api.sendLine(activeId, text);
  els.prompt.value = '';
  agents.get(activeId).term.focus();
}
els.promptForm.addEventListener('submit', (e) => { e.preventDefault(); sendPrompt(); });
els.prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendPrompt(); }
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
  const first = agents.keys().next();
  if (!first.done) select(first.value);
  renderActive();
})();
