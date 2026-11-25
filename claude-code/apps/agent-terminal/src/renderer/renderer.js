'use strict';

/* global Terminal, FitAddon */

const api = window.agentApi;

const TERMINAL_THEME = {
  background: '#14161c', // = --bg in styles.css
  foreground: '#e3e6ec',
  cursor: '#e3e6ec', // = --text: colour is kept for the states
  cursorAccent: '#14161c',
  selectionBackground: '#3a3f4f',
  black: '#1b1e26', red: '#f0616d', green: '#4fc08d', yellow: '#e6b450',
  blue: '#6ea8fe', magenta: '#c792ea', cyan: '#5fd4d4', white: '#d7dae0',
  brightBlack: '#545a68', brightRed: '#ff7a85', brightGreen: '#6fdcaa', brightYellow: '#f5ca6e',
  brightBlue: '#8fbcff', brightMagenta: '#dcaaf5', brightCyan: '#80e6e6', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(125, 132, 148, 0.28)',
  scrollbarSliderHoverBackground: 'rgba(125, 132, 148, 0.5)',
  scrollbarSliderActiveBackground: 'rgba(227, 230, 236, 0.6)',
  overviewRulerBorder: 'transparent',
};
const FONT_FAMILY = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
const CLAUDE_LABEL = { working: '작업 중', waiting: '승인 대기', idle: '끝남', error: '오류' };
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
async function newTerminal(groupId = null) {
  const info = await api.create({ cols: 100, rows: 30 });
  addAgent(info, groupId);
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
  KeyF: () => (viewing ? openViewerFind() : openSearch()), // in a file shown: find there
  KeyI: () => setInspectorOpen(app.classList.contains('inspector-closed')),
  KeyP: () => togglePreview(),
  KeyG: () => setView(pipe.view === 'pipeline' ? 'terminal' : 'pipeline'),
};
function isShortcut(e) {
  return (e.ctrlKey && e.shiftKey && !e.altKey && e.code in SHORTCUTS) || navTarget(e) !== null;
}

// Ctrl+1..9: n-th terminal of the shown terminal's group; Ctrl+Tab /
// Ctrl+Shift+Tab: next / previous in that group (wrapping). Returns the
// terminal id to show, or null.
function navTarget(e) {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const ids = ViewLogic.groupNav([...agents.keys()], groupOf, activeId);
  if (!ids.length) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.shiftKey) return ids[Number(digit[1]) - 1] ?? null;
  if (e.code === 'Tab') {
    const i = Math.max(0, ids.indexOf(activeId));
    return ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length];
  }
  return null;
}

const BLINK_REST_MS = 30000;

// The lights of a working or waiting Claude blink by a class switched once a
// second. An endless CSS animation would redraw the window every frame for as
// long as Claude works: measured, about 10 times the app's idle CPU, this
// about 2 times. Nothing is done while the window is hidden.
let ledDim = false;
setInterval(() => {
  if (document.hidden) return;
  ledDim = !ledDim;
  for (const led of document.querySelectorAll('.led[data-status="working"], .led[data-status="waiting"]')) led.classList.toggle('dim', ledDim);
}, 1000);

function addAgent(info, groupId = null) {
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
  // The cursor blinks while the terminal is in use and rests (steady) after
  // BLINK_REST_MS without typing: a blinking cursor repaints the terminal
  // twice a second for as long as it has the keyboard (a few % of a CPU
  // core, battery on a laptop), also when nobody looks.
  let blinkTimer = null;
  const wake = () => {
    if (!term.options.cursorBlink) term.options.cursorBlink = true;
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => { term.options.cursorBlink = false; }, BLINK_REST_MS);
  };
  if (term.textarea) term.textarea.addEventListener('focus', wake);
  term.onData((data) => { wake(); api.write(info.id, data); });
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
        <span class="agent-node" hidden></span>
        <div class="agent-sub ellipsis"></div>
        <div class="agent-claude ellipsis"></div>
        <div class="ctx" hidden><span class="ctx-bar"><span class="ctx-fill"></span></span><span class="ctx-text"></span></div>
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
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, terminalMenu(info.id)); });

  agents.set(info.id, { info, term, fit, el, item, search, activity: [], stopBlink: () => clearTimeout(blinkTimer) });
  placeItem(info.id, item, groupId);
  saveOrder();
  loadActivity(info.id);
  renderItem(info.id);
  renderList();
}

function removeAgent(id) {
  const a = agents.get(id);
  if (!a) return;
  if (a.stopBlink) a.stopBlink();
  a.term.dispose();
  a.el.remove();
  a.item.remove();
  // Another terminal of the same group is shown next, if there is one.
  const sameGroup = ViewLogic.groupNav([...agents.keys()], groupOf, id).filter((x) => x !== id);
  agents.delete(id);
  delete groupOf[id];
  saveGroupOf();
  for (const [node, tid] of Object.entries(pipeBind)) if (tid === id) delete pipeBind[node];
  writeSession(PIPE_BIND_KEY, pipeBind);
  pipeRefresh();
  // Closing the last terminal closes the window, like a regular terminal app.
  if (agents.size === 0) { window.close(); return; }
  if (activeId === id) {
    activeId = null;
    select(sameGroup.at(-1) || [...agents.keys()].at(-1));
  }
  renderList();
  renderActive();
}

function select(id) {
  if (!agents.has(id)) return;
  const switching = activeId !== id;
  if (switching) { closeSearch(false); closeViewer(false); }
  activeId = id;
  // Choosing a terminal shows it; keys must not go to one hidden under the graph.
  if (pipe.view === 'pipeline' && !pipe.keepView) setView('terminal');
  setGroupCollapsed(groupOf[id], false); // the shown terminal is never folded away
  renderList(); // Ctrl+1..9 count within the shown terminal's group
  pipeRefresh();
  loadConfig();
  if (switching) { clearGit(); clearTree(); } // not the previous terminal's project meanwhile
  if (switching) { api.previewSetActive?.(id); syncPreview(); }
  loadGit();
  loadTree();
  renderInspector();
  for (const [aid, a] of agents) {
    const on = aid === id;
    a.el.classList.toggle('active', on);
    a.item.classList.toggle('active', on);
  }
  const a = agents.get(id);
  requestAnimationFrame(() => {
    fitActive();
    // A double-click on a name selects first; leave focus in the rename box.
    if (pipe.view === 'pipeline') pipe.els.root.focus();
    else if (![...agents.values()].some((x) => x.renaming)) a.term.focus();
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
  // Position badges for Ctrl+1..9: within the shown terminal's group only.
  const nav = ViewLogic.groupNav([...agents.keys()], groupOf, activeId);
  for (const [id, a] of agents) {
    const i = nav.indexOf(id);
    const n = a.item.querySelector('.agent-num');
    n.textContent = i >= 0 && i < 9 ? String(i + 1) : '';
    n.title = i >= 0 && i < 9 ? `Ctrl+${i + 1}` : '';
  }
  for (const g of groups) {
    groupEls.get(g.id)?.li.classList.toggle('current', groupOf[activeId] === g.id);
    renderGroupHead(g.id);
  }
  // The new-terminal button names the group a new terminal goes to.
  const target = groupById(ViewLogic.newTerminalGroup(groups, groupOf, activeId));
  els.newTerminal.replaceChildren('＋ 새 터미널', ...(target ? [h('span', 'new-terminal-group', `→ ${target.name}`)] : []));
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

// ---------- context usage ----------
const contextLevel = (pct) => (pct >= 85 ? 'high' : pct >= 60 ? 'mid' : 'low');
const kTokens = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : `${Math.round(n / 1000)}k`);
// The same name and "unknown" reason in the sidebar tree and the panel.
const agentName = (ag) => ag.name || ag.type || 'agent';
const noContextWhy = (ag) => (ag.main
  ? '컨텍스트: 아직 모름 (Claude의 첫 응답이 기록되면 표시됩니다)'
  : ag.teammate
    ? '컨텍스트: 아직 모름 (이 팀원의 신호를 받지 못했습니다. 앱보다 먼저 시작해 대기 중이면 다음에 일할 때 표시됩니다)'
    : '컨텍스트: 따로 재지 않음 (서브에이전트는 메인 세션 안에서 실행됩니다)');
const contextTitle = (ctx) => `컨텍스트 ${kTokens(ctx.tokens)} / ${kTokens(ctx.window)} (${ctx.pct}%)`
  + `${ctx.model ? ` · ${ctx.model}` : ''}\n창 크기는 추정값입니다: 200k, 넘으면 1M으로 봅니다.`;

function renderContext(box, ctx) {
  box.hidden = !ctx;
  if (!ctx) return;
  box.dataset.level = contextLevel(ctx.pct);
  box.querySelector('.ctx-fill').style.width = `${ctx.pct}%`;
  box.querySelector('.ctx-text').textContent = `${ctx.pct}% ${kTokens(ctx.tokens)}`;
  box.title = contextTitle(ctx);
}

function claudeSummary(c) {
  if (!c || !c.status) return '';
  // The state first (the sidebar colours it), then the tool it is about.
  const label = CLAUDE_LABEL[c.status] || '';
  return c.tool && (c.status === 'working' || c.status === 'waiting') ? `${label} ${c.tool}` : label;
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
  renderContext(item.querySelector('.ctx'), c.context);
  claudeLine.title = c.focusable ? '클릭: 이 Claude의 tmux 창으로 이동' : '';
  item.title = info.cwd;

  // Subagents and teammates, live from hooks and the team config.
  const children = item.querySelector('.agent-children');
  children.replaceChildren(...(c.agents || []).map((ag) => {
    const li = h('li', 'child');
    const led = h('span', 'led small');
    led.dataset.status = ag.status || 'working';
    const kind = ag.teammate ? '팀원' : '서브에이전트';
    const meta = h('span', 'child-meta ellipsis', ag.tool ? `${ag.tool}` : kind);
    // A teammate's value may come later ("—" until then); a subagent's never.
    if (ag.context || ag.teammate) {
      const pct = h('span', 'child-ctx', ag.context ? ` ${ag.context.pct}%` : ' —');
      if (ag.context) pct.dataset.level = contextLevel(ag.context.pct);
      meta.append(pct);
    }
    li.append(led, h('span', 'child-name ellipsis', agentName(ag)), meta);
    li.title = [kind, ag.name, ag.type, CLAUDE_LABEL[ag.status]].filter(Boolean).join(' · ')
      + `\n${ag.context ? contextTitle(ag.context) : noContextWhy(ag)}`;
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
    tasks.textContent = now ? `${head}, ${now.owner ? `${now.owner}: ` : ''}${now.subject}` : head;
  }
  const nodeTag = item.querySelector('.agent-node');
  const steps = nodeNamesOf(id).filter((x) => x !== displayName(info));
  nodeTag.hidden = !steps.length;
  nodeTag.textContent = steps.join(', ');
  renderGroupHead(groupOf[id]);
  pipeRefresh();
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

// ---------- terminal groups ----------
// Every terminal sits in a group (a folder of the sidebar). Groups fold;
// a folded group still shows a dot per terminal and how many wait for the
// user. Groups (name, order, folded) are kept in localStorage; which group
// a terminal is in, only for this run of the app (sessionStorage): terminals
// end with the app, and shortcuts open them again. Ctrl+1..9 and Ctrl+Tab
// stay inside the shown terminal's group (ViewLogic.groupNav).
const GROUPS_KEY = 'terminalGroups';
const GROUP_OF_KEY = 'terminalGroupOf';
const DEFAULT_GROUP = '기본';
let groups = [];
try { groups = JSON.parse(readPref(GROUPS_KEY, '[]')); } catch { groups = []; }
groups = (Array.isArray(groups) ? groups : [])
  .filter((g) => g && typeof g.id === 'string')
  .map((g) => ({ id: g.id, name: String(g.name || DEFAULT_GROUP).slice(0, 80), collapsed: Boolean(g.collapsed) }));
let groupOf = {}; // terminal id -> group id
try { groupOf = JSON.parse(sessionStorage.getItem(GROUP_OF_KEY) || '{}') || {}; } catch { groupOf = {}; }
const groupEls = new Map(); // group id -> { li, head, list, name, count, msg, dots }

const saveGroups = () => writePref(GROUPS_KEY, JSON.stringify(groups));
const saveGroupOf = () => { try { sessionStorage.setItem(GROUP_OF_KEY, JSON.stringify(groupOf)); } catch { /* this run only */ } };
const groupById = (gid) => groups.find((g) => g.id === gid);

function addGroup(name, at = groups.length) {
  const g = { id: `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, collapsed: false };
  groups.splice(at, 0, g);
  saveGroups();
  renderGroups();
  return g.id;
}

// One element per group, in the order of `groups`.
function renderGroups() {
  for (const [gid, ge] of groupEls) {
    if (!groupById(gid)) { ge.li.remove(); groupEls.delete(gid); }
  }
  for (const g of groups) {
    let ge = groupEls.get(g.id);
    if (!ge) ge = makeGroupEl(g.id);
    els.list.appendChild(ge.li); // in order
    ge.li.classList.toggle('collapsed', g.collapsed);
    ge.head.setAttribute('aria-expanded', String(!g.collapsed));
    if (!ge.renaming) ge.name.textContent = g.name;
  }
  renderList();
}

function makeGroupEl(gid) {
  const li = h('li', 'group');
  li.dataset.gid = gid;
  const head = h('div', 'group-head');
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  const chev = h('span', 'group-chev', '▾');
  chev.setAttribute('aria-hidden', 'true');
  const name = h('span', 'group-name ellipsis');
  name.title = '더블클릭(또는 F2)해서 이름 바꾸기';
  const count = h('span', 'group-count');
  const msg = h('span', 'group-msg');
  const dots = h('span', 'group-dots');
  const more = h('button', 'group-more', '⋯');
  more.type = 'button';
  more.title = '그룹 메뉴';
  more.setAttribute('aria-label', '그룹 메뉴');
  head.append(chev, name, count, msg, dots, more);
  const list = h('ul', 'group-items');
  li.append(head, list);
  const ge = { li, head, list, name, count, msg, dots };
  groupEls.set(gid, ge);

  head.addEventListener('click', (e) => { if (!more.contains(e.target) && !ge.renaming) toggleGroup(gid); });
  head.addEventListener('keydown', (e) => {
    if (e.target !== head) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(gid); }
    if (e.key === 'F2') { e.preventDefault(); renameGroup(gid); }
  });
  name.addEventListener('dblclick', (e) => { e.stopPropagation(); renameGroup(gid); });
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = more.getBoundingClientRect();
    openMenu(r.left, r.bottom + 2, groupMenu(gid));
  });
  // Drop on the head: to the end of this group. Hovering a folded one unfolds it.
  let unfoldTimer = null;
  head.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    clearDropMarks();
    head.classList.add('drop');
    if (groupById(gid)?.collapsed && !unfoldTimer) unfoldTimer = setTimeout(() => { unfoldTimer = null; setGroupCollapsed(gid, false); }, 600);
  });
  head.addEventListener('dragleave', () => { head.classList.remove('drop'); clearTimeout(unfoldTimer); unfoldTimer = null; });
  head.addEventListener('drop', (e) => {
    e.preventDefault();
    clearTimeout(unfoldTimer);
    unfoldTimer = null;
    clearDropMarks();
    const moving = dragId ? agents.get(dragId)?.item : null;
    if (moving) { list.appendChild(moving); saveOrder(); }
  });
  return ge;
}

function setGroupCollapsed(gid, collapsed) {
  const g = groupById(gid);
  if (!g || g.collapsed === collapsed) return;
  g.collapsed = collapsed;
  saveGroups();
  renderGroups();
}
const toggleGroup = (gid) => setGroupCollapsed(gid, !groupById(gid)?.collapsed);

// The group's head: count, and while folded a dot per terminal and how many wait.
function renderGroupHead(gid) {
  const ge = groupEls.get(gid);
  const g = groupById(gid);
  if (!ge || !g) return;
  const ids = [...agents.keys()].filter((id) => groupOf[id] === gid);
  ge.count.textContent = String(ids.length);
  const sum = ViewLogic.groupSummary(ids.map((id) => ledStatus(agents.get(id).info)));
  const show = g.collapsed;
  ge.msg.textContent = show && sum.waiting ? `기다림 ${sum.waiting}` : '';
  ge.dots.replaceChildren(...(show ? sum.dots : []).map((s) => { const d = h('i'); d.dataset.status = s; return d; }));
  ge.li.classList.toggle('alert', show && sum.waiting > 0);
}

// Inline rename of a group, as for terminals: Enter or leaving saves, Esc cancels.
function renameGroup(gid) {
  const ge = groupEls.get(gid);
  const g = groupById(gid);
  if (!ge || !g || ge.renaming) return;
  ge.renaming = true;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = g.name;
  input.maxLength = 80;
  input.setAttribute('aria-label', '그룹 이름');
  ge.name.replaceChildren(input);
  input.focus();
  input.select();
  let ready = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { ready = true; if (document.activeElement !== input) { input.focus(); input.select(); } }));
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    ge.renaming = false;
    if (save && input.value.trim()) { g.name = input.value.trim(); saveGroups(); }
    ge.name.textContent = g.name;
    renderList();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', () => { if (ready) finish(true); else input.focus(); });
}

// The group a terminal goes to when it is listed: its own (this run), the
// one asked for, else the shown terminal's or the first; a default group
// when there is none.
function placeItem(id, item, prefer = null) {
  let gid = (prefer && groupById(prefer) && prefer) || (groupById(groupOf[id]) && groupOf[id])
    || ViewLogic.newTerminalGroup(groups, groupOf, activeId);
  if (!gid) gid = addGroup(DEFAULT_GROUP);
  groupOf[id] = gid;
  saveGroupOf();
  groupEls.get(gid).list.appendChild(item);
}

function moveToGroup(id, gid) {
  const a = agents.get(id);
  const ge = groupEls.get(gid);
  if (!a || !ge) return;
  ge.list.appendChild(a.item);
  saveOrder();
}

function moveToNewGroup(id) {
  const at = groups.findIndex((g) => g.id === groupOf[id]) + 1;
  const gid = addGroup('새 그룹', at > 0 ? at : groups.length);
  moveToGroup(id, gid);
  renameGroup(gid);
}

// Removing a group: its terminals move to `target` (they are not closed).
function removeGroup(gid, target) {
  const ge = groupEls.get(gid);
  const into = groupEls.get(target);
  if (!ge) return;
  if (ge.list.children.length && !into) return;
  for (const li of [...ge.list.children]) into.list.appendChild(li);
  groups = groups.filter((g) => g.id !== gid);
  saveGroups();
  renderGroups();
  saveOrder();
}

function groupMenu(gid) {
  const others = groups.filter((g) => g.id !== gid);
  const hasTerminals = groupEls.get(gid)?.list.children.length > 0;
  const anyOpen = groups.some((g) => !g.collapsed);
  const target = ViewLogic.ungroupTarget(groups, gid);
  return [
    { label: '이 그룹에 새 터미널', action: () => newTerminal(gid) },
    { label: '이름 바꾸기', hint: 'F2', action: () => renameGroup(gid) },
    { label: anyOpen ? '모두 접기' : '모두 펼치기', action: () => { for (const g of groups) g.collapsed = anyOpen; saveGroups(); renderGroups(); } },
    { sep: true },
    !others.length ? { label: '그룹 해제', disabled: true, hint: '마지막 그룹' }
      : !hasTerminals ? { label: '그룹 해제', action: () => removeGroup(gid, null) }
        : { label: '그룹 해제: 터미널 옮길 곳', sub: others.map((g) => ({ label: g.name, hint: g.id === target ? '기본' : '', action: () => removeGroup(gid, g.id) })) },
  ];
}

function terminalMenu(id) {
  const others = groups.filter((g) => g.id !== groupOf[id]);
  return [
    { label: '그룹으로 이동', sub: [...others.map((g) => ({ label: g.name, action: () => moveToGroup(id, g.id) })), ...(others.length ? [{ sep: true }] : []), { label: '새 그룹…', action: () => moveToNewGroup(id) }] },
    { label: '이름 바꾸기', hint: 'F2', action: () => startRename(id) },
    { label: '터미널 닫기', hint: 'Ctrl+Shift+W', action: () => closeTerminal(id) },
  ];
}

// ---------- menu ----------
// A small popup menu: items { label, hint, action, sub: [items], disabled } or { sep: true }.
let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
}
function openMenu(x, y, items) {
  closeMenu();
  menuEl = h('div', 'menu-pop');
  menuEl.setAttribute('role', 'menu');
  const build = (list, parent, left, top) => {
    const m = list === items ? menuEl : h('div', 'menu-pop sub');
    for (const it of list) {
      if (it.sep) { m.append(h('div', 'menu-sep')); continue; }
      const row = h('button', 'menu-item');
      row.type = 'button';
      row.setAttribute('role', 'menuitem');
      row.disabled = Boolean(it.disabled);
      row.append(h('span', 'menu-label', it.label), h('span', 'menu-hint', it.sub ? '▸' : it.hint || ''));
      if (it.sub) {
        const open = () => {
          for (const s of m.querySelectorAll(':scope > .menu-pop.sub')) s.remove();
          const r = row.getBoundingClientRect();
          const sub = build(it.sub, m, r.right - 4, r.top - 4);
          m.append(sub);
          fit(sub);
        };
        row.addEventListener('mouseenter', open);
        row.addEventListener('click', (e) => { e.stopPropagation(); open(); });
      } else if (!it.disabled) {
        row.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.action(); });
        row.addEventListener('mouseenter', () => { for (const s of m.querySelectorAll(':scope > .menu-pop.sub')) s.remove(); });
      }
      m.append(row);
    }
    if (parent) { m.style.left = `${left}px`; m.style.top = `${top}px`; }
    return m;
  };
  const fit = (m) => {
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) m.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight - 4) m.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
  };
  build(items, null);
  menuEl.style.left = `${x}px`;
  menuEl.style.top = `${y}px`;
  document.body.append(menuEl);
  fit(menuEl);
  menuEl.querySelector('.menu-item:not(:disabled)')?.focus();
}
document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (menuEl && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

$('#group-add').addEventListener('click', () => renameGroup(addGroup('새 그룹')));
renderGroups();

// ---------- pipelines ----------
// A graph the user draws freely: nodes, each optionally bound to a terminal
// session whose state it shows live, and arrows between them. It shows how
// the user arranged their sessions and what each is doing; it implies no
// order of work and starts, advances or enforces nothing. With "Claude에게
// 알리기" on, each bound session's Claude is told its node, memo and the
// nodes one arrow away (pipeline-context.js says when). Pipelines (nodes,
// arrows, memos) are kept in localStorage; which terminal a node is bound to
// only for this run (sessionStorage), as terminal groups are.
const PIPE_KEY = 'pipelines';
const PIPE_CUR_KEY = 'pipelineCurrent';
const PIPE_BIND_KEY = 'pipelineBind';
const NODE_W = 168;
const NODE_H = 66;
// By ledStatus, plus none (no session bound) and ready (Claude started, no prompt yet).
const PIPE_STATE_LABEL = { none: '세션 없음', ready: '준비됨', shell: '셸', working: '작업 중', waiting: '승인 대기', error: '오류', idle: '끝남', exited: '종료됨' };
const readSession = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const writeSession = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* this run only */ } };
let pipelines = [];
try { pipelines = JSON.parse(readPref(PIPE_KEY, '[]')); } catch { pipelines = []; }
if (!Array.isArray(pipelines)) pipelines = [];
// The memo was saved as `prompt` before: same text, new key.
for (const p of pipelines) for (const n of p.nodes || []) if (n.memo === undefined && 'prompt' in n) { n.memo = n.prompt || ''; delete n.prompt; }
let pipeCur = readPref(PIPE_CUR_KEY, '');
const pipeBind = readSession(PIPE_BIND_KEY); // node id -> terminal id
const pipe = {
  view: 'terminal', editing: false, sel: null, selEdge: -1,
  els: {
    root: $('#pipeline'), title: $('#pipe-title'), pick: $('#pipe-pick'), edit: $('#pipe-edit'), editTools: $('#pipe-edit-tools'),
    add: $('#pipe-add'), delEdge: $('#pipe-del-edge'), done: $('#pipe-done'), canvas: $('#pipe-canvas'), world: $('#pipe-world'),
    edges: $('#pipe-edges'), nodes: $('#pipe-nodes'), props: $('#pipe-props'), empty: $('#pipe-empty'), strip: $('#pipe-strip'),
    notify: $('#pipe-notify'),
    switchBtns: [...document.querySelectorAll('#view-switch button')],
  },
};
const newPipeId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const savePipes = () => { writePref(PIPE_KEY, JSON.stringify(pipelines)); pipeRefresh(); };
const currentPipe = () => pipelines.find((p) => p.id === pipeCur) || pipelines[0] || null;
const boundTerminal = (nodeId) => (agents.has(pipeBind[nodeId]) ? pipeBind[nodeId] : null);

// The node's state: its session's light, or none.
function nodeState(n) {
  const tid = boundTerminal(n.id);
  if (!tid) return 'none';
  const { info } = agents.get(tid);
  const st = ledStatus(info);
  return st === 'shell' && info.claude && info.claude.session ? 'ready' : st;
}

function setView(view) {
  pipe.view = view;
  pipe.els.root.hidden = view !== 'pipeline';
  for (const b of pipe.els.switchBtns) b.setAttribute('aria-selected', String(b.dataset.view === view));
  if (view === 'pipeline') { renderPipeline(); pipe.els.root.focus(); } else { setPipeEditing(false); requestAnimationFrame(() => { fitActive(); agents.get(activeId)?.term.focus(); }); }
  renderStrip();
}

function setPipeEditing(on) {
  pipe.editing = on;
  pipe.sel = on ? pipe.sel : null;
  pipe.selEdge = -1;
  if (pipe.view === 'pipeline') renderPipeline();
}

// Re-drawn at most once a frame (session states change often).
let pipeFrame = 0;
function pipeRefresh() {
  if (pipeFrame) return;
  pipeFrame = requestAnimationFrame(() => {
    pipeFrame = 0;
    if (pipe.view === 'pipeline' && !pipe.dragging) renderPipeline();
    renderStrip();
    rememberSessions();
    syncPipelineContext();
  });
}

// Each node keeps the last Claude session of its terminal (saved with the
// pipeline), so it can be reopened after the app restarts (reopenSession).
function rememberSessions() {
  let changed = false;
  for (const p of pipelines) {
    for (const n of p.nodes) {
      const tid = boundTerminal(n.id);
      const s = tid && agents.get(tid).info.claude && agents.get(tid).info.claude.session;
      if (!s) continue;
      const saved = { id: s.id, name: s.name || null, cwd: s.cwd || null, wsl: s.wsl || null };
      if (JSON.stringify(n.claude) === JSON.stringify(saved)) continue;
      n.claude = saved;
      changed = true;
    }
  }
  if (changed) writePref(PIPE_KEY, JSON.stringify(pipelines));
}

// Whether the node's saved session is the one running in its terminal now.
const sessionOpen = (n) => {
  const tid = boundTerminal(n.id);
  const s = tid && agents.get(tid).info.claude && agents.get(tid).info.claude.session;
  return Boolean(s && n.claude && s.id === n.claude.id);
};

// A new terminal named after the node, in the saved session's WSL distro and
// folder, running claude --resume (as a "new terminal" shortcut runs), then
// bound to the node.
async function reopenSession(n) {
  const lines = ViewLogic.resumeLines(n.claude, api.platform);
  if (!lines.length) return;
  const tid = await typeShortcut({ newTerminal: true, name: n.name }, lines);
  if (tid && agents.has(tid)) bindNode(n.id, tid);
}

// Terminal id -> what its Claude is told: `auto` for pipelines with notify
// on, `demand` (the /omni:pipeline skill) for every bound node. To the main
// process only when changed; it decides what reaches Claude and when
// (pipeline-context.js).
let pipeContextKey = '';
function syncPipelineContext() {
  const sessionOf = (nodeId) => {
    const tid = boundTerminal(nodeId);
    if (!tid) return null;
    const c = agents.get(tid).info.claude;
    const s = c && c.session;
    return { claude: s && agents.get(tid).info.status !== 'exited' ? { id: s.id, name: s.name } : null };
  };
  const maps = { auto: {}, demand: {} };
  const add = (map, tid, text) => { if (text) map[tid] = map[tid] ? `${map[tid]}\n\n${text}` : text; };
  for (const p of pipelines) {
    for (const n of p.nodes) {
      const tid = boundTerminal(n.id);
      if (!tid) continue;
      if (p.notify) add(maps.auto, tid, ViewLogic.pipelineContext(p, n.id, sessionOf));
      add(maps.demand, tid, ViewLogic.pipelineContext(p, n.id, sessionOf, true));
    }
  }
  const key = JSON.stringify(maps);
  if (key === pipeContextKey) return;
  pipeContextKey = key;
  api.setPipelineContext(maps);
}

function renderPipeline() {
  const p = currentPipe();
  const { els } = pipe;
  if (!els.title.querySelector('input')) els.title.textContent = p ? p.name : '파이프라인'; // not while renaming
  els.notify.hidden = !p;
  els.notify.setAttribute('aria-checked', String(Boolean(p && p.notify)));
  els.edit.hidden = !p || pipe.editing;
  els.editTools.hidden = !pipe.editing;
  els.done.hidden = !pipe.editing;
  els.delEdge.hidden = pipe.selEdge < 0;
  els.root.classList.toggle('editing', pipe.editing);
  els.empty.hidden = Boolean(p);
  els.canvas.parentElement.hidden = !p;
  if (!p) { els.props.hidden = true; return; }
  const activeNodes = new Set(p.nodes.filter((n) => boundTerminal(n.id) === activeId).map((n) => n.id));
  // world size: the drawing plus room to grow
  const maxX = Math.max(0, ...p.nodes.map((n) => n.x + NODE_W)) + 240;
  const maxY = Math.max(0, ...p.nodes.map((n) => n.y + NODE_H)) + 200;
  els.world.style.width = `${maxX}px`;
  els.world.style.height = `${maxY}px`;
  els.edges.setAttribute('width', maxX);
  els.edges.setAttribute('height', maxY);

  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const defs = svg('defs', {});
  for (const [id, color] of [['pipe-arrow', '#8e95a5'], ['pipe-arrow-sel', '#e3e6ec']]) {
    const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
    m.append(svg('path', { d: 'M0 0L10 5L0 10z', fill: color }));
    defs.append(m);
  }
  const paths = [defs];
  p.edges.forEach((e, i) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    const d = edgePath(a, b);
    const sel = i === pipe.selEdge;
    paths.push(svg('path', { d, class: `pipe-edge${sel ? ' sel' : ''}`, 'marker-end': `url(#${sel ? 'pipe-arrow-sel' : 'pipe-arrow'})` }));
    if (pipe.editing) {
      const hit = svg('path', { d, class: 'pipe-edge-hit' });
      hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); pipe.selEdge = i; pipe.sel = null; renderPipeline(); });
      paths.push(hit);
    }
  });
  if (pipe.linking) paths.push(svg('path', { d: pipe.linking.d, class: 'pipe-edge linking' }));
  els.edges.replaceChildren(...paths);

  els.nodes.replaceChildren(...p.nodes.map((n) => {
    const st = nodeState(n);
    const tid = boundTerminal(n.id);
    const div = h('div', `pipe-node s-${st}${p.notify && n.off ? ' off' : ''}${activeNodes.has(n.id) ? ' on' : ''}${pipe.sel === n.id ? ' sel' : ''}`);
    div.dataset.id = n.id;
    div.style.left = `${n.x}px`;
    div.style.top = `${n.y}px`;
    const info = tid ? agents.get(tid).info : null;
    const label = `${PIPE_STATE_LABEL[st] || ''}${(st === 'working' || st === 'waiting') && info.claude.tool ? ` ${info.claude.tool}` : ''}${p.notify && n.off ? ' · 빠짐' : ''}`;
    // the session: its name, or its folder when it is named after the step
    const sessName = info ? displayName(info) : '';
    const sessText = !info ? '' : sessName === n.name ? (info.cwd || '').split(/[\\/]/).filter(Boolean).pop() || sessName : sessName;
    div.append(h('div', 'pn-name ellipsis', n.name), h('div', 'pn-sess ellipsis', sessText), h('div', 'pn-state ellipsis', label));
    const claudeName = info && info.claude && info.claude.session && info.claude.session.name;
    div.title = `${n.name}${info ? `\n터미널: ${displayName(info)}` : '\n세션 없음'}${claudeName ? `\nClaude 세션: ${claudeName}` : ''}${n.memo ? `\n메모: ${n.memo}` : ''}`;
    if (pipe.editing) {
      const handle = h('span', 'pn-handle');
      handle.title = '끌어서 다른 노드에 연결';
      handle.addEventListener('pointerdown', (ev) => startLink(ev, n));
      div.append(handle);
      div.addEventListener('pointerdown', (ev) => startDrag(ev, n, div));
    } else {
      div.addEventListener('click', () => openNode(n));
      div.addEventListener('contextmenu', (ev) => { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, nodeMenu(n)); });
    }
    return div;
  }));
  renderProps(p);
}

// From the side of `a` that faces `b` to the facing side of `b`: right to
// left when `b` lies to the right, bottom to top when it lies below (top to
// bottom above); a step back on the same row (a loop) bends below both.
function edgePath(a, b) {
  const cx = (n) => n.x + NODE_W / 2;
  const curve = (x1, y1, x2, y2, horiz) => {
    const d = Math.max(30, Math.abs(horiz ? x2 - x1 : y2 - y1) / 2);
    return horiz ? `M${x1} ${y1} C${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2 - 2} ${y2}`
      : `M${x1} ${y1} C${x1} ${y1 + Math.sign(y2 - y1) * d}, ${x2} ${y2 - Math.sign(y2 - y1) * d}, ${x2} ${y2 - Math.sign(y2 - y1) * 2}`;
  };
  if (b.x > a.x + NODE_W + 10) return curve(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2, true);
  if (b.y > a.y + NODE_H + 10) return curve(cx(a), a.y + NODE_H, cx(b), b.y, false);
  if (b.y + NODE_H + 10 < a.y) return curve(cx(a), a.y, cx(b), b.y + NODE_H, false);
  const low = Math.max(a.y, b.y) + NODE_H + 40;
  return `M${a.x + NODE_W / 2} ${a.y + NODE_H} C${a.x + NODE_W / 2} ${low}, ${b.x + NODE_W / 2} ${low}, ${b.x + NODE_W / 2} ${b.y + NODE_H + 2}`;
}

function openNode(n) {
  const tid = boundTerminal(n.id);
  if (tid) { select(tid); setView('terminal'); return; }
  pipe.sel = n.id;
  setPipeEditing(true);
  if (pipe.view !== 'pipeline') setView('pipeline'); // from the strip over the terminal
}

function nodeMenu(n) {
  const tid = boundTerminal(n.id);
  const p = currentPipe();
  return [
    { label: '세션으로 이동', disabled: !tid, action: () => openNode(n) },
    ...(n.claude && !sessionOpen(n) ? [{ label: 'Claude 세션 다시 열기', action: () => reopenSession(n) }] : []),
    ...(p && p.notify ? [{ label: n.off ? '알리기에 다시 넣기' : '알리기에서 잠시 빼기', action: () => setNodeOff(n, !n.off) }] : []),
    { sep: true },
    { label: '편집', action: () => { pipe.sel = n.id; setPipeEditing(true); } },
  ];
}

// ---------- editing ----------
function worldPoint(ev) {
  const r = pipe.els.world.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function startDrag(ev, n, div) {
  if (ev.button !== 0 || ev.target.classList.contains('pn-handle')) return;
  ev.preventDefault();
  const start = worldPoint(ev);
  const ox = n.x;
  const oy = n.y;
  let moved = false;
  pipe.dragging = true;
  const move = (e) => {
    const p = worldPoint(e);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true;
    n.x = Math.max(0, Math.round((ox + dx) / 10) * 10);
    n.y = Math.max(0, Math.round((oy + dy) / 10) * 10);
    div.style.left = `${n.x}px`;
    div.style.top = `${n.y}px`;
    redrawEdges();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    pipe.dragging = false;
    if (moved) savePipes();
    pipe.sel = n.id;
    pipe.selEdge = -1;
    renderPipeline();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Only the edges, while a node is dragged.
function redrawEdges() {
  const p = currentPipe();
  if (!p) return;
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const shown = [...pipe.els.edges.querySelectorAll('path.pipe-edge:not(.linking)')];
  const hits = [...pipe.els.edges.querySelectorAll('path.pipe-edge-hit')];
  let k = 0;
  p.edges.forEach((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    const d = edgePath(a, b);
    if (shown[k]) shown[k].setAttribute('d', d);
    if (hits[k]) hits[k].setAttribute('d', d);
    k++;
  });
}

function startLink(ev, from) {
  ev.preventDefault();
  ev.stopPropagation();
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const move = (e) => {
    const p = worldPoint(e);
    pipe.linking = { d: `M${x1} ${y1} L${p.x} ${p.y}` };
    const line = pipe.els.edges.querySelector('path.linking');
    if (line) line.setAttribute('d', pipe.linking.d);
    else renderPipeline();
  };
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    pipe.linking = null;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pipe-node');
    const p = currentPipe();
    const to = target && target.dataset.id;
    if (p && to && to !== from.id && !p.edges.some((x) => x.from === from.id && x.to === to)) {
      p.edges.push({ from: from.id, to });
      savePipes();
    }
    renderPipeline();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function renderProps(p) {
  const { props } = pipe.els;
  const n = pipe.editing && p.nodes.find((x) => x.id === pipe.sel);
  props.hidden = !n;
  if (!n) return;
  // Status updates redraw the graph while Claude works: keep what is being typed.
  if (props.dataset.node === n.id && props.contains(document.activeElement)) return;
  props.dataset.node = n.id;
  const name = h('input', 'pp-in');
  name.value = n.name;
  name.maxLength = 60;
  name.addEventListener('input', () => { n.name = name.value.trim() || '단계'; savePipes(); refreshNodeLabel(n); renderStrip(); });
  const sess = document.createElement('select');
  sess.className = 'pp-in';
  sess.append(new Option('없음', ''));
  for (const [tid, a] of agents) {
    const g = groupById(groupOf[tid]);
    sess.append(new Option(`${displayName(a.info)}${g ? ` (${g.name})` : ''}`, tid));
  }
  sess.append(new Option('＋ 새 터미널 열기', '__new'));
  sess.value = boundTerminal(n.id) || '';
  sess.addEventListener('change', async () => {
    if (sess.value === '__new') {
      pipe.keepView = true; // stay on the graph while binding the step
      const tid = await newTerminal().finally(() => { pipe.keepView = false; });
      if (!n.name.startsWith('새 ')) { agents.get(tid).info.name = n.name; api.rename(tid, n.name); renderItem(tid); }
      bindNode(n.id, tid);
    } else bindNode(n.id, sess.value || null);
    renderPipeline();
  });
  const memo = document.createElement('textarea');
  memo.className = 'pp-in';
  memo.rows = 4;
  memo.value = n.memo || '';
  memo.addEventListener('input', () => { n.memo = memo.value; savePipes(); });
  const notify = h('label', 'pp-check');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !n.off;
  box.addEventListener('change', () => setNodeOff(n, !box.checked));
  notify.append(box, 'Claude에게 알리기');
  notify.hidden = !p.notify;
  const del = h('button', 'btn pp-del', '노드 삭제');
  del.type = 'button';
  del.addEventListener('click', () => deleteNode(n.id));
  const field = (label, el) => { const l = h('label', 'pp-field'); l.append(h('span', null, label), el); return l; };
  props.replaceChildren(h('h4', 'pp-h', '노드'), field('이름', name), field('터미널', sess), claudeInfo(n), field('메모', memo), notify, del);
}

// The node's Claude session, read-only (selectable to copy), and a way to
// reopen it when it is not the one running in its terminal.
function claudeInfo(n) {
  const box = h('div', 'pp-claude');
  box.append(h('span', 'pp-label', 'Claude 세션'));
  if (!n.claude) { box.append(h('div', 'pp-ro muted', '아직 없음')); return box; }
  const row = (label, value, mono) => { const r = h('div', 'pp-ro-row'); r.append(h('span', 'pp-ro-k', label), h('span', `pp-ro${mono ? ' mono' : ''}`, value)); return r; };
  box.append(row('이름', n.claude.name || '—'), row('id', n.claude.id, true), row('폴더', `${n.claude.cwd || '—'}${n.claude.wsl ? ` (WSL ${n.claude.wsl})` : ''}`, true));
  if (sessionOpen(n)) box.append(h('div', 'pp-ro muted', '연결된 터미널에서 실행 중'));
  else {
    const open = h('button', 'vbtn pp-reopen', '이 세션 다시 열기');
    open.type = 'button';
    open.title = `새 터미널에서 실행: ${ViewLogic.resumeLines(n.claude, api.platform).join(' → ')}`;
    open.addEventListener('click', () => reopenSession(n));
    box.append(open);
  }
  return box;
}

// Takes a node out of "Claude에게 알리기" for a while, or puts it back.
function setNodeOff(n, off) {
  if (off) n.off = true; else delete n.off;
  savePipes();
  if (pipe.view === 'pipeline') renderPipeline();
}

function refreshNodeLabel(n) {
  const el = pipe.els.nodes.querySelector(`.pipe-node[data-id="${n.id}"] .pn-name`);
  if (el) el.textContent = n.name;
}

function bindNode(nodeId, tid) {
  if (tid) pipeBind[nodeId] = tid; else delete pipeBind[nodeId];
  writeSession(PIPE_BIND_KEY, pipeBind);
  for (const id of agents.keys()) renderItem(id);
  renderStrip();
  pipeRefresh();
}

function deleteNode(id) {
  const p = currentPipe();
  if (!p) return;
  p.nodes = p.nodes.filter((n) => n.id !== id);
  p.edges = p.edges.filter((e) => e.from !== id && e.to !== id);
  delete pipeBind[id];
  writeSession(PIPE_BIND_KEY, pipeBind);
  savePipes();
  pipe.sel = null;
  for (const tid of agents.keys()) renderItem(tid);
  renderPipeline();
  renderStrip();
}

function addNode() {
  const p = currentPipe();
  if (!p) return;
  const c = pipe.els.canvas;
  const k = p.nodes.length % 6;
  const n = { id: newPipeId(), name: '새 단계', x: Math.round((c.scrollLeft + 60 + k * 30) / 10) * 10, y: Math.round((c.scrollTop + 60 + k * 30) / 10) * 10, memo: '' };
  p.nodes.push(n);
  savePipes();
  pipe.sel = n.id;
  pipe.selEdge = -1;
  renderPipeline();
  pipe.els.props.querySelector('input')?.select();
}

function deleteSelectedEdge() {
  const p = currentPipe();
  if (!p || pipe.selEdge < 0) return;
  p.edges.splice(pipe.selEdge, 1);
  pipe.selEdge = -1;
  savePipes();
  renderPipeline();
  renderStrip();
}

// A new, empty pipeline, opened for editing with its name ready to type.
function createPipeline() {
  const p = { id: newPipeId(), name: '새 파이프라인', nodes: [], edges: [] };
  pipelines.push(p);
  pipeCur = p.id;
  writePref(PIPE_CUR_KEY, pipeCur);
  savePipes();
  pipe.sel = null;
  setPipeEditing(true);
  renderStrip();
  renamePipeline();
}

function renamePipeline() {
  const p = currentPipe();
  if (!p) return;
  const { title } = pipe.els;
  const input = h('input', 'rename');
  input.value = p.name;
  input.maxLength = 60;
  title.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim()) { p.name = input.value.trim(); savePipes(); }
    title.textContent = p.name;
    renderStrip();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function pipelineMenu() {
  const p = currentPipe();
  return [
    ...pipelines.map((x) => ({ label: x.name, hint: x.id === (p && p.id) ? '보는 중' : '', action: () => { pipeCur = x.id; writePref(PIPE_CUR_KEY, pipeCur); pipe.sel = null; setPipeEditing(false); renderStrip(); } })),
    ...(pipelines.length ? [{ sep: true }] : []),
    { label: '새 파이프라인', action: createPipeline },
    ...(p ? [
      { label: '이름 바꾸기', action: renamePipeline },
      { label: '이 파이프라인 삭제', action: () => {
        if (!window.confirm(`파이프라인 "${p.name}"을(를) 삭제할까요? 터미널은 그대로 둡니다.`)) return;
        pipelines = pipelines.filter((x) => x.id !== p.id);
        savePipes();
        pipeCur = pipelines[0] ? pipelines[0].id : '';
        writePref(PIPE_CUR_KEY, pipeCur);
        setPipeEditing(false);
        for (const id of agents.keys()) renderItem(id);
        renderStrip();
      } },
    ] : []),
  ];
}

// ---------- strip over the terminal ----------
// When the shown terminal is a step of the pipeline: the steps in flow order,
// the shown one marked. A step goes to its session; the name to the graph.
function renderStrip() {
  const { strip } = pipe.els;
  const p = currentPipe();
  const mine = p && activeId ? p.nodes.find((n) => boundTerminal(n.id) === activeId) : null;
  strip.hidden = !mine || pipe.view === 'pipeline';
  if (strip.hidden) return;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const title = h('button', 'strip-title', p.name);
  title.type = 'button';
  title.title = '파이프라인 보기 (Ctrl+Shift+G)';
  title.addEventListener('click', () => setView('pipeline'));
  const parts = [title];
  // No arrows here: neighbours in this line need not be linked in the graph.
  ViewLogic.pipelineOrder(p).forEach((id) => {
    const n = byId.get(id);
    const st = nodeState(n);
    const chip = h('button', `strip-chip s-${st}${boundTerminal(id) === activeId ? ' on' : ''}`);
    chip.type = 'button';
    chip.append(h('i'), n.name);
    chip.title = PIPE_STATE_LABEL[st] || '';
    chip.addEventListener('click', () => openNode(n));
    parts.push(chip);
  });
  strip.replaceChildren(...parts);
}

// The step names of a terminal (sidebar tag).
function nodeNamesOf(tid) {
  const p = currentPipe();
  return p ? p.nodes.filter((n) => pipeBind[n.id] === tid).map((n) => n.name) : [];
}

for (const b of pipe.els.switchBtns) b.addEventListener('click', () => setView(b.dataset.view));
pipe.els.edit.addEventListener('click', () => setPipeEditing(true));
pipe.els.notify.addEventListener('click', () => {
  const p = currentPipe();
  if (!p) return;
  p.notify = !p.notify;
  savePipes();
  renderPipeline();
});
pipe.els.done.addEventListener('click', () => setPipeEditing(false));
pipe.els.add.addEventListener('click', addNode);
pipe.els.delEdge.addEventListener('click', deleteSelectedEdge);
pipe.els.pick.addEventListener('click', () => { const r = pipe.els.pick.getBoundingClientRect(); openMenu(r.left, r.bottom + 2, pipelineMenu()); });
pipe.els.title.addEventListener('dblclick', renamePipeline);
pipe.els.canvas.addEventListener('pointerdown', (e) => {
  if (!pipe.editing || e.target.closest('.pipe-node, .pipe-edge-hit')) return;
  pipe.sel = null;
  pipe.selEdge = -1;
  renderPipeline();
});
$('#pipe-create').addEventListener('click', createPipeline);
document.addEventListener('keydown', (e) => {
  if (pipe.view !== 'pipeline' || e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') { e.stopPropagation(); if (pipe.editing) setPipeEditing(false); else setView('terminal'); }
  if (pipe.editing && (e.key === 'Delete' || e.key === 'Backspace') && pipe.selEdge >= 0) { e.preventDefault(); deleteSelectedEdge(); }
});

// ---------- reorder ----------
// Drag a terminal in the sidebar, or Ctrl+Shift+PageUp/PageDown (Alt+Up/Down
// on a focused row). The main process keeps the order for page reloads.
let dragId = null;

// The sidebar is the order: groups one after another, and a terminal's group
// is the one it sits in.
function syncOrder() {
  const items = [...els.list.querySelectorAll('li.agent')].filter((li) => agents.has(li.dataset.id));
  for (const li of items) groupOf[li.dataset.id] = li.closest('li.group')?.dataset.gid;
  saveGroupOf();
  const reordered = new Map(items.map((li) => [li.dataset.id, agents.get(li.dataset.id)]));
  agents.clear();
  for (const [id, a] of reordered) agents.set(id, a);
  return items.map((li) => li.dataset.id);
}

function saveOrder() {
  api.reorder(syncOrder());
  renderList();
}

function moveTerminal(id, delta) {
  const li = agents.get(id)?.item;
  if (!li) return;
  // Within its group.
  if (delta < 0 && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
  else if (delta > 0 && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
  else return;
  saveOrder();
}

function clearDropMarks() {
  for (const el of els.list.querySelectorAll('.drop-before, .drop-after, .group-head.drop')) el.classList.remove('drop-before', 'drop-after', 'drop');
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
    item.parentNode.insertBefore(moving, after ? item.nextSibling : item);
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
  if (id === activeId && 'cwd' in patch && patch.cwd !== a.info.cwd) { loadConfig(); loadGit(); loadTree(); setTimeout(syncPreview, 0); } // new project
  Object.assign(a.info, patch);
  renderItem(id);
  if (id === activeId && 'claude' in patch) renderCtxDetail();
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

// ---------- drag handles ----------
// The borders between areas. `start` runs on pointerdown and returns
// { move(ev), end(ev) }; end gets the last pointer position, also when the
// drag is cancelled (e.g. the window loses the pointer).
function dragResize(handle, bodyClass, start) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add(bodyClass);
    const { move, end } = start();
    let last = e;
    const onMove = (ev) => { last = ev; move(ev); };
    const finish = (ev) => {
      if (ev.type === 'pointerup') last = ev;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      document.body.classList.remove(bodyClass);
      end(last);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
}

// ---------- side panel widths ----------
// The sidebar (left) and the inspector (right) each have a chosen width, but
// the terminal always keeps MIN_TERMINAL_W: a panel being dragged stops at
// that limit, and a narrower window shrinks the inspector first, then the
// sidebar, without changing the chosen widths.
const app = document.querySelector('.app');
const SIDEBAR = { def: 300, min: 200, max: 600 };
const INSPECTOR = { def: 320, min: 240, max: 640 };
const MIN_TERMINAL_W = 360;
const clampTo = (lim, w) => {
  const n = Number(w);
  return Math.round(Math.min(lim.max, Math.max(lim.min, Number.isFinite(n) && w !== '' ? n : lim.def)));
};
const panelW = {
  sidebar: clampTo(SIDEBAR, readPref('sidebarWidth', SIDEBAR.def)),
  inspector: clampTo(INSPECTOR, readPref('inspectorWidth', INSPECTOR.def)),
};
const shownW = { ...panelW };
const sidebarOpen = () => !app.classList.contains('collapsed');
const inspectorOpen = () => !app.classList.contains('inspector-closed');

function applyPanelWidths() {
  let side = sidebarOpen() ? panelW.sidebar : 0;
  let insp = inspectorOpen() ? panelW.inspector : 0;
  let over = side + insp + MIN_TERMINAL_W - window.innerWidth;
  if (over > 0 && insp) { const cut = Math.min(over, insp - INSPECTOR.min); insp -= cut; over -= cut; }
  if (over > 0 && side) side -= Math.min(over, side - SIDEBAR.min);
  if (side) shownW.sidebar = side;
  if (insp) shownW.inspector = insp;
  document.documentElement.style.setProperty('--sidebar-w', `${shownW.sidebar}px`);
  document.documentElement.style.setProperty('--inspector-w', `${shownW.inspector}px`);
  requestAnimationFrame(fitActive);
}

// A new chosen width for one panel, limited by the other one as shown now.
function setPanelWidth(which, w, save) {
  const lim = which === 'sidebar' ? SIDEBAR : INSPECTOR;
  const otherOpen = which === 'sidebar' ? inspectorOpen() : sidebarOpen();
  const other = otherOpen ? shownW[which === 'sidebar' ? 'inspector' : 'sidebar'] : 0;
  const room = window.innerWidth - MIN_TERMINAL_W - other;
  panelW[which] = Math.max(lim.min, Math.min(clampTo(lim, w), Math.floor(room)));
  if (save) writePref(which === 'sidebar' ? 'sidebarWidth' : 'inspectorWidth', panelW[which]);
  applyPanelWidths();
}

window.addEventListener('resize', applyPanelWidths);

// ---------- sidebar width and collapse ----------
// Drag the sidebar's right edge (double-click: default width), or collapse it
// with the top-bar button / Ctrl+Shift+B. Both are remembered.
const sidebarToggle = $('#sidebar-toggle');
const resizer = $('#sidebar-resizer');

function setSidebarWidth(w, save = true) {
  setPanelWidth('sidebar', w, save);
}

function setSidebarCollapsed(on) {
  app.classList.toggle('collapsed', on);
  sidebarToggle.setAttribute('aria-pressed', String(on));
  writePref('sidebarCollapsed', on);
  applyPanelWidths();
}

dragResize(resizer, 'resizing', () => {
  const left = app.getBoundingClientRect().left;
  return {
    move: (ev) => setSidebarWidth(ev.clientX - left, false),
    end: (ev) => setSidebarWidth(ev.clientX - left),
  };
});
resizer.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR.def));
sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!app.classList.contains('collapsed'));
  agents.get(activeId)?.term.focus();
});
setSidebarCollapsed(readPref('sidebarCollapsed', 'false') === 'true');

// ---------- shortcuts ----------
// A saved list of two kinds. A command shortcut types its lines into a
// terminal, one line at a time: each line waits until the previous one's
// output has settled.
// A line that enters WSL (`wsl -d Ubuntu`) waits longer: until the shell
// inside reports in (its first prompt), since WSL may start silently for
// seconds and a line typed before its shell exists is lost. A new terminal
// likewise waits for its shell's first report. Works the same on Windows,
// WSL and Linux because it is just typing.
// A prompt shortcut sends its text as one message to the Claude running in
// the shown terminal (see sendPrompt). Shortcuts saved before kinds existed
// have no `kind` and are commands.
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

// When each terminal's shell last reported in (its prompt's folder). Kept
// apart from `agents`: a new terminal's first report may come before it is
// listed.
const shellSeen = new Map();

// Resolves once terminal `id`'s shell is ready for the next line after one
// sent at `sentAt` (view-logic.js shellReady), or after `maxMs` anyway.
async function waitShell(id, sentAt, { lateMs = 500, maxMs = 30000 } = {}) {
  for (;;) {
    const a = agents.get(id);
    if (!a) return; // closed meanwhile
    const now = Date.now();
    const b = a.term.buffer.active;
    const cursorLine = b.getLine(b.baseY + b.cursorY);
    const prompt = ViewLogic.promptLike(cursorLine ? cursorLine.translateToString(false).slice(0, b.cursorX) : '');
    if (ViewLogic.shellReady({ reportAt: shellSeen.get(id) || 0, lastDataAt: a.lastDataAt || 0, sentAt, now, prompt, lateMs })) return;
    if (now - sentAt >= maxMs) return;
    await sleep(100);
  }
}

const runningShortcuts = new Set(); // a second click while one runs is ignored

async function runShortcut(sc) {
  const lines = sc.command.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length || runningShortcuts.has(sc.id)) return;
  runningShortcuts.add(sc.id);
  try {
    if (sc.kind === 'prompt') await sendPrompt(sc);
    else await typeShortcut(sc, lines);
  } finally {
    runningShortcuts.delete(sc.id);
  }
}

// A prompt goes only to a Claude ready for input (ViewLogic.promptBlock: not
// a plain shell, not an open approval dialog). ViewLogic.promptInput makes it one message
// (pasted when the program has bracketed paste on, as Claude's input does).
// Enter follows separately, as sendLine does: text and Enter in one write
// can be taken as a paste and not sent.
async function sendPrompt(sc) {
  const id = activeId;
  const a = agents.get(id);
  const block = a ? ViewLogic.promptBlock(a.info) : 'no-claude';
  if (block) {
    shortcutNotice(sc.id, block === 'waiting' ? 'Claude가 승인을 기다리는 중이라 보내지 않음' : '이 터미널에 Claude가 없어 보내지 않음');
    return;
  }
  api.write(id, ViewLogic.promptInput(sc.command, a.term.modes.bracketedPasteMode));
  await sleep(120);
  api.write(id, '\r');
  a.term.focus();
}

// A short message in place of a shortcut's second line.
const scNotices = new Map(); // id -> text
function shortcutNotice(id, text) {
  scNotices.set(id, text);
  renderShortcuts();
  setTimeout(() => { if (scNotices.get(id) === text) { scNotices.delete(id); renderShortcuts(); } }, 2500);
}

// Kind icons: a terminal for commands, a speech bubble for prompts.
const SC_ICONS = {
  command: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor"/><path d="M4 6l2.5 2L4 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  prompt: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 11.5H7l-3.5 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z" fill="currentColor"/><path d="M4.5 6h7M4.5 8.5h4.5" stroke="var(--bg)" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

async function typeShortcut(sc, lines) {
  let id = activeId;
  if (sc.newTerminal || !id) {
    const opened = Date.now();
    id = await newTerminal();
    if (sc.name) { agents.get(id).info.name = sc.name; api.rename(id, sc.name); renderItem(id); }
    await waitShell(id, opened - 1, { lateMs: 0, maxMs: 15000 }); // first prompt
    await waitQuiet(id, 300);
  }
  for (const line of lines) {
    if (!agents.has(id)) return;
    const sent = Date.now();
    api.sendLine(id, line);
    if (ViewLogic.entersWsl(line)) {
      // While wsl runs, the shell outside does not prompt: a report now is
      // the WSL shell's (or that of a wsl that failed at once).
      await waitShell(id, sent);
      await waitQuiet(id, 300);
    } else {
      await waitQuiet(id);
    }
  }
  agents.get(id)?.term.focus();
  return id;
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
    const prompt = sc.kind === 'prompt';
    const notice = scNotices.get(sc.id);
    const meta = h('span', 'shortcut-meta');
    const sub = h('div', `shortcut-cmd ellipsis${prompt ? ' prompt' : ''}${notice ? ' notice' : ''}`, notice || (more > 0 ? `${first}  (+${more})` : first));
    meta.append(h('div', 'shortcut-name ellipsis', sc.name), sub);
    const edit = h('button', 'shortcut-btn', '✎');
    edit.title = '편집';
    const del = h('button', 'shortcut-btn', '✕');
    del.title = '삭제';
    const icon = h('span', `shortcut-icon${!prompt && sc.newTerminal ? ' new' : ''}`);
    icon.dataset.kind = prompt ? 'prompt' : 'command';
    icon.innerHTML = SC_ICONS[icon.dataset.kind];
    icon.title = prompt ? '프롬프트: 현재 터미널의 Claude에게 보냄' : sc.newTerminal ? '명령: 새 터미널에서 실행' : '명령: 현재 터미널에서 실행';
    li.append(icon, meta, edit, del);
    li.title = `${icon.title}\n${sc.command}`;
    li.addEventListener('click', () => runShortcut(sc));
    li.addEventListener('keydown', (e) => {
      if (e.target !== li) return;
      if (e.key === 'Enter') runShortcut(sc);
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveShortcut(sc.id, e.key === 'ArrowUp' ? -1 : 1); }
    });
    if (!editingThis) enableShortcutDrag(li, sc.id);
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

// Order: drag an item, or Alt+Up/Down on a focused one (as terminals).
let scDragId = null;

function moveShortcut(id, delta) {
  const i = shortcuts.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= shortcuts.length) return;
  [shortcuts[i], shortcuts[j]] = [shortcuts[j], shortcuts[i]];
  saveShortcuts();
  renderShortcuts();
  scEls.list.querySelector(`li.shortcut[data-id="${CSS.escape(id)}"]`)?.focus();
}

function enableShortcutDrag(li, id) {
  li.dataset.id = id;
  li.draggable = true;
  const clear = () => { for (const el of scEls.list.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after'); };
  li.addEventListener('dragstart', (e) => {
    scDragId = id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  });
  li.addEventListener('dragend', () => { scDragId = null; li.classList.remove('dragging'); clear(); });
  li.addEventListener('dragover', (e) => {
    if (!scDragId || scDragId === id) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    clear();
    li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const after = li.classList.contains('drop-after');
    clear();
    const moving = shortcuts.find((x) => x.id === scDragId);
    if (!moving || scDragId === id) return;
    const rest = shortcuts.filter((x) => x !== moving);
    rest.splice(rest.findIndex((x) => x.id === id) + (after ? 1 : 0), 0, moving);
    shortcuts = rest;
    saveShortcuts();
    renderShortcuts();
  });
}

function openShortcutForm(sc) {
  editingShortcut = sc ? sc.id : 'new';
  const f = scEls.form.elements;
  f.name.value = sc ? sc.name : '';
  f.command.value = sc ? sc.command : '';
  fitCommandBox();
  f.newTerminal.checked = sc ? sc.newTerminal : true;
  f.kind.value = sc && sc.kind === 'prompt' ? 'prompt' : 'command';
  syncShortcutKind();
  scEls.form.hidden = false;
  renderShortcuts();
  f.name.focus({ preventScroll: true });
  // The whole form, down to its buttons, in view inside the shortcuts area.
  scEls.form.scrollIntoView({ block: 'nearest' });
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

// The form follows the kind: a prompt always goes to the shown terminal.
function syncShortcutKind() {
  const f = scEls.form.elements;
  const prompt = f.kind.value === 'prompt';
  scEls.form.querySelector('.sc-new').hidden = prompt;
  f.command.placeholder = prompt
    ? 'Claude에게 보낼 프롬프트\n예) 코드 검토 진행해줘. 작업에 지장 있는 것만'
    : '한 줄에 명령 하나\n예) wsl ~\n    cd sample-app\n    tmux attach -t sample';
}
for (const r of scEls.form.querySelectorAll('input[name="kind"]')) r.addEventListener('change', syncShortcutKind);

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
    kind: f.kind.value === 'prompt' ? 'prompt' : 'command',
    newTerminal: f.kind.value !== 'prompt' && f.newTerminal.checked,
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
    activeMatchBackground: '#8a5a12', // as the file viewer's current match
    activeMatchBorder: '#e9b44c',
    activeMatchColorOverviewRuler: '#e9b44c',
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
  ['hooks', '훅', (x) => [`${x.event}${x.matcher ? ` (${x.matcher})` : ''}`, x.omni ? 'Omni' : x.source, `${x.type}: ${x.target}`]],
  ['agents', '서브에이전트', (x) => [x.name, x.source, x.description]],
  ['mcp', 'MCP 서버', (x) => [x.name, x.source, `${x.type}: ${x.description}`]],
];
let cfgTimer = null;
let cfgStale = true; // skipped while hidden; read when the tab opens
let lastConfigAt = 0;
let cfgOpen = {};
try { cfgOpen = JSON.parse(readPref('cfgOpen', '{"skills":true}')); } catch { cfgOpen = { skills: true }; }

function loadConfig(delay = 150) {
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(async () => {
    const id = activeId;
    if (!id || !api.claudeConfig || !configVisible()) { cfgStale = true; return; }
    cfgStale = false;
    let data = null;
    try { data = await api.claudeConfig(id); } catch { data = null; }
    lastConfigAt = Date.now();
    if (id === activeId) renderConfig(data, id); // null shows '읽을 수 없습니다', not the previous list
  }, delay);
}

let cfgFor = null; // the terminal the shown config belongs to

function renderConfig(data, id = activeId) {
  cfgFor = id;
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
      if (x.file) {
        // Its file (SKILL.md, agent or command file, settings, README) in the viewer.
        li.classList.add('has-file');
        li.title += `\n\n${x.file}\n클릭: 파일 보기`;
        li.addEventListener('click', () => openConfigFile(cfgFor, x.file));
      }
      ul.append(li);
    }
    d.append(ul);
    return d;
  }));
}

cfgEls.refresh.addEventListener('click', () => {
  if (inspectorTab === 'git') loadGit(0);
  else if (inspectorTab === 'files') loadTree(0, true);
  else if (inspectorTab === 'review') loadReview();
  else loadConfig(0);
});
// Coming back to the window: re-read, but not more than every 5s (the scan
// is synchronous file I/O in the main process, slow over \\wsl.localhost).
window.addEventListener('focus', () => { if (Date.now() - lastConfigAt > 5000) loadConfig(); });

// ---------- inspector: activity | Claude config ----------
// The right panel. Ctrl+Shift+I or the top-bar button opens and closes it;
// its left edge sets the width (double-click: default). The open state, the
// tab and the width are remembered.
const insp = {
  tabs: [...document.querySelectorAll('.inspector-head .tab')],
  bodies: [...document.querySelectorAll('.tab-body')],
  toggle: $('#inspector-toggle'),
  resizer: $('#inspector-resizer'),
  ctx: $('#ctx-detail'),
  list: $('#activity-list'),
  empty: $('#activity-empty'),
};
let inspectorTab = ['config', 'git', 'files', 'review'].includes(readPref('inspectorTab', 'activity')) ? readPref('inspectorTab', 'activity') : 'activity';

function configVisible() {
  return !app.classList.contains('inspector-closed') && inspectorTab === 'config';
}

function setInspectorOpen(on) {
  if (!on) hideCard();
  app.classList.toggle('inspector-closed', !on);
  insp.toggle.setAttribute('aria-pressed', String(on));
  writePref('inspectorOpen', on);
  if (on && inspectorTab === 'config' && cfgStale) loadConfig(0);
  if (on && inspectorTab === 'git' && gitStale) loadGit(0);
  if (on && inspectorTab === 'files' && treeStale) loadTree(0);
  applyPanelWidths();
  syncPreview();
}

function setInspectorTab(tab) {
  hideCard();
  inspectorTab = tab;
  if (tab !== 'preview') writePref('inspectorTab', tab); // the preview tab exists only in a narrow window
  for (const t of insp.tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  for (const b of insp.bodies) b.hidden = b.dataset.tab !== tab;
  cfgEls.refresh.hidden = tab === 'activity';
  if (tab === 'config' && cfgStale) loadConfig(0);
  if (tab === 'git' && gitStale) loadGit(0);
  if (tab === 'files' && treeStale) loadTree(0);
  if (tab === 'review') loadReview();
  syncPreview();
}

function setInspectorWidth(w, save = true) {
  setPanelWidth('inspector', w, save);
}

for (const t of insp.tabs) t.addEventListener('click', () => setInspectorTab(t.dataset.tab));
insp.toggle.addEventListener('click', () => {
  setInspectorOpen(app.classList.contains('inspector-closed'));
  agents.get(activeId)?.term.focus();
});
dragResize(insp.resizer, 'resizing', () => {
  const right = app.getBoundingClientRect().right;
  return {
    move: (ev) => setInspectorWidth(right - ev.clientX, false),
    end: (ev) => setInspectorWidth(right - ev.clientX),
  };
});
insp.resizer.addEventListener('dblclick', () => setInspectorWidth(INSPECTOR.def));

// Context use of the main session and of every agent the sidebar lists
// under it, in the same order; an unknown one shows "—" with the reason.
function renderCtxDetail() {
  const c = agents.get(activeId)?.info.claude || {};
  const rows = [];
  if (c.context) rows.push(['메인', c.context, true, null]);
  for (const ag of c.agents || []) rows.push([agentName(ag), ag.context || null, false, ag]);
  if (!c.status && !(c.agents || []).length) { insp.ctx.replaceChildren(); return; }
  if (!c.context && c.status) rows.unshift(['메인', null, true, { main: true }]);
  insp.ctx.replaceChildren(h('h2', 'inspector-h', '컨텍스트'), ...rows.map(([who, ctx, lead, ag]) => {
    const row = h('div', `ctx-row${lead ? ' lead' : ''}${ctx ? '' : ' unknown'}`);
    const bar = h('span', 'ctx-bar');
    const fill = h('span', 'ctx-fill');
    bar.append(fill);
    if (ctx) {
      row.dataset.level = contextLevel(ctx.pct);
      row.title = contextTitle(ctx);
      fill.style.width = `${ctx.pct}%`;
    } else {
      row.title = noContextWhy(ag);
      fill.style.width = '0'; // an empty bar, not a full one
    }
    row.append(h('span', 'ctx-who ellipsis', who), bar,
      h('span', 'ctx-num', ctx ? `${ctx.pct}% ${kTokens(ctx.tokens)}/${kTokens(ctx.window)}` : '—'));
    return row;
  }));
}

// A file under the terminal's folder is shown relative to it (the name stays
// visible in a narrow panel); the full path is in the tooltip.
function shortPath(file, cwd) {
  const base = (cwd || '').replace(/[\\/]+$/, '');
  if (base && file.length > base.length + 1 && file.startsWith(base) && /[\\/]/.test(file[base.length])) {
    return file.slice(base.length + 1);
  }
  return file;
}

const ACT_LABEL = { prompt: '프롬프트', done: '완료', wait: '대기', error: '오류', agent: '에이전트', idle: '팀원' };
const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);

function activityRow(id, e) {
  const li = h('li', 'act');
  li.dataset.kind = e.kind;
  li.dataset.n = String(e.n);
  const label = e.tool || ACT_LABEL[e.kind] || e.kind;
  const text = h('span', 'act-text');
  if (e.who) text.append(h('span', 'act-who', e.file || e.text ? `${e.who}: ` : e.who));
  if (e.file) {
    text.append(fileLink(id, e.file, shortPath(e.file, agents.get(id)?.info.cwd), e));
  } else {
    text.append(document.createTextNode(e.text || ''));
  }
  if (e.kind === 'fail' && e.error) text.append(h('span', 'act-error', ` — ${e.error}`));
  li.append(h('span', 'act-time', hhmmss(e.at)), h('span', 'act-tool', label), text);
  li.addEventListener('mouseenter', () => cardHover(id, e.n, li));
  li.addEventListener('mouseleave', () => cardLeave());
  return li;
}

// A file path that opens the file in the viewer (with the change of `entry`).
function fileLink(id, file, label = file, entry = null) {
  const f = h('span', 'act-file', label);
  f.title = `${file}\n클릭: 보기`;
  f.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openActivityFile(id, file, entry);
  });
  return f;
}

// ---------- activity detail card ----------
// Hovering a line shows everything Claude sent for it beside the panel:
// the whole prompt, command, edit diff, tool output or error. The card stays
// while the pointer is on it, so its text can be selected and copied.
const card = h('div', 'act-card');
card.hidden = true;
card.setAttribute('role', 'tooltip');
document.body.append(card);
let cardAt = null; // { id, n, li }
let cardTimer = null;

const asText = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function cardSec(title, body, cls = '') {
  const sec = h('div', 'card-sec');
  sec.append(h('div', 'card-h', title));
  sec.append(typeof body === 'string' ? h('pre', `card-pre ${cls}`.trim(), body) : body);
  return sec;
}

// Diff lines as colored rows (kinds from view-logic.js).
function diffPre(lines) {
  const pre = h('pre', 'card-pre diff');
  const kinds = ViewLogic.diffKinds(lines);
  lines.forEach((l, k) => pre.append(h('span', `d-${kinds[k]}`, l || ' '))); // block spans: one line each
  return pre;
}

// What an edit changed: the patch in the result, else the input's strings.
function editLines(tool, input, result) {
  const r = result && typeof result === 'object' ? result : {};
  if (Array.isArray(r.structuredPatch) && r.structuredPatch.length) {
    return r.structuredPatch.flatMap((hk) => [
      `@@ -${hk.oldStart},${hk.oldLines} +${hk.newStart},${hk.newLines} @@`,
      ...(Array.isArray(hk.lines) ? hk.lines.map(String) : []),
    ]);
  }
  if (r.gitDiff && typeof r.gitDiff.patch === 'string') return r.gitDiff.patch.split('\n');
  // An empty side (a new file, a notebook cell) adds no line.
  const side = (text, mark) => (text ? String(text).split('\n').map((x) => `${mark}${x}`) : []);
  const pair = (o, n) => [...side(o, '-'), ...side(n, '+')];
  if (tool === 'Edit') return pair(input.old_string, input.new_string);
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) return input.edits.flatMap((x, k) => [`@@ ${k + 1}번째 수정 @@`, ...pair(x.old_string, x.new_string)]);
  if (tool === 'Write' && typeof input.content === 'string') return input.content.split('\n').map((x) => `+${x}`);
  if (tool === 'NotebookEdit') return pair('', input.new_source);
  return null;
}

function cardBody(id, e) {
  const d = e.detail || {};
  const i = d.input && typeof d.input === 'object' ? d.input : {};
  const r = e.result;
  const out = [];
  const tool = e.tool || '';
  if (e.kind === 'prompt') out.push(cardSec('프롬프트', asText(d.prompt || e.text)));
  else if (e.kind === 'error') out.push(cardSec('오류', asText(d.error || e.text), 'err'));
  else if (e.kind === 'wait' && d.message) out.push(cardSec('알림', asText(d.message)));
  else if (['tool', 'fail', 'wait'].includes(e.kind) && d.input !== undefined) {
    if (e.file) {
      const row = h('div', 'card-file');
      row.append(fileLink(id, e.file, e.file, e));
      out.push(row);
    }
    if (tool === 'Bash') {
      out.push(cardSec('명령', asText(i.command)));
      if (i.description) out.push(cardSec('설명', asText(i.description)));
      if (r && typeof r === 'object' && !r.omitted && !r.empty) {
        if (r.stdout) out.push(cardSec('출력', asText(r.stdout)));
        if (r.stderr) out.push(cardSec('오류 출력', asText(r.stderr), 'err'));
        if (!r.stdout && !r.stderr) out.push(h('div', 'card-note', '출력 없음'));
        if (r.interrupted) out.push(h('div', 'card-note err', '중단됨'));
      }
    } else if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) {
      const lines = editLines(tool, i, r);
      if (lines) out.push(cardSec(tool === 'Write' && !(r && r.structuredPatch) ? '내용' : '변경', diffPre(lines)));
    } else if (tool === 'Read') {
      const range = [i.offset && `${i.offset}행부터`, i.limit && `${i.limit}행`].filter(Boolean).join(' ');
      const f = r && r.file && typeof r.file === 'object' ? r.file : null;
      const got = f && f.numLines != null ? `${f.numLines}행 읽음${f.totalLines ? ` (전체 ${f.totalLines}행)` : ''}` : '';
      if (range || got) out.push(h('div', 'card-note', [range, got].filter(Boolean).join(', ')));
    } else if (tool === 'Grep' || tool === 'Glob') {
      const cond = ['pattern', 'path', 'glob', 'type', 'output_mode'].filter((k) => i[k] != null).map((k) => `${k}: ${asText(i[k])}`);
      out.push(cardSec('조건', cond.join('\n')));
      if (r && typeof r === 'object') {
        if (r.numFiles != null) out.push(h('div', 'card-note', `파일 ${r.numFiles}개${r.truncated ? ' (일부)' : ''}`));
        if (r.content) out.push(cardSec('결과', asText(r.content)));
        else if (Array.isArray(r.filenames) && r.filenames.length) out.push(cardSec('파일', r.filenames.map(asText).join('\n')));
      }
    } else if (tool === 'Agent' || tool === 'Task') {
      if (i.subagent_type) out.push(h('div', 'card-note', `에이전트: ${asText(i.subagent_type)}`));
      if (i.description) out.push(cardSec('설명', asText(i.description)));
      if (i.prompt) out.push(cardSec('맡긴 일', asText(i.prompt)));
      const said = r && Array.isArray(r.content) ? r.content.map((c) => (c && c.text) || '').join('\n').trim() : '';
      if (said) out.push(cardSec('결과', said));
    } else {
      if (Object.keys(i).length) out.push(cardSec('입력', asText(i)));
      if (r !== undefined && !(r && (r.omitted || r.empty))) out.push(cardSec('결과', asText(r)));
    }
    if (r && r.omitted) out.push(h('div', 'card-note', '결과가 너무 커서 받지 않았습니다'));
    else if (r && r.empty) out.push(h('div', 'card-note', '결과 없음'));
    else if (e.kind === 'tool' && r === undefined && tool) out.push(h('div', 'card-note', '결과 기다리는 중'));
  }
  if (e.kind === 'fail' && (d.error || e.error)) out.push(cardSec('오류', asText(d.error || e.error), 'err'));
  return out;
}

function renderCard() {
  if (!cardAt) return;
  const a = agents.get(cardAt.id);
  const e = a && a.activity.find((x) => x.n === cardAt.n);
  const body = e ? cardBody(cardAt.id, e) : [];
  if (!e || !body.length || !cardAt.li.isConnected) { hideCard(); return; }
  const head = h('div', 'card-head');
  head.append(h('span', 'act-time', hhmmss(e.at)), h('span', 'act-tool', e.tool || ACT_LABEL[e.kind] || e.kind));
  if (e.who) head.append(h('span', 'act-who', e.who));
  card.dataset.kind = e.kind;
  card.replaceChildren(head, ...body);
  card.hidden = false;
  // Beside the panel, over the terminal; on the panel itself when there is no room.
  const panel = $('#inspector').getBoundingClientRect();
  const row = cardAt.li.getBoundingClientRect();
  const room = panel.left - 16;
  const width = room >= 300 ? Math.min(560, room) : panel.width - 16;
  card.style.width = `${width}px`;
  card.style.left = `${room >= 300 ? panel.left - width - 8 : panel.left + 8}px`;
  const top = Math.max(8, Math.min(row.top - 6, window.innerHeight - card.offsetHeight - 8));
  card.style.top = `${top}px`;
}

function cardHover(id, n, li) {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { cardAt = { id, n, li }; renderCard(); }, cardAt ? 80 : 300);
}

function cardLeave() {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(hideCard, 250);
}

function hideCard() {
  clearTimeout(cardTimer);
  cardAt = null;
  card.hidden = true;
}

card.addEventListener('mouseenter', () => clearTimeout(cardTimer));
card.addEventListener('mouseleave', () => cardLeave());
// Esc closes the card first, then the viewer (view-logic.js escapeAction).
// Typed into a terminal or a text field it still reaches it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const t = e.target instanceof Element ? e.target : null;
  const inField = Boolean(t && (t.closest('.term') || t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')));
  const act = ViewLogic.escapeAction({
    cardOpen: !card.hidden, viewerOpen: Boolean(viewing), inField,
    findOpen: !vfind.bar.hidden, inFind: Boolean(t && t.closest('#viewer-find')),
  });
  if (act.hideCard) hideCard();
  if (act.closeFind) closeViewerFind();
  if (act.closeViewer) closeViewer();
  if (!act.consume) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// ---------- file viewer ----------
// Over the terminal: a change as a diff, or the file itself with line
// numbers, read by the main process (WSL files through \\wsl.localhost, so no
// editor is needed). Copy the path, show it in the file manager, or open it
// in VS Code when that is installed.
const viewer = {
  el: $('#viewer'), path: $('#viewer-path'), tabs: $('#viewer-tabs'), info: $('#viewer-info'), body: $('#viewer-body'),
  copy: $('#viewer-copy'), reveal: $('#viewer-reveal'), editor: $('#viewer-editor'), close: $('#viewer-close'),
};
let viewing = null; // { path, views, actions, token }
let editorOk = false;
if (api.editorAvailable) api.editorAvailable().then((v) => { editorOk = Boolean(v); }).catch(() => {});

const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);

function diffStat(lines) {
  const { add, del } = ViewLogic.diffStat(lines);
  return `+${add} −${del}`;
}

// `views`: [{ key, label, lines }] (a diff) or [{ key, label, load }] (async,
// resolves to { text } | { lines } | { binary, size } | { error }).
function openViewer({ path, views, key, line = null, find = null, actions = {} }) {
  hideCard();
  // An open find bar stays, with its word: found again in this file.
  clearTimeout(vfind.timer);
  clearFindMarks();
  vfind.ranges = [];
  if (!vfind.bar.hidden) vfind.count.textContent = '…'; // not the previous file's count while this one loads
  viewing = { path, views, actions, line, find, token: null };
  setViewerPath(path);
  viewer.tabs.replaceChildren(...views.map((v) => {
    const b = h('button', 'tab', v.label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.key = v.key;
    b.addEventListener('click', () => showView(v.key));
    return b;
  }));
  viewer.tabs.hidden = views.length < 2;
  viewer.copy.textContent = actions.copy ? actions.copy.label : '경로 복사';
  viewer.reveal.hidden = !actions.reveal;
  viewer.editor.hidden = !(actions.editor && editorOk);
  viewer.el.hidden = false;
  showView(key || views[0].key);
  viewer.body.focus({ preventScroll: true });
}

// Markdown as read-only DOM (view-logic.js markdownBlocks/inlineSpans):
// text only; web links open in the browser.
// `link`: { id, base } of the file shown, so a relative link (a skill's
// reference.md) opens that file in the viewer when it stays in its folder.
function inlineNodes(text, link = null) {
  return ViewLogic.inlineSpans(text).map((sp) => {
    if (sp.t === 'text') return document.createTextNode(sp.s);
    if (sp.t === 'code') return h('code', null, sp.s);
    if (sp.t === 'b') return h('strong', null, sp.s);
    if (sp.t === 'i') return h('em', null, sp.s);
    const a = h('a', null, sp.s);
    a.title = sp.href;
    if (/^https?:\/\//i.test(sp.href)) a.addEventListener('click', () => api.openExternal(sp.href));
    else if (link && !/^[a-z][\w+.-]*:/i.test(sp.href) && !sp.href.startsWith('#') && !sp.href.startsWith('/')) {
      const rel = ViewLogic.relativeInside(sp.href);
      const cut = Math.max(link.base.lastIndexOf('/'), link.base.lastIndexOf('\\'));
      if (rel) {
        const target = `${link.base.slice(0, cut + 1)}${rel}`;
        a.title = `${target}\n클릭: 열기`;
        a.addEventListener('click', () => openConfigFile(link.id, target));
      } else {
        a.classList.add('inert');
        a.title = `${sp.href}\n이 파일의 폴더 밖이라 열 수 없습니다`;
      }
    } else {
      a.classList.add('inert');
    }
    return a;
  });
}

function markdownView(text, link = null) {
  const nodes = (t) => inlineNodes(t, link);
  const box = h('div', 'md');
  for (const b of ViewLogic.markdownBlocks(text)) {
    if (b.type === 'front') {
      const dl = h('dl', 'md-front');
      for (const [k, v] of b.pairs) dl.append(h('dt', null, k), h('dd', null, v));
      box.append(dl);
    } else if (b.type === 'h') {
      const el = h(`h${b.level}`);
      el.append(...nodes(b.text));
      box.append(el);
    } else if (b.type === 'code') {
      box.append(h('pre', 'md-code', b.text));
    } else if (b.type === 'list') {
      const ul = h(b.ordered ? 'ol' : 'ul');
      for (const it of b.items) {
        const li = h('li');
        li.style.marginLeft = `${it.depth * 18}px`;
        li.append(...nodes(it.text));
        ul.append(li);
      }
      box.append(ul);
    } else if (b.type === 'quote') {
      const q = h('blockquote');
      q.append(...nodes(b.text));
      box.append(q);
    } else if (b.type === 'table') {
      const t = h('table');
      b.rows.forEach((row, k) => {
        const tr = h('tr');
        for (const c of row) { const cell = h(k === 0 ? 'th' : 'td'); cell.append(...nodes(c)); tr.append(cell); }
        t.append(tr);
      });
      box.append(t);
    } else if (b.type === 'hr') {
      box.append(h('hr'));
    } else {
      const para = h('p');
      para.append(...nodes(b.text));
      box.append(para);
    }
  }
  return box;
}

// A file behind a Claude config item: Markdown is shown read ("읽기") and as
// written ("원문"); other files (settings JSON) as they are.
// `line`: shown from that line, marked (a content search result); a
// Markdown file then opens as written. `find`: the word that search found,
// put in the viewer's find bar.
function openConfigFile(id, file, line = null, find = null) {
  if (!id) return;
  const read = () => api.readFile(id, file);
  const views = /\.(md|markdown)$/i.test(file)
    ? [
      { key: 'read', label: '읽기', load: async () => { const r = await read(); return typeof r.text === 'string' ? { ...r, markdown: r.text, link: { id, base: r.path || file } } : r; } },
      { key: 'file', label: '원문', load: read },
    ]
    : [{ key: 'file', label: '파일', load: read }];
  openViewer({ path: file, views, key: line ? 'file' : undefined, line, find, actions: { reveal: () => api.revealFile(id, file) } });
}

// Marks line `line` of a code view and scrolls it into view.
function markLine(box, line) {
  const text = box.querySelector('.viewer-text');
  if (!text) return;
  const style = getComputedStyle(text);
  const lh = parseFloat(style.lineHeight) || 18;
  const top = (parseFloat(style.paddingTop) || 0) + (line - 1) * lh;
  const mark = h('div', 'viewer-hit');
  mark.style.top = `${top}px`;
  mark.style.height = `${lh}px`;
  box.append(mark);
  viewer.body.scrollTop = Math.max(0, top - viewer.body.clientHeight / 3);
}

function codeView(text) {
  const lines = text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const box = h('div', 'viewer-code');
  box.append(h('pre', 'viewer-gutter', lines.map((_, k) => k + 1).join('\n')), h('pre', 'viewer-text', lines.join('\n')));
  return { box, count: lines.length };
}

async function showView(key) {
  if (!viewing) return;
  const v = viewing.views.find((x) => x.key === key) || viewing.views[0];
  for (const b of viewer.tabs.children) b.setAttribute('aria-selected', String(b.dataset.key === v.key));
  viewer.info.textContent = '';
  viewer.body.scrollTop = 0;
  viewer.body.scrollLeft = 0;
  let r = v.lines ? { lines: v.lines } : null;
  if (!r) {
    viewer.body.replaceChildren(h('div', 'viewer-msg', '읽는 중…'));
    const token = {};
    viewing.token = token;
    r = await Promise.resolve(v.load()).catch(() => null) || { error: '읽을 수 없습니다' };
    if (!viewing || viewing.token !== token) return; // closed or switched meanwhile
  }
  // The main process resolves a relative activity path: show and copy that.
  if (typeof r.path === 'string' && r.path) {
    viewing.absPath = r.path;
    setViewerPath(r.path);
  }
  if (r.error) viewer.body.replaceChildren(h('div', 'viewer-msg', r.error));
  else if (r.binary) viewer.body.replaceChildren(h('div', 'viewer-msg', `바이너리 파일이라 표시하지 않습니다 (${sizeText(r.size || 0)})`));
  else if (typeof r.markdown === 'string') {
    viewer.body.replaceChildren(markdownView(r.markdown, r.link || null));
    viewer.info.textContent = `${sizeText(r.size || 0)}${r.truncated ? ' · 앞부분만 표시' : ''}`;
  } else if (r.lines) {
    viewer.body.replaceChildren(r.lines.length ? diffPre(r.lines) : h('div', 'viewer-msg', '변경 없음'));
    viewer.info.textContent = diffStat(r.lines);
  } else {
    const { box, count } = codeView(r.text || '');
    viewer.body.replaceChildren(box);
    viewer.info.textContent = `${count}줄, ${sizeText(r.size || 0)}${r.truncated ? ', 앞부분만 표시' : ''}`;
    if (viewing.line && viewing.line <= count) markLine(box, viewing.line);
  }
  afterViewShown();
}

// A long path is cut at its start, so the file name stays visible.
function setViewerPath(p) {
  viewer.path.replaceChildren(h('span', null, p));
  viewer.path.title = p;
}

function closeViewer(focusTerminal = true) {
  if (!viewing) return;
  closeViewerFind(false);
  viewing = null;
  viewer.el.hidden = true;
  viewer.body.replaceChildren();
  if (focusTerminal) agents.get(activeId)?.term.focus();
}

function flashButton(btn, ok) {
  btn.classList.add(ok ? 'done' : 'failed');
  setTimeout(() => btn.classList.remove('done', 'failed'), 900);
}

viewer.close.addEventListener('click', () => closeViewer());

// ---------- find in the file viewer ----------
// Ctrl+Shift+F (or Ctrl+F in the viewer) while a file is shown: like the
// terminal's search, every match marked, the current one brighter, Enter /
// Shift+Enter to the next / previous, Esc closes it. Matches are drawn with
// CSS highlights (the shown text is not changed); line numbers are not
// searched.
const vfind = {
  bar: $('#viewer-find'), input: $('#viewer-find-input'), count: $('#viewer-find-count'),
  prev: $('#viewer-find-prev'), next: $('#viewer-find-next'), close: $('#viewer-find-close'),
  ranges: [], index: -1, timer: null,
};
const FIND_MAX = 5000;
const canHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

function clearFindMarks() {
  if (!canHighlight) return;
  CSS.highlights.delete('viewer-find');
  CSS.highlights.delete('viewer-find-current');
}

// The shown text, as text nodes in order (not the line numbers).
function viewerTextNodes() {
  const walker = document.createTreeWalker(viewer.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('.viewer-gutter') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

// Finds what is typed in the shown text; the current match is the first
// one at or below `fromY` (a screen position: what is in view, or the line
// a content search result marked).
function runViewerFind(fromY = viewer.body.getBoundingClientRect().top) {
  clearFindMarks();
  vfind.ranges = [];
  vfind.index = -1;
  const q = vfind.input.value;
  if (!q || !viewing || !canHighlight) { vfind.count.textContent = q && !canHighlight ? '지원 안 됨' : ''; return; }
  for (const node of viewerTextNodes()) {
    for (const [a, b] of ViewLogic.findAll(node.data, q, FIND_MAX - vfind.ranges.length)) {
      const r = new Range();
      r.setStart(node, a);
      r.setEnd(node, b);
      vfind.ranges.push(r);
    }
    if (vfind.ranges.length >= FIND_MAX) break;
  }
  if (!vfind.ranges.length) { vfind.count.textContent = '없음'; return; }
  CSS.highlights.set('viewer-find', new Highlight(...vfind.ranges));
  // The matches run down the page in order: the first below `fromY` by
  // halving (not a measure of each).
  // A match with no box (in something hidden) breaks the order: then one
  // by one.
  const below = (r) => {
    const rect = r.getBoundingClientRect();
    return rect.width || rect.height ? rect.bottom > fromY + 1 : null;
  };
  let lo = 0;
  let hi = vfind.ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = below(vfind.ranges[mid]);
    if (b === null) { lo = vfind.ranges.findIndex((r) => below(r) === true); if (lo === -1) lo = vfind.ranges.length; break; }
    if (b) hi = mid; else lo = mid + 1;
  }
  vfind.index = lo < vfind.ranges.length ? lo : 0;
  showFindCurrent();
}

function showFindCurrent() {
  const r = vfind.ranges[vfind.index];
  if (!r) return;
  CSS.highlights.set('viewer-find-current', new Highlight(r));
  const more = vfind.ranges.length >= FIND_MAX ? '+' : '';
  vfind.count.textContent = `${vfind.index + 1}/${vfind.ranges.length}${more}`;
  // Into view, a third from the top (below the find bar), and sideways in a long line.
  const box = viewer.body.getBoundingClientRect();
  const rect = r.getBoundingClientRect();
  if (rect.top < box.top + 40 || rect.bottom > box.bottom - 10) viewer.body.scrollTop += rect.top - box.top - box.height / 3;
  if (rect.left < box.left || rect.right > box.right) viewer.body.scrollLeft += rect.left - box.left - box.width / 3;
}

function stepFind(dir) {
  if (!vfind.ranges.length) { runViewerFind(); return; }
  vfind.index = (vfind.index + dir + vfind.ranges.length) % vfind.ranges.length;
  showFindCurrent();
}

// Right under the viewer's head, however tall it is.
function placeViewerFind() {
  const head = viewer.el.querySelector('.viewer-head');
  if (head) vfind.bar.style.top = `${head.offsetHeight + 6}px`;
}

function openViewerFind() {
  if (!viewing) return;
  placeViewerFind();
  const sel = String(window.getSelection() || '');
  if (sel && !sel.includes('\n') && viewer.body.contains(window.getSelection().anchorNode)) vfind.input.value = sel;
  vfind.bar.hidden = false;
  vfind.input.focus();
  vfind.input.select();
  runViewerFind();
}

function closeViewerFind(focusBody = true) {
  clearTimeout(vfind.timer);
  clearFindMarks();
  vfind.ranges = [];
  if (vfind.bar.hidden) return;
  vfind.bar.hidden = true;
  vfind.count.textContent = '';
  if (focusBody && viewing) viewer.body.focus({ preventScroll: true });
}

// A view was drawn (opened, another tab, read again): found again in it.
// A file opened from the content search starts with its word, at the line
// that result was.
function afterViewShown() {
  if (!viewing) return;
  if (viewing.find) {
    vfind.input.value = viewing.find;
    viewing.find = null;
    vfind.bar.hidden = false;
  }
  if (vfind.bar.hidden) return;
  placeViewerFind();
  const hit = viewer.body.querySelector('.viewer-hit');
  runViewerFind(hit ? hit.getBoundingClientRect().top : undefined);
}

vfind.input.addEventListener('input', () => {
  clearTimeout(vfind.timer);
  vfind.timer = setTimeout(() => { vfind.timer = null; runViewerFind(); }, 120);
});
// Enter: to the next match (Shift: previous); right after typing, to the
// first one for the new word.
function findEnter(back) {
  if (vfind.timer) {
    clearTimeout(vfind.timer);
    vfind.timer = null;
    runViewerFind();
    if (back) stepFind(-1);
    return;
  }
  stepFind(back ? -1 : 1);
}
let findEnterAfterCompose = null; // the Enter that ended a Hangul syllable: acted on once it is in the box
vfind.input.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) {
    if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') findEnterAfterCompose = { back: e.shiftKey };
    return;
  }
  findEnterAfterCompose = null; // a composition that ended without its compositionend
  if (e.key === 'Enter') {
    e.preventDefault();
    findEnter(e.shiftKey);
  }
  // Esc: the document's handler (escapeAction) closes the find bar.
});
vfind.input.addEventListener('blur', () => { findEnterAfterCompose = null; });
vfind.input.addEventListener('compositionend', () => {
  const pending = findEnterAfterCompose;
  findEnterAfterCompose = null;
  if (!pending) return;
  // The syllable's input event comes next: then the word is complete.
  setTimeout(() => findEnter(pending.back), 0);
});
vfind.prev.addEventListener('click', () => stepFind(-1));
vfind.next.addEventListener('click', () => stepFind(1));
vfind.close.addEventListener('click', () => closeViewerFind());
viewer.el.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyF') { e.preventDefault(); openViewerFind(); }
  else if (e.key === 'F3' && !vfind.bar.hidden) { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
});
viewer.copy.addEventListener('click', async () => {
  if (!viewing) return;
  const text = viewing.actions.copy ? viewing.actions.copy.text : viewing.absPath || viewing.path;
  flashButton(viewer.copy, await Promise.resolve(api.clipboardWrite(text)).then(() => true, () => false));
});
viewer.reveal.addEventListener('click', async () => {
  if (viewing && viewing.actions.reveal) flashButton(viewer.reveal, await viewing.actions.reveal().catch(() => false));
});
viewer.editor.addEventListener('click', async () => {
  if (viewing && viewing.actions.editor) flashButton(viewer.editor, await viewing.actions.editor().catch(() => false));
});

// A file from the activity log: what that line changed, and the file now.
function openActivityFile(id, file, entry) {
  const views = [];
  const input = entry && entry.detail && entry.detail.input;
  const lines = input && typeof input === 'object' ? editLines(entry.tool, input, entry.result) : null;
  if (lines) views.push({ key: 'change', label: '이번 변경', lines });
  views.push({ key: 'file', label: '파일', load: () => api.readFile(id, file) });
  openViewer({
    path: file, views,
    actions: { reveal: () => api.revealFile(id, file), editor: () => api.openFile(id, file) },
  });
}
// The panel body scrolls (not the list): the card would stay beside another line.
insp.list.closest('.tab-body').addEventListener('scroll', () => hideCard(), { passive: true });

function renderActivity() {
  hideCard();
  const id = activeId;
  const list = agents.get(id)?.activity || [];
  insp.list.replaceChildren(...list.slice().reverse().map((e) => activityRow(id, e)));
  insp.empty.hidden = list.length > 0;
}

function renderInspector() {
  renderCtxDetail();
  renderActivity();
}

let activityMax = 200; // the main process says how many lines it keeps

function trimActivity(list) {
  if (list.length > activityMax) list.splice(0, list.length - activityMax);
}

// The log so far, merged with lines that arrived while it was loading: those
// are newer, or a line from the snapshot re-sent as failed, so they win.
async function loadActivity(id) {
  const a = agents.get(id);
  if (!a || !api.activity) return;
  const got = await api.activity(id).catch(() => null);
  if (!got || !agents.has(id)) return;
  if (got.max > 0) activityMax = got.max;
  const live = new Map(a.activity.map((e) => [e.n, e]));
  const merged = got.entries.map((e) => live.get(e.n) || e);
  const seen = new Set(merged.map((e) => e.n));
  a.activity = [...merged, ...a.activity.filter((e) => !seen.has(e.n))].sort((x, y) => x.n - y.n);
  trimActivity(a.activity);
  if (id === activeId) renderActivity();
}

// New line, or a tool line now marked failed (same n).
function onActivity(id, entry) {
  const a = agents.get(id);
  if (!a) return;
  // A change Claude just made, or the end of its turn: the git tab follows.
  // (at most every 3 s while Claude works; see loadGit)
  if (id === activeId && entry.kind === 'done') { loadGit(150); loadTree(150, true); }
  else if (id === activeId && entry.result !== undefined && /^(Edit|MultiEdit|Write|NotebookEdit|Bash)$/.test(entry.tool || '')) { loadGit(3000, false); loadTree(3000); }
  const i = a.activity.findIndex((e) => e.n === entry.n);
  if (i !== -1) a.activity[i] = entry;
  else {
    a.activity.push(entry);
    trimActivity(a.activity);
  }
  if (id !== activeId) return;
  if (i !== -1) {
    const row = activityRow(id, entry);
    insp.list.querySelector(`.act[data-n="${entry.n}"]`)?.replaceWith(row);
    // The card follows the line it shows (a result or failure just arrived).
    if (cardAt && cardAt.id === id && cardAt.n === entry.n) { cardAt.li = row; renderCard(); }
    return;
  }
  insp.list.prepend(activityRow(id, entry));
  while (insp.list.children.length > activityMax) insp.list.lastElementChild.remove();
  insp.empty.hidden = true;
}

// ---------- git tab ----------
// The repository at the active terminal's folder: branch, changed files and
// recent commits (read-only; git-view.js). A file or commit opens in the viewer.
const gitEls = { head: $('#git-head'), body: $('#git-body') };
let gitStale = true;
let gitTimer = null;
let gitToken = null;
let lastGitAt = 0;

function gitVisible() {
  return !app.classList.contains('inspector-closed') && inspectorTab === 'git';
}

let gitDue = 0; // when the scheduled read runs
let gitFresh = false; // the scheduled read finds the repository root again

// One read at a time; a request during a read runs once more after it.
const readGit = ViewLogic.serial(async () => {
  const id = activeId;
  const fresh = gitFresh;
  gitFresh = false;
  if (!id || !api.gitStatus || !gitVisible()) { gitStale = true; return; }
  gitStale = false;
  const token = {};
  gitToken = token;
  if (!gitEls.body.childElementCount) gitEls.body.replaceChildren(h('p', 'hint', '읽는 중…'));
  const r = await api.gitStatus(id, fresh).catch(() => null) || { error: '읽을 수 없습니다' };
  lastGitAt = Date.now();
  if (gitToken === token && id === activeId && !r.stale) renderGit(id, r, fresh);
});

// A read in `delay` ms. An earlier one already scheduled is kept: refreshes
// while Claude works come every few seconds, never pushed back for good.
// `fresh` (all but those refreshes) also looks for the repository root again.
function loadGit(delay = 150, fresh = true) {
  if (fresh) gitFresh = true;
  const due = Date.now() + delay;
  if (gitTimer && gitDue <= due) return;
  clearTimeout(gitTimer);
  gitDue = due;
  gitTimer = setTimeout(() => { gitTimer = null; readGit(); }, delay);
}

function clearGit() {
  gitToken = null;
  gitEls.head.replaceChildren();
  gitEls.body.replaceChildren(h('p', 'hint', '읽는 중…'));
}

function agoText(t) {
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function gitNum(n) {
  const box = h('span', 'git-num');
  if (!n) return box;
  if (n.add == null) { box.textContent = '바이너리'; return box; }
  box.append(h('span', 'a', `+${n.add}`), h('span', 'd', `−${n.del}`));
  return box;
}

function gitFileRow(id, root, f, st, num) {
  const li = h('li', 'git-file');
  const stEl = h('span', 'git-st', st);
  stEl.dataset.st = st;
  const name = h('span', 'git-name');
  const slash = f.path.lastIndexOf('/');
  const inner = h('span');
  if (slash !== -1) inner.append(h('span', 'git-dir', f.path.slice(0, slash + 1)));
  inner.append(document.createTextNode(f.path.slice(slash + 1)));
  name.append(inner);
  li.title = f.orig ? `${f.orig} → ${f.path}` : f.path;
  li.append(stEl, name, gitNum(num));
  if (f.index === '?' && f.path.endsWith('/')) {
    // A new folder: its files are listed under it on the first click.
    li.classList.add('git-folder');
    inner.append(h('span', 'git-caret', ' ▸'));
    li.title = `${f.path}\n새 폴더: 클릭해서 안의 파일 보기`;
    li.addEventListener('click', () => expandGitFolder(id, root, f, li));
  } else {
    li.addEventListener('click', () => openGitFile(id, root, f));
  }
  return li;
}

// New folders opened by the user, kept across refreshes (root + path), with
// their last file list: shown at once after a refresh, listed again only on
// the fresh reads (not every few seconds while Claude works).
const gitOpenFolders = new Set();
const gitFolderFiles = new Map();

// A click opens a new folder's file list under it, the next one closes it.
function folderRows(id, root, key, r) {
  const rows = r.error ? [h('li', 'hint', r.error)]
    : r.files.map((p) => { const row = gitFileRow(id, root, { path: p, index: '?', work: '?', orig: null }, '?', null); row.classList.add('git-sub'); return row; });
  if (r.total > (r.files || []).length) rows.push(h('li', 'hint', `${r.files.length}개만 표시 (전체 ${r.total}개)`));
  if (!rows.length) rows.push(h('li', 'hint', '파일 없음'));
  for (const row of rows) row.dataset.sub = key;
  return rows;
}

function dropFolderRows(li, key) {
  while (li.nextElementSibling && li.nextElementSibling.dataset.sub === key) li.nextElementSibling.remove();
}

async function expandGitFolder(id, root, f, li, toggle = true, relist = true) {
  const key = `${root}\n${f.path}`;
  const caret = li.querySelector('.git-caret');
  if (li.dataset.open) {
    if (!toggle) return;
    delete li.dataset.open;
    gitOpenFolders.delete(key);
    gitFolderFiles.delete(key);
    if (caret) caret.textContent = ' ▸';
    dropFolderRows(li, key);
    return;
  }
  li.dataset.open = '1';
  gitOpenFolders.add(key);
  if (caret) caret.textContent = ' ▾';
  const cached = gitFolderFiles.get(key);
  if (cached) li.after(...folderRows(id, root, key, cached));
  if (cached && !relist) return;
  const r = await api.gitUntracked(id, f.path).catch(() => null) || { error: '읽을 수 없습니다' };
  if (!li.isConnected || !li.dataset.open) return;
  if (!r.error) gitFolderFiles.set(key, r);
  dropFolderRows(li, key);
  li.after(...folderRows(id, root, key, r));
}

// Sections of the git tab (staged, changed, new files, commits) fold like
// the config groups; which ones are open is remembered.
let gitOpen = {};
try { gitOpen = JSON.parse(readPref('gitOpen', '{}')) || {}; } catch { gitOpen = {}; }

function gitSection(key, label, count, list) {
  const d = document.createElement('details');
  d.className = 'cfg-group git-group';
  d.open = gitOpen[key] !== false; // open unless closed before
  const sum = document.createElement('summary');
  sum.append(h('span', null, label), h('span', 'count', String(count)));
  d.append(sum, list);
  d.addEventListener('toggle', () => { gitOpen[key] = d.open; writePref('gitOpen', JSON.stringify(gitOpen)); });
  return d;
}

function renderGit(id, r, fresh = true) {
  gitEls.head.replaceChildren();
  if (r.error || r.notRepo) {
    const cwd = agents.get(id)?.info.cwd || '';
    gitEls.body.replaceChildren(h('p', 'hint', r.error || `git 저장소가 아닙니다: ${cwd}`));
    return;
  }
  gitEls.head.append(h('span', 'git-branch', r.branch ? `⎇ ${r.branch}` : '⎇ (브랜치 없음)'));
  gitEls.head.append(h('span', 'git-sync', r.upstream ? `${r.upstream} ↑${r.ahead} ↓${r.behind}` : '원격 브랜치 없음'));
  gitEls.head.append(h('span', 'git-root ellipsis', r.root || '/'));
  gitEls.head.lastChild.title = r.root || '/';
  const groups = [
    ['staged', '스테이징됨', r.files.filter((f) => f.index !== ' ' && f.index !== '?'), (f) => [f.index, f.staged]],
    ['changed', '변경됨', r.files.filter((f) => f.work !== ' ' && f.work !== '?'), (f) => [f.work, f.unstaged]],
    ['new', '새 파일', r.files.filter((f) => f.index === '?'), () => ['?', null]],
  ];
  const parts = [];
  const reopen = [];
  for (const [key, label, files, cols] of groups) {
    if (!files.length) continue;
    const ul = h('ul', 'git-list');
    for (const f of files) {
      const [st, num] = cols(f);
      const row = gitFileRow(id, r.root, f, st, num);
      ul.append(row);
      if (row.classList.contains('git-folder') && gitOpenFolders.has(`${r.root}\n${f.path}`)) reopen.push([f, row]);
    }
    parts.push(gitSection(key, label, files.length, ul));
  }
  if (!parts.length) parts.push(h('p', 'hint', '바뀐 파일이 없습니다.'));
  if (r.total > r.files.length) parts.push(h('p', 'hint', `바뀐 파일이 많아 ${r.files.length}개만 표시합니다 (전체 ${r.total}개).`));
  if (r.commits.length) {
    const ul = h('ul', 'git-list');
    for (const c of r.commits) {
      const li = h('li', 'git-commit');
      li.append(h('span', 'git-hash', c.short), h('span', 'git-subject', c.subject), h('span', 'git-when', agoText(c.time)));
      li.title = `${c.subject}${c.time ? `\n${new Date(c.time).toLocaleString()}` : ''}`;
      li.addEventListener('click', () => openViewer({
        path: `${c.short} ${c.subject}`,
        views: [{ key: 'show', label: '커밋', load: () => api.gitShow(id, c.hash) }],
        actions: { copy: { label: '해시 복사', text: c.hash } },
      }));
      ul.append(li);
    }
    parts.push(gitSection('commits', '최근 커밋', r.commits.length, ul));
  }
  gitEls.body.replaceChildren(...parts);
  // Folders the user had open stay open after a refresh (listed again only
  // on a fresh read).
  for (const [f, row] of reopen) expandGitFolder(id, r.root, f, row, false, fresh);
}

// A changed file: its diff against HEAD (a new file: all of it), and the file.
function openGitFile(id, root, f) {
  const abs = `${root}/${f.path}`;
  const views = [];
  if (f.index === '?') {
    views.push({
      key: 'change', label: '새 파일',
      load: async () => {
        const r = await api.readFile(id, abs);
        return typeof r.text === 'string' ? { lines: r.text.replace(/\n$/, '').split('\n').map((l) => `+${l}`) } : r;
      },
    });
  } else {
    views.push({ key: 'change', label: '변경', load: () => api.gitDiff(id, f.path) });
  }
  if (f.work !== 'D' && f.index !== 'D') views.push({ key: 'file', label: '파일', load: () => api.readFile(id, abs) });
  openViewer({
    path: abs, views,
    actions: { reveal: () => api.revealFile(id, abs), editor: () => api.openFile(id, abs) },
  });
}

window.addEventListener('focus', () => { if (Date.now() - lastGitAt > 5000) loadGit(); });
window.addEventListener('focus', () => { if (Date.now() - lastTreeAt > 5000) loadTree(); });

// ---------- file tab: the project as a folder tree (read-only) ----------
// The root is the git repository of the terminal's folder, else that
// folder. Folders are listed when opened; open ones stay open (per root)
// and are listed again on a refresh. A file opens in the viewer.

const treeEls = { head: $('#tree-head'), body: $('#tree-body') };
let treeStale = true;
let treeTimer = null;
let treeDue = 0;
let treeFresh = false; // the scheduled read asks git again which entries it ignores
let lastTreeAt = 0;
let treeToken = null;
let tree = null; // { id, root, lists: Map(rel -> listing), marks (git changes) }
let treeSelected = null; // the file open in the viewer, as a full path
const treeOpen = new Map(); // root -> Set of open folders ("src/app")

function treeVisible() {
  return !app.classList.contains('inspector-closed') && inspectorTab === 'files';
}

// A read in `delay` ms; an earlier one already scheduled is kept. `fresh`
// (⟳, end of Claude's turn) also asks git again which entries it ignores;
// other reads reuse its last answer (inside WSL each ask starts wsl.exe).
function loadTree(delay = 150, fresh = false) {
  if (fresh) treeFresh = true;
  const due = Date.now() + delay;
  if (treeTimer && treeDue <= due) return;
  clearTimeout(treeTimer);
  treeDue = due;
  treeTimer = setTimeout(() => { treeTimer = null; readTree(); }, delay);
}

function clearTree() {
  treeToken = null;
  tree = null;
  search.list = null;
  if (search.query) search.results.replaceChildren(h('li', 'hint', '읽는 중…')); // not the previous terminal's results
  treeEls.head.replaceChildren();
  treeEls.body.replaceChildren(h('li', 'hint', '읽는 중…'));
}

// The full path of `rel` under `root`, in the root's own separators.
function treeAbs(root, rel) {
  const win = /^[a-zA-Z]:|^\\\\/.test(root);
  const base = root.replace(/[\\/]+$/, '');
  return `${base}${win ? '\\' : '/'}${win ? rel.replace(/\//g, '\\') : rel}`;
}

const parentOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

// Lists the open folders not listed yet, parents first. A folder whose
// parent no longer lists it (deleted, now a file) is closed; one that could
// not be listed this time (a failed read, the terminal moved to another
// project meanwhile, its parent unreadable) stays open for the next read.
// `alive`: whether the result is still wanted.
async function fillTree(id, t, alive, fresh = false) {
  const open = treeOpen.get(t.root);
  const skip = new Set();
  for (;;) {
    const want = [...open].filter((rel) => !skip.has(rel) && !t.lists.has(rel) && t.lists.has(parentOf(rel)) && t.lists.get(parentOf(rel)).entries);
    if (!want.length) return true;
    const got = await Promise.all(want.map((rel) => api.listFiles(id, rel, fresh).catch(() => null)));
    if (!alive()) return false;
    want.forEach((rel, k) => {
      const parent = t.lists.get(parentOf(rel));
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const r = got[k];
      if (!parent.entries.some((e) => e.dir && e.name === name)) open.delete(rel);
      else if (!r || r.stale || r.root !== t.root) skip.add(rel);
      else t.lists.set(rel, r);
    });
  }
}

// One read at a time; a request during a read runs once more after it.
const readTree = ViewLogic.serial(async () => {
  const id = activeId;
  if (!id || !api.listFiles || !treeVisible()) { treeStale = true; return; }
  treeStale = false;
  const fresh = treeFresh;
  treeFresh = false;
  const token = {};
  treeToken = token;
  if (!treeEls.body.childElementCount) treeEls.body.replaceChildren(h('li', 'hint', '읽는 중…'));
  const top = await api.listFiles(id, '', fresh).catch(() => null) || { error: '읽을 수 없습니다' };
  lastTreeAt = Date.now();
  if (treeToken !== token || id !== activeId) return;
  if (top.stale) { loadTree(0, fresh); return; } // the folder changed meanwhile
  if (!top.root) {
    treeEls.head.replaceChildren();
    treeEls.body.replaceChildren(h('li', 'hint', top.error || '읽을 수 없습니다'));
    return;
  }
  if (!treeOpen.has(top.root)) treeOpen.set(top.root, new Set());
  const t = { id, root: top.root, lists: new Map([['', top]]), marks: ViewLogic.treeMarks(top.status || []) };
  if (!(await fillTree(id, t, () => treeToken === token, fresh)) || id !== activeId) return;
  tree = t;
  // The search box's file list is read again after a fresh read (files
  // Claude added), or when the project changed.
  if (fresh || (search.list && search.list.root !== t.root)) search.list = null;
  renderTree();
  if (search.query) runSearch();
});

function renderTree() {
  const t = tree;
  if (!t) return;
  const open = treeOpen.get(t.root);
  const head = h('span', null, t.root);
  treeEls.head.replaceChildren(head);
  treeEls.head.title = t.root;
  const rows = [];
  const walk = (rel, depth) => {
    const r = t.lists.get(rel);
    if (r.error) { rows.push(treeHint(r.error, depth)); return; }
    if (!r.entries.length && depth === 0) rows.push(treeHint('빈 폴더', depth));
    for (const e of r.entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      const isOpen = e.dir && open.has(child) && t.lists.has(child);
      rows.push(treeRow(t, e, child, depth, isOpen));
      if (isOpen) walk(child, depth + 1);
    }
    if (r.total > r.entries.length) rows.push(treeHint(`처음 ${r.entries.length}개만 표시 (전체 ${r.total}개)`, depth));
  };
  walk('', 0);
  treeEls.body.replaceChildren(...rows);
}

function treeHint(text, depth) {
  const li = h('li', 'hint', text);
  li.style.paddingLeft = `${4 + depth * 12 + 16}px`;
  return li;
}

function treeRow(t, e, rel, depth, isOpen) {
  const li = h('li', 'tree-row');
  li.setAttribute('role', 'treeitem');
  li.tabIndex = 0;
  li.style.paddingLeft = `${4 + depth * 12}px`;
  if (e.ignored) li.classList.add('ignored');
  if (e.link) li.classList.add('link');
  const abs = treeAbs(t.root, rel);
  li.dataset.abs = abs;
  let mark = e.dir ? t.marks.dir(rel) : t.marks.file(rel);
  if (mark === 'U' && e.ignored) mark = null; // in a new folder, but git ignores it
  if (mark) li.dataset.st = mark;
  li.title = `${abs}${mark ? `\n${e.dir ? '안에 ' : ''}${MARK_LABEL[mark]}` : ''}${e.ignored ? '\ngit에서 무시하는 항목' : ''}${e.link ? '\n링크' : ''}`;
  if (e.dir) {
    li.dataset.dir = '1';
    li.setAttribute('aria-expanded', String(isOpen));
  } else {
    li.setAttribute('aria-selected', String(abs === treeSelected));
  }
  li.append(h('span', 'tree-caret', e.dir ? (isOpen ? '▾' : '▸') : ''), h('span', 'tree-name', e.name),
    h('span', 'tree-st', mark ? (e.dir ? '•' : mark) : ''));
  const activate = () => (e.dir ? toggleTreeFolder(t, rel) : openTreeFile(t, abs));
  li.addEventListener('click', activate);
  li.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
  });
  return li;
}

async function toggleTreeFolder(t, rel) {
  const open = treeOpen.get(t.root);
  if (open.has(rel)) {
    open.delete(rel); // folders open inside it stay open for next time
    renderTree();
    return;
  }
  open.add(rel);
  // Listed now even while a refresh runs (that refresh lists it too, as it
  // is open now): the click shows at once.
  if (!t.lists.has(rel) && !(await fillTree(t.id, t, () => tree === t))) return;
  renderTree();
  const row = [...treeEls.body.querySelectorAll('.tree-row')].find((x) => x.dataset.abs === treeAbs(t.root, rel));
  if (row) row.focus({ preventScroll: true });
}

function openTreeFile(t, abs, line = null, find = null) {
  treeSelected = abs;
  for (const row of treeEls.body.querySelectorAll('.tree-row:not([data-dir])')) {
    row.setAttribute('aria-selected', String(row.dataset.abs === abs));
  }
  openConfigFile(t.id, abs, line, find);
}

const MARK_LABEL = { M: '수정됨', U: '새 파일 (추적 안 함)', A: '추가됨 (스테이징)', R: '이름 바뀜', C: '충돌' };

// ---------- file tab: search by file name, or in the files ----------
// 이름: the project's file list is read once (git ls-files: tracked and
// untracked files git does not ignore; else a walk of the folder) and
// filtered here as you type (view-logic.js searchFiles).
// 내용: the lines holding the typed text, found by the main process (git
// grep; content-search.js), grouped by file; a line opens the file there.

const search = {
  input: $('#tree-search'), results: $('#tree-results'), query: '', list: null, loading: null, running: null, active: 0, timer: null,
  enterAt: 0, entering: false, enterAfterCompose: false,
  mode: readPref('treeSearchMode', 'name') === 'text' ? 'text' : 'name',
  modeEl: $('#search-mode'),
};

function setSearchMode(mode) {
  search.mode = mode;
  writePref('treeSearchMode', mode);
  for (const b of search.modeEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  const text = mode === 'text';
  search.input.placeholder = text ? '파일 내용 검색 (2자 이상)' : '파일 이름 검색';
  search.input.setAttribute('aria-label', text ? '파일 내용 검색' : '파일 이름 검색');
  search.input.title = text
    ? '파일 안에서 이 글자를 찾음 (대문자가 있으면 대소문자 구분) · ↑↓ 고르기 · Enter 열기 · Alt+C 이름 검색 · Esc 지우기'
    : '공백으로 나눈 낱말이 모두 들어간 파일 · ↑↓ 고르기 · Enter 열기 · Alt+C 내용 검색 · Esc 지우기';
  search.query = ''; // searched again in the new mode
  search.active = 0;
  applySearch();
}
search.modeEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  setSearchMode(b.dataset.mode);
  search.input.focus();
});

// The file list for tree `t`: the one read already, or one read now (shared
// by the searches typed while it loads).
async function searchList(t) {
  if (search.list && search.list.root === t.root) return search.list;
  if (!search.loading || search.loading.t !== t) {
    const p = api.allFiles(t.id).catch(() => null).then((r) => {
      if (search.loading === p) search.loading = null;
      if (r && r.files && tree === t && r.root === t.root) search.list = r;
      return search.list && search.list.root === t.root ? search.list : null;
    });
    p.t = t;
    search.loading = p;
  }
  return search.loading;
}

// The search for the current query; Enter waits for the one running.
function runSearch() {
  const p = searchNow();
  search.running = p;
  p.finally(() => { if (search.running === p) search.running = null; }).catch(() => {}); // the caller sees the error
  return p;
}

async function searchNow() {
  const t = tree;
  const q = search.query;
  const on = Boolean(q);
  search.results.hidden = !on;
  treeEls.body.hidden = on;
  treeEls.head.hidden = on;
  if (!on || !t) return;
  if (search.mode === 'text') { await textSearchNow(t, q); return; }
  if (!search.list) search.results.replaceChildren(h('li', 'hint', '파일 목록을 읽는 중…'));
  const list = await searchList(t);
  if (q !== search.query || tree !== t) return; // typed on, or another project
  if (!list) { search.results.replaceChildren(h('li', 'hint', '파일 목록을 읽을 수 없습니다')); return; }
  const found = ViewLogic.searchFiles(list.files, q, 200);
  search.active = Math.min(search.active, Math.max(0, found.length - 1));
  const rows = found.map((f, k) => searchRow(t, f, k, list));
  if (!found.length) rows.push(h('li', 'hint', '일치하는 파일 없음'));
  else if (found.length === 200) rows.push(h('li', 'hint', '처음 200개만 표시 · 낱말을 더 넣어 좁혀 보세요'));
  if (list.truncated) rows.push(h('li', 'hint', `처음 ${list.files.length.toLocaleString()}개 파일에서만 찾았습니다`));
  if (list.note) rows.push(h('li', 'hint', list.note));
  search.results.replaceChildren(...rows);
}

function searchRow(t, f, k, list) {
  const li = h('li', 'tree-row tree-result');
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', String(k === search.active));
  const abs = treeAbs(t.root, f.path);
  li.dataset.abs = abs;
  // A list walked without git may hold ignored files: no "new" from a folder.
  const mark = list.note ? t.marks.own(f.path) : t.marks.file(f.path);
  if (mark) li.dataset.st = mark;
  li.title = `${abs}${mark ? `\n${MARK_LABEL[mark]}` : ''}`;
  const name = h('span', 'tree-name');
  let at = 0;
  for (const [a, b] of f.marks) {
    if (a > at) name.append(document.createTextNode(f.name.slice(at, a)));
    name.append(h('mark', null, f.name.slice(a, b)));
    at = b;
  }
  if (at < f.name.length) name.append(document.createTextNode(f.name.slice(at)));
  if (f.dir) name.append(h('span', 'tree-dir', f.dir.replace(/\/$/, '')));
  li.append(h('span', 'tree-caret', ''), name, h('span', 'tree-st', mark || ''));
  li.addEventListener('click', () => openSearchResult(t, f.path, k));
  return li;
}

// The content search: the lines found, under their file.
async function textSearchNow(t, q) {
  if (q.length < 2) { search.results.replaceChildren(h('li', 'hint', '2자 이상 입력하세요')); return; }
  if (!search.results.querySelector('.tree-result')) search.results.replaceChildren(h('li', 'hint', '찾는 중…'));
  const r = await api.searchText(t.id, q).catch(() => null);
  if (q !== search.query || tree !== t || search.mode !== 'text') return; // typed on, or another project or mode
  if (r && r.stale) return; // a newer search answers
  if (!r || r.error) { search.results.replaceChildren(h('li', 'hint', (r && r.error) || '찾지 못했습니다')); return; }
  search.shownQuery = q;
  const rows = [];
  let k = 0;
  for (const f of r.files) {
    rows.push(textFileRow(t, f, k++));
    for (const hit of f.hits) rows.push(textHitRow(t, f, hit, k++, r));
    if (f.more) rows.push(h('li', 'hint text-more', `… 이 파일에 ${f.more}줄 더`));
  }
  search.active = Math.min(search.active, Math.max(0, k - 1));
  rows.forEach((row) => { if (row.classList.contains('tree-result')) row.setAttribute('aria-selected', String(Number(row.dataset.k) === search.active)); });
  const summary = r.files.length
    ? `${(r.total ?? r.count).toLocaleString()}줄 · 파일 ${r.files.length.toLocaleString()}개${r.truncated ? ' · 처음 일부만 표시, 글자를 더 넣어 좁혀 보세요' : ''}${r.ignoreCase ? '' : ' · 대소문자 구분'}`
    : '일치하는 내용 없음';
  rows.unshift(h('li', 'hint', summary));
  if (r.note) rows.push(h('li', 'hint', r.note));
  search.results.replaceChildren(...rows);
}

function textFileRow(t, f, k) {
  const li = h('li', 'tree-row tree-result text-file');
  li.setAttribute('role', 'option');
  li.dataset.k = k;
  const abs = treeAbs(t.root, f.path);
  li.dataset.abs = abs;
  const mark = t.marks.file(f.path);
  if (mark) li.dataset.st = mark;
  li.title = abs;
  const cut = f.path.lastIndexOf('/') + 1;
  const name = h('span', 'tree-name', f.path.slice(cut));
  if (cut) name.append(h('span', 'tree-dir', f.path.slice(0, cut - 1)));
  li.append(h('span', 'tree-caret', '▾'), name, h('span', 'text-count', String(f.hits.length + f.more)));
  li.addEventListener('click', () => openSearchResult(t, f.path, k));
  return li;
}

function textHitRow(t, f, hit, k, r) {
  const li = h('li', 'tree-row tree-result text-hit');
  li.setAttribute('role', 'option');
  li.dataset.k = k;
  li.title = `${f.path}:${hit.line}`;
  const text = h('span', 'text-line');
  const shown = ViewLogic.hitView(hit.text, r.query, r.ignoreCase);
  let at = 0;
  for (const [a, b] of shown.ranges) {
    if (a > at) text.append(document.createTextNode(shown.text.slice(at, a)));
    text.append(h('mark', null, shown.text.slice(a, b)));
    at = b;
  }
  if (at < shown.text.length) text.append(document.createTextNode(shown.text.slice(at)));
  li.append(h('span', 'text-ln', String(hit.line)), text);
  li.addEventListener('click', () => openSearchResult(t, f.path, k, hit.line));
  return li;
}

// Opens a result (at `line` for a found line), and opens its folders in
// the tree for when the search is cleared.
function openSearchResult(t, rel, k, line = null) {
  if (tree !== t) return; // results of a terminal no longer shown
  search.active = k;
  [...search.results.querySelectorAll('.tree-result')].forEach((row, i) => row.setAttribute('aria-selected', String(i === k)));
  const open = treeOpen.get(t.root);
  for (let cut = rel.indexOf('/'); cut !== -1; cut = rel.indexOf('/', cut + 1)) open.add(rel.slice(0, cut));
  // From the content search: the word those results were found with goes
  // into the viewer's find bar (not one typed since).
  openTreeFile(t, treeAbs(t.root, rel), line, search.mode === 'text' ? search.shownQuery : null);
}

// Runs the search for what is typed now (no-op when it already has).
function applySearch() {
  clearTimeout(search.timer);
  search.timer = null;
  const q = search.input.value.trim();
  if (q === search.query) return null;
  search.query = q;
  search.active = 0;
  if (!q && tree) loadTree(0); // back to the tree, with the folders the results opened
  return runSearch();
}

search.input.addEventListener('input', () => {
  clearTimeout(search.timer);
  search.timer = setTimeout(applySearch, search.mode === 'text' ? 300 : 80); // a content search reads files
});
// Enter: search what is typed (or wait for the search still reading the
// file list), then open the chosen result. Once per press: an IME may send
// the Enter that ends a composition and then the Enter itself.
// Also once while one still waits for a slow file list.
async function searchEnter() {
  if (search.entering || Date.now() - search.enterAt < 150) return;
  search.entering = true;
  try {
    const pending = applySearch() || search.running;
    if (pending) await pending.catch(() => {});
    const row = search.results.querySelectorAll('.tree-result')[search.active];
    if (row) row.click();
  } finally {
    search.entering = false;
    search.enterAt = Date.now();
  }
}

// An Enter that ends a Hangul composition: the syllable is in the box only
// after compositionend, so the search runs then.
search.input.addEventListener('compositionend', () => {
  if (!search.enterAfterCompose) return;
  search.enterAfterCompose = false;
  setTimeout(searchEnter, 0);
});

search.input.addEventListener('keydown', async (e) => {
  if (e.isComposing || e.keyCode === 229) {
    if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') search.enterAfterCompose = true;
    return; // other keys belong to the composition
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    await searchEnter();
    return;
  }
  if (e.altKey && e.code === 'KeyC') {
    e.preventDefault();
    setSearchMode(search.mode === 'text' ? 'name' : 'text');
    return;
  }
  const rows = [...search.results.querySelectorAll('.tree-result')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!rows.length) return;
    search.active = (search.active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === search.active)));
    rows[search.active].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Escape' && search.input.value) {
    e.preventDefault();
    e.stopPropagation(); // clears the box; the next Esc closes the viewer
    search.input.value = '';
    search.input.dispatchEvent(new Event('input'));
  }
});
setSearchMode(search.mode); // the remembered mode's box

// ---------- HTML preview (private/index.html beside the terminal) ----------
// Claude draws diagrams and charts into the project's private/index.html;
// it shows here as it is written. Beside the terminal (drag the border,
// double-click: half), or as a side-panel tab when the window is narrow,
// or in a window of its own. It opens by itself for a new drawing unless
// the user closed it (then the button gets a dot), and it never takes the
// keyboard from the terminal.

const previewEls = {
  center: $('#center'),
  slot: $('#preview-slot'),
  resizer: $('#preview-resizer'),
  tabSlot: $('#preview-tab-slot'),
  toggle: $('#preview-toggle'),
  tab: document.querySelector('.inspector-head .tab[data-tab="preview"]'),
};
const previewState = {
  open: readPref('previewOpen', 'false') === 'true',
  userClosed: readPref('previewUserClosed', 'false') === 'true',
  ratio: Number(readPref('previewRatio', '0.5')),
  detached: false,
  placement: 'split',
  badge: false,
  baseline: new Set(), // terminals whose preview folder the main process has looked at
};
const previewPane = api.previewCheck && window.createPreviewPane ? window.createPreviewPane({
  api,
  onCollapse: () => togglePreview(),
  onDetach: () => api.previewDetach(),
  refocus: () => agents.get(activeId)?.term.focus(),
}) : null;

// Whether the drawing is on screen in this window.
function previewVisible() {
  if (!previewPane || previewState.detached) return false;
  if (previewState.placement === 'split') return previewState.open;
  return inspectorOpen() && inspectorTab === 'preview';
}

function renderPreviewToggle() {
  const t = previewEls.toggle;
  if (!t) return;
  t.hidden = !previewPane;
  t.setAttribute('aria-pressed', String(previewVisible() || previewState.detached));
  t.classList.toggle('has-new', previewState.badge && !previewVisible());
  t.title = previewState.detached ? '미리보기를 메인 창으로 되돌리기 (Ctrl+Shift+P)'
    : previewState.badge ? '새 그림이 있습니다 · 미리보기 (Ctrl+Shift+P)' : '미리보기 (Ctrl+Shift+P)';
}

// Beside the terminal or in the side panel, by the room there is.
function layoutPreview() {
  if (!previewPane) return;
  const centerW = previewEls.center.getBoundingClientRect().width;
  const placement = ViewLogic.previewPlacement(centerW);
  if (placement !== previewState.placement || !previewPane.el.parentElement) {
    previewState.placement = placement;
    (placement === 'split' ? previewEls.slot : previewEls.tabSlot).append(previewPane.el);
    if (placement === 'split' && inspectorTab === 'preview') setInspectorTab('activity');
  }
  const inline = placement === 'split' && previewState.open && !previewState.detached;
  previewEls.slot.hidden = !inline;
  previewEls.resizer.hidden = !inline;
  if (inline) previewEls.slot.style.width = `${ViewLogic.previewWidth(previewState.ratio, centerW)}px`;
  previewEls.tab.hidden = placement !== 'tab' || previewState.detached;
  renderPreviewToggle();
}

// The pane shows the active terminal's drawing while it is on screen, and
// nothing (no page running) while it is not. The first look at a terminal's
// folder is made even when hidden, so a later drawing counts as new.
function syncPreview() {
  if (!previewPane) return;
  layoutPreview();
  const visible = previewVisible();
  previewPane.setTarget(visible ? activeId : null);
  if (visible) previewState.badge = false;
  else if (activeId && !previewState.baseline.has(activeId)) {
    previewState.baseline.add(activeId);
    api.previewCheck(activeId).catch(() => {});
  }
  renderPreviewToggle();
}

// `byUser`: opened or closed by the user (then it stays closed for new drawings).
function setPreviewOpen(on, byUser) {
  previewState.open = on;
  writePref('previewOpen', on);
  if (byUser) {
    previewState.userClosed = !on;
    writePref('previewUserClosed', !on);
  }
  if (on && previewState.badge) previewPane.flash(); // the new drawing the dot was for
  if (on) previewState.badge = false;
  syncPreview();
}

function togglePreview() {
  if (!previewPane) return;
  if (previewState.detached) { api.previewAttach(); return; }
  if (previewState.placement === 'tab') {
    const showing = inspectorOpen() && inspectorTab === 'preview';
    previewState.userClosed = showing;
    writePref('previewUserClosed', showing);
    if (showing) setInspectorTab('activity');
    else {
      if (previewState.badge) previewPane.flash();
      previewState.badge = false;
      setInspectorOpen(true);
      setInspectorTab('preview');
    }
    syncPreview();
  } else {
    setPreviewOpen(!previewState.open, true);
  }
  agents.get(activeId)?.term.focus();
}

if (previewPane) {
  previewEls.toggle.addEventListener('click', togglePreview);
  dragResize(previewEls.resizer, 'resizing', () => {
    const r = previewEls.center.getBoundingClientRect();
    const at = (ev) => Math.min(0.95, Math.max(0.05, (r.right - ev.clientX) / r.width));
    return {
      move: (ev) => { previewState.ratio = at(ev); layoutPreview(); },
      end: (ev) => { previewState.ratio = at(ev); writePref('previewRatio', previewState.ratio); layoutPreview(); },
    };
  });
  previewEls.resizer.addEventListener('dblclick', () => {
    previewState.ratio = 0.5;
    writePref('previewRatio', 0.5);
    layoutPreview();
  });
  // A size change can move the preview into or out of the side panel: what
  // runs follows what shows.
  new ResizeObserver(() => syncPreview()).observe(previewEls.center);

  // A new drawing (Claude's Write/Edit, or a change seen while looking).
  api.onPreviewChanged((p) => {
    if (!p || (p.id !== activeId && !(p.shown && p.shown === previewPane.shown()))) return;
    const act = ViewLogic.previewOnChange({ open: previewVisible(), userClosed: previewState.userClosed, detached: previewState.detached });
    if (act === 'reload') previewPane.changed(p);
    else if (act === 'open') {
      previewPane.flash();
      if (previewState.placement === 'tab') { setInspectorOpen(true); setInspectorTab('preview'); } else setPreviewOpen(true, false);
    } else if (act === 'badge') {
      previewState.badge = true;
      renderPreviewToggle();
    }
  });
  api.onPreviewBlocked(() => previewPane.restore());
  api.onPreviewDetached((on) => {
    previewState.detached = Boolean(on);
    if (!on) { previewState.open = true; writePref('previewOpen', true); } // back beside the terminal
    syncPreview();
    if (on) api.previewSetActive(activeId);
  });
  // While it shows: a look every second (a change made outside Claude, or
  // missed), only with the window visible.
  setInterval(() => {
    if (previewVisible() && document.visibilityState === 'visible') previewPane.poll();
  }, 1000);
  api.previewIsDetached().then((on) => { previewState.detached = Boolean(on); syncPreview(); }).catch(() => {});
}

// ---------- inspector: 돌아보기 ----------
// One day of the records the main process keeps (journal.js): the commands
// approved most (to add to the project's allow list) and the requests made
// again and again (to turn into a skill). Nothing leaves this computer; the
// records can be deleted here.
const rv = {
  day: null, // null: today
  project: readPref('reviewProject', '') || null,
  data: null,
  open: new Set(), // expanded items
  picked: new Set(), // "project\nrule" checked for the bulk add
  pickedFix: new Set(), // keys of the corrections checked
  seq: 0,
  els: {
    prev: $('#rv-prev'), next: $('#rv-next'), day: $('#rv-day'), project: $('#rv-project'), enabled: $('#rv-enabled'),
    stats: $('#rv-stats'), msg: $('#rv-msg'), body: $('#rv-body'),
    clearDay: $('#rv-clear-day'), clearAll: $('#rv-clear-all'),
    dialog: $('#rv-dialog'), dialogBody: $('#rv-dialog-body'), dialogOk: $('#rv-dialog-ok'), dialogCancel: $('#rv-dialog-cancel'),
  },
};

const rvBase = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || '';
const rvDayLabel = (d) => { const [, m, dd] = d.split('-'); return `${Number(m)}월 ${Number(dd)}일`; };
const rvTime = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const rvRuleText = (rule) => { const m = /^Bash\((.*?)(?: \*|:\*)?\)$/.exec(rule); return m ? m[1] : rule; };

function rvMessage(text, kind = '') {
  rv.els.msg.hidden = !text;
  rv.els.msg.textContent = text || '';
  rv.els.msg.dataset.kind = kind;
}

async function loadReview() {
  if (!api.reviewSummary) return;
  const seq = ++rv.seq;
  const d = await api.reviewSummary(rv.day, rv.project).catch(() => null);
  if (seq !== rv.seq || !d) return;
  rv.data = d;
  if (rv.project && !d.projects.includes(rv.project) && d.projects.length) { rv.project = null; return loadReview(); }
  renderReview();
}

function renderReview() {
  const d = rv.data;
  const { els } = rv;
  els.day.replaceChildren(rvDayLabel(d.day), ...(d.day === d.today ? [h('span', 'rv-today', '오늘')] : []));
  // Days with records, plus today; newest first.
  const days = [...new Set([d.today, ...d.days])].sort().reverse();
  const at = days.indexOf(d.day);
  els.prev.disabled = at === -1 || at >= days.length - 1;
  els.next.disabled = at <= 0;
  els.project.replaceChildren(h('option', null, '모든 프로젝트'), ...d.projects.map((p) => {
    const o = h('option', null, rvBase(p));
    o.value = p;
    o.title = p;
    return o;
  }));
  els.project.firstChild.value = '';
  els.project.value = rv.project || '';
  els.enabled.checked = d.enabled;
  els.clearAll.title = `최근 ${d.keepDays}일 기록 전부 (이 PC에만 저장)`;
  const c = d.counts;
  els.stats.replaceChildren(...[['프롬프트', c.prompts], ['승인 요청', c.permissions], ['중단', c.interrupts], ['오류', c.errors]]
    .map(([k, n]) => { const s = h('span', null, `${k} `); s.append(h('b', null, String(n))); return s; }));
  els.clearDay.disabled = !d.days.includes(d.day);
  els.clearAll.disabled = !d.days.length;

  const body = [];
  if (!d.enabled) {
    const p = h('p', 'hint rv-empty', '기록 꺼짐 ');
    const on = h('button', 'btn rv-act', '켜기');
    on.type = 'button';
    on.addEventListener('click', () => setReviewEnabled(true));
    p.append(on);
    body.push(p);
  }
  if (!c.prompts && !c.permissions) {
    body.push(h('p', 'hint rv-empty', '기록 없음'));
  } else {
    body.push(...renderApprovals(d), ...renderRepeats(d), ...renderCorrections(d));
  }
  els.body.replaceChildren(...body);
}

function renderApprovals(d) {
  const head = h('h4', 'rv-h', '자주 승인한 명령');
  if (!d.approvals.length) return [head, h('p', 'hint', '없음')];
  const list = h('ul', 'rv-list');
  for (const g of d.approvals) {
    const key = `${g.project}\n${g.rule}`;
    const li = h('li', 'rv-item');
    const row = h('div', 'rv-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.disabled = g.added;
    box.checked = !g.added && rv.picked.has(key);
    box.setAttribute('aria-label', `${rvRuleText(g.rule)} 선택`);
    box.addEventListener('change', () => { if (box.checked) rv.picked.add(key); else rv.picked.delete(key); renderReview(); });
    const main = h('span', `rv-main${g.rule.startsWith('Bash(') ? ' mono' : ''}`, rvRuleText(g.rule));
    main.title = g.rule;
    main.addEventListener('click', () => { if (rv.open.has(key)) rv.open.delete(key); else rv.open.add(key); renderReview(); });
    row.append(box, main, h('span', 'rv-count', `${g.count}회`));
    const sub = h('div', 'rv-sub');
    const proj = h('span', 'rv-proj', rvBase(g.project));
    proj.title = g.project || '';
    const add = h('button', 'btn rv-act', g.added ? '추가됨' : '허용에 추가');
    add.type = 'button';
    add.disabled = g.added;
    add.addEventListener('click', () => confirmAllow(g.project, [g.rule]));
    sub.append(proj, add);
    li.append(row, sub);
    if (rv.open.has(key)) {
      const more = h('div', 'rv-more');
      more.append('넣을 규칙 ', h('code', null, g.rule), h('br'), '넣을 곳 ', h('code', null, `${rvBase(g.project)}/.claude/settings.local.json`));
      if (g.example) more.append(h('br'), '예: ', h('code', null, g.example.length > 120 ? `${g.example.slice(0, 120)}…` : g.example));
      li.append(more);
    }
    list.append(li);
  }
  const out = [head, list];
  const picked = d.approvals.filter((g) => !g.added && rv.picked.has(`${g.project}\n${g.rule}`));
  if (picked.length) {
    const bulk = h('div', 'rv-bulk');
    const b = h('button', 'btn primary rv-act', `선택한 ${picked.length}개 추가`);
    b.type = 'button';
    b.addEventListener('click', async () => {
      // One confirmation per project (each has its own settings file).
      for (const p of [...new Set(picked.map((g) => g.project))]) {
        if (!(await confirmAllow(p, picked.filter((g) => g.project === p).map((g) => g.rule)))) break;
      }
    });
    bulk.append(b);
    out.push(bulk);
  }
  return out;
}

function renderRepeats(d) {
  const head = h('h4', 'rv-h', '반복한 요청');
  if (!d.repeats.length) return [head, h('p', 'hint', '없음')];
  const list = h('ul', 'rv-list');
  for (const g of d.repeats) {
    const key = `repeat\n${g.key}`;
    const li = h('li', 'rv-item');
    const row = h('div', 'rv-row');
    const main = h('span', 'rv-main', `「${g.text}」`);
    main.title = g.text;
    main.addEventListener('click', () => { if (rv.open.has(key)) rv.open.delete(key); else rv.open.add(key); renderReview(); });
    row.append(main, h('span', 'rv-count', `${g.count}회${g.days > 1 ? `, ${g.days}일` : ''}`));
    const sub = h('div', 'rv-sub');
    const proj = h('span', 'rv-proj', g.project ? rvBase(g.project) : '여러 프로젝트');
    proj.title = g.project || '';
    const make = h('button', 'btn rv-act', '스킬 만들기');
    make.type = 'button';
    make.addEventListener('click', () => makeSkill(g));
    sub.append(proj, make);
    li.append(row, sub);
    if (rv.open.has(key)) {
      const more = h('div', 'rv-more', '실제로 보낸 말');
      for (const x of g.examples) {
        const ex = h('div', 'rv-ex');
        ex.append(h('time', null, rvTime(x.t)), x.text);
        more.append(ex);
      }
      li.append(more);
    }
    list.append(li);
  }
  return [head, list];
}

// Sentences that corrected how Claude works. The picked ones go to Claude
// as a request to turn them into what lives in the project's .claude/
// folder; CLAUDE.md is left to the user (a file the team shares).
function renderCorrections(d) {
  const head = h('h4', 'rv-h', '고쳐 준 말');
  if (!d.corrections.length) return [head, h('p', 'hint', '없음')];
  const list = h('ul', 'rv-list');
  for (const g of d.corrections) {
    const key = `fix\n${g.key}`;
    const li = h('li', 'rv-item');
    const row = h('div', 'rv-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = rv.pickedFix.has(g.key);
    box.setAttribute('aria-label', `${g.text} 선택`);
    box.addEventListener('change', () => { if (box.checked) rv.pickedFix.add(g.key); else rv.pickedFix.delete(g.key); renderReview(); });
    const main = h('span', 'rv-main', g.text);
    main.title = g.text;
    main.addEventListener('click', () => { if (rv.open.has(key)) rv.open.delete(key); else rv.open.add(key); renderReview(); });
    row.append(box, main, h('span', 'rv-count', `${g.count}회${g.days > 1 ? `, ${g.days}일` : ''}`));
    const sub = h('div', 'rv-sub');
    const proj = h('span', 'rv-proj', g.project ? rvBase(g.project) : '여러 프로젝트');
    proj.title = g.project || '';
    sub.append(proj);
    li.append(row, sub);
    if (rv.open.has(key)) {
      const more = h('div', 'rv-more', '보낸 말 전체');
      for (const x of g.examples) {
        const ex = h('div', 'rv-ex');
        ex.append(h('time', null, rvTime(x.t)), x.text);
        more.append(ex);
      }
      li.append(more);
    }
    list.append(li);
  }
  const out = [head, list];
  const picked = d.corrections.filter((g) => rv.pickedFix.has(g.key));
  const bulk = h('div', 'rv-bulk');
  const b = h('button', `btn rv-act${picked.length ? ' primary' : ''}`, picked.length ? `선택한 ${picked.length}개 .claude/에 만들기` : '.claude/에 만들기');
  b.title = 'Claude 입력칸에 요청을 채움 (CLAUDE.md 는 고치지 않음)';
  b.type = 'button';
  b.disabled = !picked.length;
  b.addEventListener('click', () => askClaudeDir(picked));
  bulk.append(b);
  out.push(bulk);
  return out;
}

async function askClaudeDir(picked) {
  const projects = [...new Set(picked.map((g) => g.project).filter(Boolean))];
  if (projects.length > 1) { rvMessage('한 프로젝트의 말만 골라 주세요', 'err'); return; }
  const text = await api.reviewPrompt(picked.map((g) => ({ text: g.text, count: g.count, days: g.days })));
  if (!text) return;
  await sendToClaude(projects[0] || null, text);
  rv.pickedFix.clear();
  renderReview();
}

// The confirmation for adding allow rules: what the file will hold. -> added?
function confirmAllow(project, rules) {
  return new Promise((resolve) => {
    const { els } = rv;
    const close = (v) => {
      els.dialog.hidden = true;
      els.dialogOk.onclick = null;
      els.dialogCancel.onclick = null;
      els.dialog.onkeydown = null;
      resolve(v);
    };
    els.dialogBody.replaceChildren(h('p', 'hint', '읽는 중…'));
    els.dialogOk.disabled = true;
    els.dialog.hidden = false;
    els.dialogCancel.onclick = () => close(false);
    els.dialog.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    els.dialogCancel.focus();
    api.reviewAllow(rv.data.day, project, rules, false).then((p) => {
      if (els.dialog.hidden) return;
      if (!p || p.error) { els.dialogBody.replaceChildren(h('p', 'hint', (p && p.error) || '읽지 못했습니다')); return; }
      const pre = h('pre');
      const lines = [...p.allow.map((r) => `      ${JSON.stringify(r)},`), ...p.add.map((r) => `+     ${JSON.stringify(r)},`)];
      if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
      pre.append('{\n  "permissions": {\n    "allow": [\n');
      for (const l of lines) pre.append(l.startsWith('+') ? h('span', 'rv-add', `${l}\n`) : `${l}\n`);
      pre.append('    ]\n  }\n}');
      els.dialogBody.replaceChildren(
        h('p', 'hint', `${p.file}${p.exists ? '' : ' (새 파일)'}`),
        pre,
        ...(p.ignored === false ? [h('p', 'hint', '+ .git/info/exclude (커밋 안 됨)')] : []),
      );
      els.dialogOk.disabled = !p.add.length;
      els.dialogOk.onclick = async () => {
        els.dialogOk.disabled = true;
        const r = await api.reviewAllow(rv.data.day, project, rules, true).catch((err) => ({ error: err.message }));
        close(Boolean(r && !r.error));
        if (!r || r.error) rvMessage((r && r.error) || '추가하지 못했습니다', 'err');
        else rvMessage(`${r.added}개 추가함`, 'ok');
        for (const rule of rules) rv.picked.delete(`${project}\n${rule}`);
        loadReview();
      };
    });
  });
}

// The Claude terminal of a project: the shown one first.
function claudeTerminalFor(project) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const inside = (cwd) => project && (norm(cwd) === norm(project) || norm(cwd).startsWith(`${norm(project)}/`));
  const all = [...agents.values()].filter((a) => a.info.claude && a.info.claude.status && a.info.status !== 'exited');
  const mine = project ? all.filter((a) => inside(a.info.claude.cwd || a.info.cwd)) : all;
  return mine.find((a) => a.info.id === activeId) || mine[0] || null;
}

// The request to turn the repeated prompts into a skill, put in the input of
// that project's Claude (not sent: the user reads it and presses Enter).
function makeSkill(g) {
  return sendToClaude(g.project, g.prompt);
}

async function sendToClaude(project, text) {
  const a = claudeTerminalFor(project);
  if (!a) {
    await api.clipboardWrite(text);
    rvMessage('Claude 터미널이 없어 클립보드에 복사함');
    return;
  }
  select(a.info.id);
  api.write(a.info.id, text);
  a.term.focus();
  rvMessage(a.info.claude.status === 'working'
    ? 'Claude 입력칸에 채움 · 작업이 끝난 뒤 Enter'
    : 'Claude 입력칸에 채움 · Enter로 보내기');
}

async function setReviewEnabled(on) {
  await api.reviewEnable(on);
  rvMessage(on ? '기록 켜짐' : '기록 꺼짐', 'ok');
  loadReview();
}

function stepReviewDay(delta) {
  const d = rv.data;
  if (!d) return;
  const days = [...new Set([d.today, ...d.days])].sort().reverse();
  const next = days[days.indexOf(d.day) + delta];
  if (!next) return;
  rv.day = next === d.today ? null : next;
  rv.open.clear();
  rv.picked.clear();
  rv.pickedFix.clear();
  rvMessage('');
  loadReview();
}

rv.els.prev.addEventListener('click', () => stepReviewDay(1));
rv.els.next.addEventListener('click', () => stepReviewDay(-1));
rv.els.project.addEventListener('change', () => {
  rv.project = rv.els.project.value || null;
  writePref('reviewProject', rv.project || '');
  rv.open.clear();
  rv.picked.clear();
  rv.pickedFix.clear();
  loadReview();
});
rv.els.enabled.addEventListener('change', () => setReviewEnabled(rv.els.enabled.checked));
rv.els.clearDay.addEventListener('click', async () => {
  const d = rv.data;
  if (!d || !window.confirm(`${rvDayLabel(d.day)} 기록을 지울까요? 되돌릴 수 없습니다.`)) return;
  await api.reviewClear(d.day);
  rv.day = null;
  rvMessage(`${rvDayLabel(d.day)} 기록 지움`, 'ok');
  loadReview();
});
rv.els.clearAll.addEventListener('click', async () => {
  if (!rv.data || !window.confirm(`모아 둔 기록(최근 ${rv.data.keepDays}일)을 전부 지울까요? 되돌릴 수 없습니다.`)) return;
  await api.reviewClear(null);
  rv.day = null;
  rvMessage('기록 전부 지움', 'ok');
  loadReview();
});
rv.els.dialog.addEventListener('click', (e) => { if (e.target === rv.els.dialog) rv.els.dialogCancel.click(); });

setInspectorTab(inspectorTab);
setInspectorOpen(readPref('inspectorOpen', 'true') === 'true');

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

dragResize(splitResizer, 'resizing-v', () => {
  const top = split.getBoundingClientRect().top;
  return {
    move: (ev) => applySplit(splitStateAt(ev.clientY - top)),
    end: (ev) => {
      const state = splitStateAt(ev.clientY - top);
      applySplit(state);
      saveSplit(state);
    },
  };
});
splitResizer.addEventListener('dblclick', () => { applySplit(null); saveSplit(null); });
{
  const saved = readPref('terminalsHeight', '');
  if (saved === 'top' || saved === 'bottom') applySplit(saved);
  else if (Number(saved) > 0) applySplit(Number(saved));
}

// ---------- bottom docks: plan usage, font size ----------
// Each dock has a title row and a body. Drag the border above a dock for its
// height (dragging it down to the title closes it); click the title to close
// it or to open it again at its last height; double-click the border for the
// default height. Open state and height are remembered per dock.
const DOCK_DEFAULT_H = { plan: 74, font: 66 };
const DOCK_SNAP = 14; // body px below which a drag closes the dock
const SPLIT_MIN_H = 140; // terminal list + shortcuts keep at least this

function dockEl(name) { return document.getElementById(`dock-${name}`); }
const dockHeadH = (el) => el.querySelector('.dock-head').offsetHeight;

function setDock(name, open, h, save = true) {
  const el = dockEl(name);
  el.classList.toggle('open', open);
  el.querySelector('.dock-head').setAttribute('aria-expanded', String(open));
  if (h > 0) el.style.setProperty('--dock-h', `${Math.round(h)}px`);
  if (save) {
    writePref(`dock.${name}.open`, open);
    if (h > 0) writePref(`dock.${name}.h`, Math.round(h));
  }
  requestAnimationFrame(fitActive);
}

const savedDockH = (name) => Number(readPref(`dock.${name}.h`, '')) || DOCK_DEFAULT_H[name];

for (const el of document.querySelectorAll('.dock')) {
  const name = el.dataset.dock;
  el.querySelector('.dock-head').addEventListener('click', () => {
    const open = !el.classList.contains('open');
    setDock(name, open, open ? savedDockH(name) : 0);
  });
}
for (const handle of document.querySelectorAll('.dock-resizer')) {
  const name = handle.dataset.dock;
  dragResize(handle, 'resizing-v', () => {
    const el = dockEl(name);
    handle.classList.add('dragging');
    const bottom = el.getBoundingClientRect().bottom;
    const head = dockHeadH(el);
    const max = el.offsetHeight + split.offsetHeight - SPLIT_MIN_H;
    const at = (ev) => {
      const h = Math.min(max, bottom - ev.clientY);
      return h < head + DOCK_SNAP ? null : h;
    };
    return {
      move: (ev) => { const h = at(ev); setDock(name, h !== null, h || 0, false); },
      end: (ev) => {
        handle.classList.remove('dragging');
        const h = at(ev);
        setDock(name, h !== null, h || 0); // closing keeps the last height for reopening
      },
    };
  });
  handle.title = '끌어서 높이 조절 (끝까지 내리면 닫기) · 더블클릭: 기본 높이';
  handle.addEventListener('dblclick', () => setDock(name, true, DOCK_DEFAULT_H[name]));
}
for (const name of Object.keys(DOCK_DEFAULT_H)) {
  setDock(name, readPref(`dock.${name}.open`, 'true') === 'true', savedDockH(name), false);
}

// ---------- plan usage ----------
// The claude.ai "current session" limit (5-hour window), reported through the
// status line of claude in app terminals (plan-usage.js). Account-wide.
const planEls = {
  summary: $('#plan-summary'), bar: document.querySelector('.plan-bar'), fill: $('#plan-fill'),
  reset: $('#plan-reset'), badge: $('#plan-badge'), dock: dockEl('plan'),
};
let planValue = null;

function untilText(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  const hr = Math.floor(min / 60);
  return hr ? `${hr}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}

function clockText(t) {
  const d = new Date(t);
  const hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function renderPlan() {
  const now = Date.now();
  const p = planValue;
  const reset = Boolean(p && p.resetsAt && now >= p.resetsAt); // window over: starts again at 0
  const pct = p ? (reset ? 0 : p.pct) : null;
  const level = pct === null ? '' : contextLevel(pct);
  planEls.summary.textContent = pct === null ? '—' : `${pct}%`;
  planEls.summary.dataset.level = level;
  planEls.bar.dataset.level = level;
  planEls.fill.style.width = `${pct || 0}%`;
  planEls.reset.textContent = !p ? '앱 터미널의 Claude가 응답하면 표시됩니다 (claude.ai 구독 요금제).'
    : reset ? '초기화됨 · 다음 응답부터 다시 집계됩니다.'
    : p.resetsAt ? `${clockText(p.resetsAt)} 초기화 (${untilText(p.resetsAt - now)} 뒤)` : '';
  const tip = p ? `claude.ai 현재 세션(5시간) 한도 ${pct}% 사용 · ${clockText(p.at)}에 받은 값 (바뀔 때만 보고됨)` : '현재 세션 사용량: 아직 값 없음';
  planEls.dock.title = tip;
  if (pct === null) planEls.badge.setAttribute('data-empty', '');
  else planEls.badge.removeAttribute('data-empty');
  planEls.badge.textContent = pct === null ? '' : `세션 ${pct}%`;
  planEls.badge.dataset.level = level;
  planEls.badge.title = tip;
}

setInterval(renderPlan, 30000);
renderPlan();
if (api.planUsage) api.planUsage().then((v) => { if (v) { planValue = v; renderPlan(); } }).catch(() => {});
if (api.onPlanUsage) api.onPlanUsage((v) => { planValue = v; renderPlan(); });

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
api.onShell?.(({ id }) => shellSeen.set(id, Date.now()));
api.onRemoved?.(({ id }) => shellSeen.delete(id));
api.onExit(({ id, exitCode }) => {
  const a = agents.get(id);
  if (!a) return;
  a.term.write(`\r\n\x1b[90m[프로세스 종료: 코드 ${exitCode}]\x1b[0m\r\n`);
  update(id, { status: 'exited' });
});
api.onRemoved(({ id }) => removeAgent(id));
if (api.onActivity) api.onActivity(({ id, entry }) => onActivity(id, entry));

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
