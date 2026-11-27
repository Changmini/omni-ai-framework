'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, protocol, screen, session, webFrameMain } = require('electron');
const pty = require('node-pty');
const { SessionManager } = require('./sessions');
const { startHookServer } = require('./hook-server');
const { Rules } = require('./rules');
const { buildClaudeSettings } = require('./claude-settings');
const { shellLaunch, parseCwdReport, INIT_DIR } = require('./shell');
const { withWslEnv } = require('./wsl');
const { gitBranch } = require('./git');
const { readTeam, readTasks, claudeDir } = require('./teams');
const { scanClaudeConfig } = require('./claude-config');
const { runTmux, listPanes } = require('./tmux');
const { readContextUsage } = require('./usage');
const { PlanUsage } = require('./plan-usage');
const { readTextFile } = require('./files');
const preview = require('./preview');
const reap = require('./reap');
const appSkills = require('./app-skills');
const { Results, Automation } = require('./automation');
const { wslToWindows } = require('./wsl');

let win = null;
let manager = null;
let plan = null;
// The automation rules: run on the main session of a terminal only.
const rules = new Rules({
  emit: (ch, p) => send(ch, p),
  meta: (id, sid, cwd) => (manager ? manager.ruleMeta(id, sid, cwd) : null),
  record: (e) => { if (results) results.add({ ...e, kind: 'hook' }); },
});
let results = null; // the 자동화 결과 tab
let automation = null; // timer rules
// WSL homes the terminals reported, kept across runs: a timer run at start
// reads Claude's files there before any WSL terminal is open again.
const wslHomesFile = () => path.join(app.getPath('userData'), 'automation-wsl.json');
function claudeDirs() {
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(wslHomesFile(), 'utf8')); } catch { saved = []; }
  const seen = new Map((Array.isArray(saved) ? saved : []).map((w) => [`${w.distro}|${w.home}`, w]));
  const before = seen.size;
  for (const w of manager ? manager.wslHomes() : []) seen.set(`${w.distro}|${w.home}`, w);
  if (seen.size !== before) { try { fs.writeFileSync(wslHomesFile(), JSON.stringify([...seen.values()])); } catch { /* next time */ } }
  const dirs = [{ dir: claudeDir(), distro: null }];
  if (process.platform === 'win32') {
    for (const w of seen.values()) {
      const dir = wslToWindows(`${String(w.home).replace(/\/$/, '')}/.claude`, w.distro);
      if (dir) dirs.push({ dir, distro: w.distro });
    }
  }
  return dirs;
}
let previewWin = null; // the preview in its own window, when detached
let previewActive = null; // the terminal the main window shows (the detached preview follows it)
let previewWatch = null;

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};
const sendPreview = (channel, payload) => {
  send(channel, payload);
  if (previewWin && !previewWin.isDestroyed()) previewWin.webContents.send(channel, payload);
};

// The HTML preview's pages come from omni-preview://t<terminal id>/<path in
// private/>: an origin of their own (not the app's file:// pages), shown in
// a sandboxed iframe without allow-same-origin, so a drawing's scripts
// reach nothing of the app. Registered before the app is ready.
const PREVIEW_SCHEME = 'omni-preview';
protocol.registerSchemesAsPrivileged([
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

async function servePreview(request) {
  const head = (status, type) => ({
    status,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': preview.PAGE_CSP, 'X-Content-Type-Options': 'nosniff' },
  });
  try {
    const u = new URL(request.url);
    const m = /^t(\d{1,6})$/.exec(u.hostname);
    const target = m && manager ? await manager.previewDir(m[1]) : null;
    const segs = preview.urlSegments(u.pathname);
    if (!target || target.error || !segs) return new Response('not found', head(404, 'text/plain'));
    const r = await preview.serveFile(target.dir, segs);
    return new Response(r.body, head(r.status, r.type));
  } catch {
    return new Response('error', head(500, 'text/plain'));
  }
}

// The state of terminal `id`'s preview, checking the file now (a change is
// announced to every window by the watch).
async function checkPreview(id, wrote = false) {
  const target = id && manager ? await manager.previewDir(id) : null;
  if (!target) return { error: '미리보기 폴더를 찾을 수 없습니다' };
  if (target.error) return { error: target.error, shown: target.shown };
  const st = await previewWatch.check(target.dir, { id, shown: target.shown }, wrote);
  return { ...st, shown: target.shown, url: `${PREVIEW_SCHEME}://t${id}/` };
}

// Pages of both windows: frames may only show preview pages, so a drawing
// cannot take its frame to another site or to a local file. The windows'
// own CSP (frame-src omni-preview:) refuses such a navigation however it
// starts; will-frame-navigate also stops the ones it is told of (a page's
// timer is not). A refused one leaves an error page in the frame: the pane
// is told to show the drawing again. Only for the preview frame itself: a
// frame inside a drawing is refused by the drawing's own CSP (frame-src
// 'none') and must not reload the drawing (it would again, and again).
// New windows are never opened by a page.
function guardNavigation(wc) {
  const preview = (url) => String(url).startsWith(`${PREVIEW_SCHEME}://`);
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !preview(e.url)) e.preventDefault();
  });
  wc.on('did-fail-provisional-load', (_e, _code, _desc, url, isMainFrame, pid, rid) => {
    if (isMainFrame || preview(url) || url === 'about:blank') return;
    // A frame already gone throws when read: then nothing is restored.
    let previewFrame = false;
    try {
      const frame = webFrameMain.fromId(pid, rid);
      previewFrame = Boolean(frame && frame.parent && !frame.parent.parent);
    } catch { /* gone */ }
    if (previewFrame) wc.send('preview:blocked');
  });
}

// The detached preview window: same app, a window of its own (another
// monitor, say). Its place is remembered; closing it brings the preview
// back beside the terminal.
const previewBoundsFile = () => path.join(app.getPath('userData'), 'preview-window.json');
function previewBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(previewBoundsFile(), 'utf8'));
    const ok = [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 320 && b.height >= 240;
    // Only where a display still is (a monitor may be gone).
    const area = ok && screen.getDisplayMatching(b).workArea;
    if (ok && area && b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y < area.y + area.height - 40 && b.y + b.height > area.y) return b;
  } catch { /* none yet */ }
  return { width: 900, height: 700 };
}

function openPreviewWindow() {
  if (previewWin && !previewWin.isDestroyed()) { previewWin.focus(); return; }
  previewWin = new BrowserWindow({
    ...previewBounds(),
    minWidth: 320,
    minHeight: 240,
    backgroundColor: '#14161c',
    title: '미리보기 · Omni Agent Terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  previewWin.loadFile(path.join(__dirname, 'renderer', 'preview.html'));
  previewWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  previewWin.webContents.on('will-navigate', (e) => e.preventDefault());
  guardNavigation(previewWin.webContents);
  const save = () => {
    if (!previewWin || previewWin.isDestroyed() || previewWin.isMinimized()) return;
    try { fs.writeFileSync(previewBoundsFile(), JSON.stringify(previewWin.getNormalBounds())); } catch { /* not saved */ }
  };
  previewWin.on('close', save);
  previewWin.on('closed', () => {
    previewWin = null;
    send('preview:detached', false);
  });
  send('preview:detached', true);
}

const str = (v, max = 100000) => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v) => (Number.isInteger(v) && v > 0 && v < 10000 ? v : null);

function registerIpc() {
  ipcMain.handle('session:create', (_e, opts = {}) =>
    manager.create({
      name: str(opts.name, 80) ?? '',
      cwd: str(opts.cwd, 1000) ?? '',
      command: str(opts.command, 1000) ?? '',
      cols: int(opts.cols) ?? 100,
      rows: int(opts.rows) ?? 30,
    }),
  );
  ipcMain.handle('session:list', () => manager.list());
  ipcMain.handle('plan:get', () => plan.get());
  ipcMain.handle('session:kill', (_e, id) => manager.kill(str(id, 20)));
  ipcMain.handle('session:sendLine', (_e, id, text) => manager.sendLine(str(id, 20), str(text) ?? ''));
  ipcMain.on('session:write', (_e, id, data) => {
    const d = str(data);
    if (d !== null) manager.write(str(id, 20), d);
  });
  ipcMain.on('rules:set', (_e, state) => {
    rules.set(state);
    if (!automation) return;
    automation.tick();
    send('automation:state', automation.state()); // the timer rules the page now has
  });
  // The 자동화 결과 tab, and timer rules run from the 자동화 tab.
  ipcMain.handle('results:list', () => (results ? results.list() : []));
  ipcMain.handle('results:remove', (_e, id) => { if (results) results.remove(str(id, 40)); });
  ipcMain.handle('results:clear', () => { if (results) results.clear(); });
  ipcMain.handle('automation:run', (_e, ruleId) => (automation ? automation.runNow(str(ruleId, 40)) : false));
  ipcMain.handle('automation:state', () => (automation ? automation.state() : {}));
  ipcMain.handle('rules:recent', () => rules.recentEvents());
  ipcMain.on('session:resize', (_e, id, cols, rows) => manager.resize(str(id, 20), int(cols), int(rows)));
  ipcMain.handle('session:reorder', (_e, ids) =>
    manager.reorder(Array.isArray(ids) ? ids.slice(0, 500).map((x) => str(x, 20)).filter(Boolean) : []));
  // Clipboard and links go through here: the page itself stays sandboxed.
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_e, text) => {
    const t = str(text, 10 * 1024 * 1024);
    if (t !== null) clipboard.writeText(t);
  });
  ipcMain.handle('open-external', (_e, url) => {
    const u = str(url, 4000);
    if (u && /^https?:\/\//i.test(u)) shell.openExternal(u);
  });
  // A file from the activity log, in VS Code.
  // Without a vscode:// handler Windows would show its own "get an app"
  // dialog and still report success, so check for one first.
  ipcMain.handle('open-file', async (_e, id, file) => {
    if (!(await manager.resolveFile(str(id, 20), str(file, 4000)))) return false;
    const url = manager.editorUrl(str(id, 20), str(file, 4000));
    if (!url || !app.getApplicationNameForProtocol('vscode://')) return false;
    try { await shell.openExternal(url); return true; } catch { return false; }
  });
  // The in-app viewer: read a file, show it in the system file manager, and
  // whether a vscode:// handler exists. Only files the session allows.
  ipcMain.handle('file:read', async (_e, id, file) => {
    const t = await manager.resolveFile(str(id, 20), str(file, 4000));
    if (!t) return { error: '이 파일은 열 수 없습니다' };
    return { path: t.path, ...(await readTextFile(t.host)) };
  });
  ipcMain.handle('file:reveal', async (_e, id, file) => {
    const t = await manager.resolveFile(str(id, 20), str(file, 4000));
    // Asynchronous: over \\wsl.localhost this can wait for WSL to start.
    if (!t || !(await fs.promises.access(t.host).then(() => true, () => false))) return false;
    shell.showItemInFolder(t.host);
    return true;
  });
  // The 스킬 tab: the omni-pipeline plugin's skills and agents, and its Markdown files.
  ipcMain.handle('skills:list', () => {
    const data = appSkills.readAppSkills();
    return data && { ...data, installed: appSkills.installedElsewhere(claudeDir()) };
  });
  ipcMain.handle('skills:read', (_e, rel) => {
    const text = appSkills.readAppSkillFile(str(rel, 400));
    return text == null ? { error: '이 파일은 열 수 없습니다' } : { path: `omni-pipeline/${rel}`, text, size: Buffer.byteLength(text) };
  });
  ipcMain.handle('files:list', (_e, id, rel, fresh) => manager.fileTree(str(id, 20), str(rel, 4000) ?? '', fresh === true));
  ipcMain.handle('files:all', (_e, id) => manager.fileList(str(id, 20)));
  ipcMain.handle('files:grep', (_e, id, query) => manager.searchText(str(id, 20), str(query, 400)));
  ipcMain.handle('preview:check', (_e, id) => checkPreview(str(id, 20)));
  ipcMain.handle('preview:open-external', async (_e, id) => {
    const target = await manager.previewDir(str(id, 20));
    const file = target && !target.error && path.join(target.dir, preview.INDEX);
    if (!file || !(await fs.promises.access(file).then(() => true, () => false))) return false;
    return (await shell.openPath(file)) === '';
  });
  ipcMain.handle('preview:active', (_e, id) => {
    previewActive = str(id, 20);
    if (previewWin && !previewWin.isDestroyed()) previewWin.webContents.send('preview:target', previewActive);
    return true;
  });
  ipcMain.handle('preview:target', () => previewActive);
  ipcMain.handle('preview:detach', () => { openPreviewWindow(); return true; });
  ipcMain.handle('preview:attach', () => {
    if (previewWin && !previewWin.isDestroyed()) previewWin.close();
    return true;
  });
  ipcMain.handle('preview:detached', () => Boolean(previewWin && !previewWin.isDestroyed()));
  ipcMain.handle('git:status', (_e, id, fresh) => manager.gitStatus(str(id, 20), fresh !== false));
  ipcMain.handle('git:untracked', (_e, id, dir) => manager.gitUntracked(str(id, 20), str(dir, 4000)));
  ipcMain.handle('git:diff', (_e, id, path) => manager.gitDiff(str(id, 20), str(path, 4000)));
  ipcMain.handle('git:show', (_e, id, rev) => manager.gitShow(str(id, 20), str(rev, 80)));
  ipcMain.handle('editor:available', () => Boolean(app.getApplicationNameForProtocol('vscode://')));
  ipcMain.handle('session:activity', (_e, id) => manager.activity(str(id, 20)));
  ipcMain.handle('session:focusPane', (_e, id, target) => manager.focusPane(str(id, 20), str(target, 200)));
  ipcMain.handle('session:config', (_e, id) => manager.claudeConfig(str(id, 20)));
  ipcMain.handle('session:rename', (_e, id, name) => manager.rename(str(id, 20), str(name, 200) ?? ''));
  // Raw OSC 7 / OSC 9;9 payload from the terminal; parsed here, not in the page.
  ipcMain.on('session:cwd', (_e, id, kind, data) => {
    const d = str(data, 4000);
    if (d !== null && (kind === 7 || kind === 9)) {
      manager.setCwd(str(id, 20), parseCwdReport(kind, d), true);
      manager.shellReported(str(id, 20));
    }
  });
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#14161c', // same as --bg in styles.css, no white flash
    title: 'Omni Agent Terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // The main window is the app: closing it also closes a detached preview,
  // so the app quits (window-all-closed) instead of running on unseen.
  win.on('closed', () => {
    win = null;
    if (previewWin && !previewWin.isDestroyed()) previewWin.close();
  });

  // Links printed in a terminal open in the system browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  guardNavigation(win.webContents);
  // F12 keeps developer tools reachable without the default menu.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

// One app instance. A second launch only focuses the first window and does
// nothing else: app.quit() is asynchronous, so without this guard the second
// process would still start a hook server and write its own settings file.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

let hooks = null;
let settingsFile = null;

if (primaryInstance) app.whenReady().then(async () => {
  // Electron's default menu binds Ctrl+Shift+I (developer tools), Ctrl+R
  // (reload, which drops every terminal's scrollback) and others that clash
  // with the app's shortcuts. Windows and Linux need no menu; macOS keeps it
  // for Cmd+C / Cmd+V in text fields.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // Claude Code hooks for app terminals only: a local receiver plus a settings
  // file that the shell integration passes to claude with --settings.
  previewWatch = new preview.PreviewWatch({ emit: ({ key, version }) => sendPreview('preview:changed', { id: key.id, shown: key.shown, version }) });
  protocol.handle(PREVIEW_SCHEME, servePreview);
  // A drawing's page asks for nothing (camera, notifications, ...): refused.
  // A sandboxed frame without allow-same-origin has the opaque origin "null";
  // the app's own pages are file://.
  const fromPreview = (url) => String(url || '').startsWith(`${PREVIEW_SCHEME}:`) || String(url) === 'null';
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb, details) => cb(!fromPreview(details && details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, origin) => !fromPreview(origin));
  hooks = await startHookServer({
    onEvent: (id, ev, meta) => {
      if (manager) manager.onHookEvent(id, ev, meta);
      if (ev && !meta.pane) rules.onEvent(String(id), ev);
      // Claude wrote the preview: shown at once, not at the next look.
      const file = ev && ev.tool_input && ev.tool_input.file_path;
      if (manager && ev && ev.hook_event_name === 'PostToolUse' && /^(Write|Edit|MultiEdit)$/.test(ev.tool_name || '')
        && typeof file === 'string' && /(^|[\\/])private[\\/]index\.html$/.test(file)) {
        checkPreview(String(id), true).catch(() => {});
      }
    },
    onCwd: (id, report) => manager && manager.reportShellCwd(id, report),
    onStatusLine: (id, data) => {
      if (plan) plan.report(data);
      if (manager) manager.onStatusLine(id, data);
    },
    onReply: (id, ev) => rules.reply(String(id), ev),
  });
  plan = new PlanUsage({ emit: send });
  // Per process, so no other instance can ever overwrite the port in it.
  settingsFile = path.join(app.getPath('userData'), `claude-hooks-${process.pid}.json`);
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(buildClaudeSettings(hooks.port), null, 2));

  manager = new SessionManager({
    spawn: pty.spawn,
    emit: send,
    shell: shellLaunch(),
    extraEnv: {
      OMNI_CLAUDE_SETTINGS: settingsFile,
      // The repository's omni-pipeline plugin, added by the claude wrapper (shell-init).
      OMNI_PLUGIN_DIR: appSkills.PLUGIN_DIR,
      OMNI_HOOK_TOKEN: hooks.token,
      OMNI_CWD_URL: hooks.cwdUrl,
      // For `wsl` typed in an app PowerShell terminal (see shell-init/omni.ps1).
      ...(process.platform === 'win32'
        ? { OMNI_INIT_BASH: path.join(INIT_DIR, 'omni.bash'), WSLENV: withWslEnv(process.env.WSLENV) }
        : {}),
    },
    readTeam,
    readTasks,
    gitBranch,
    scanConfig: scanClaudeConfig,
    runTmux,
    listPanes,
    readUsage: readContextUsage,
    runId: reap.newRunId(),
    reaper: {
      terminal: (run, id, distros, live) => reap.reapTerminal(run, id, { distros, live }),
      recheck: (run, live) => reap.recheckTmux(run, { live }),
      all: (run, distros) => reap.reapAllSync(run, { distros }),
    },
    claudePaths: {
      dir: claudeDir(),
      json: process.env.CLAUDE_CONFIG_DIR
        ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
        : path.join(require('node:os').homedir(), '.claude.json'),
    },
  });
  results = new Results({ file: path.join(app.getPath('userData'), 'automation-results.json'), emit: (items) => send('results:changed', items) });
  automation = new Automation({
    rules, results, claudeDirs,
    stateFile: path.join(app.getPath('userData'), 'automation-state.json'),
    emit: (state) => send('automation:state', state),
  });
  registerIpc();
  createWindow();
  automation.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (automation) automation.stop();
  if (manager) manager.killAll();
  if (hooks) hooks.close();
  if (settingsFile) { try { fs.unlinkSync(settingsFile); } catch { /* already gone */ } }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
