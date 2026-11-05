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
  imeEnabled: $('#ime-enabled'),
  imeToggle: $('#ime-toggle'),
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
  const preedit = document.createElement('span');
  preedit.className = 'preedit';
  preedit.hidden = true;
  el.appendChild(preedit);
  term.onData((data) => api.write(info.id, data));
  term.attachCustomKeyEventHandler((e) => !isShortcut(e) && !handleImeKey(info.id, e));
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
  });
  const nameEl = item.querySelector('.agent-name');
  nameEl.title = '더블클릭(또는 F2)해서 이름 바꾸기';
  nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(info.id); });
  item.querySelector('.agent-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminal(info.id);
  });
  els.list.appendChild(item);

  agents.set(info.id, { info, term, fit, el, item, preedit });
  // The shell echoes committed text after the composed syllable was drawn:
  // follow the cursor so the syllable stays at the insertion point.
  const follow = () => { if (composer.composing && activeId === info.id) drawPreedit(info.id); };
  term.onCursorMove(follow);
  term.onScroll(follow);
  term.onResize(follow);
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
  if (activeId && activeId !== id) commitComposition(activeId);
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

// ---------- built-in Hangul input ----------
// Where no system input method reaches the app (Electron inside WSLg), the
// app composes dubeolsik Hangul itself: letter keys go to the composer, the
// syllable being composed is drawn over the cursor, and finished text is
// written to the terminal. On by default on Linux only; Windows and macOS
// have their own input methods.

/* global HangulComposer */
const composer = new HangulComposer();
let imeEnabled = readPref('imeEnabled', String(api.platform === 'linux')) === 'true';
let hangulMode = false;
let altRightAlone = false;

const isToggleKey = (e) =>
  e.key === 'HangulMode' || e.code === 'Lang1' ||
  (e.code === 'Space' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey);

function commitComposition(id) {
  if (!composer.composing) return;
  const text = composer.flush();
  if (id && agents.has(id)) api.write(id, text);
  drawPreedit(id);
}

function drawPreedit(id) {
  const a = agents.get(id);
  if (!a) return;
  const text = composer.composing ? composer.preedit : '';
  a.preedit.hidden = !text;
  if (!text) return;
  const screen = a.el.querySelector('.xterm-screen');
  if (!screen) return;
  const sr = screen.getBoundingClientRect();
  const er = a.el.getBoundingClientRect();
  const cw = sr.width / a.term.cols;
  const ch = sr.height / a.term.rows;
  const buf = a.term.buffer.active;
  const row = buf.cursorY + (buf.baseY - buf.viewportY);
  Object.assign(a.preedit.style, {
    left: `${sr.left - er.left + buf.cursorX * cw}px`,
    top: `${sr.top - er.top + row * ch}px`,
    height: `${ch}px`,
    lineHeight: `${ch}px`,
    fontSize: `${a.term.options.fontSize}px`,
  });
  a.preedit.textContent = text;
}

function setHangulMode(on) {
  if (!on) commitComposition(activeId);
  hangulMode = on;
  renderIme();
}

function renderIme() {
  els.imeEnabled.checked = imeEnabled;
  els.imeToggle.hidden = !imeEnabled;
  els.imeToggle.textContent = hangulMode ? '한' : 'A';
  els.imeToggle.classList.toggle('on', hangulMode);
}

// Returns true when the key was used here and xterm must ignore it.
function handleImeKey(id, e) {
  if (!imeEnabled || e.isComposing || e.keyCode === 229) return false; // a system IME is active
  const down = e.type === 'keydown';

  // 한/영: the Hangul key, Shift+Space, or Right Alt pressed and released alone
  // (Korean keyboards often send Right Alt for 한/영).
  if (isToggleKey(e)) {
    if (down && !e.repeat) setHangulMode(!hangulMode);
    e.preventDefault(); // no keypress/input event, so no stray space
    return true;
  }
  if (e.code === 'AltRight') {
    if (down) altRightAlone = true;
    else if (e.type === 'keyup' && altRightAlone) { altRightAlone = false; setHangulMode(!hangulMode); }
    return true;
  }
  if (down) altRightAlone = false;

  if (!hangulMode) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) {
    if (down) commitComposition(id);
    return false;
  }
  const letter = e.key.length === 1 && /[a-zA-Z]/.test(e.key);
  if (!down) return letter && e.type === 'keypress'; // the keypress of a handled letter
  if (letter) {
    e.preventDefault(); // keep the browser from also inserting the Latin letter
    const r = composer.feed(e.key);
    if (r.commit) api.write(id, r.commit);
    drawPreedit(id);
    return true;
  }
  if (e.key === 'Backspace' && composer.backspace()) {
    e.preventDefault();
    drawPreedit(id);
    return true;
  }
  if (e.key === 'Escape' && composer.composing) { composer.reset(); drawPreedit(id); return false; }
  commitComposition(id); // any other key ends the syllable, then goes through
  return false;
}

els.imeToggle.addEventListener('click', () => {
  setHangulMode(!hangulMode);
  agents.get(activeId)?.term.focus();
});
els.imeEnabled.addEventListener('change', () => {
  imeEnabled = els.imeEnabled.checked;
  writePref('imeEnabled', imeEnabled);
  if (!imeEnabled) setHangulMode(false);
  renderIme();
});
renderIme();

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
