'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const pty = require('node-pty');
const { SessionManager } = require('./sessions');
const { startHookServer } = require('./hook-server');
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

let win = null;
let manager = null;
let plan = null;

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

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
  ipcMain.handle('files:list', (_e, id, rel, fresh) => manager.fileTree(str(id, 20), str(rel, 4000) ?? '', fresh === true));
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
    if (d !== null && (kind === 7 || kind === 9)) manager.setCwd(str(id, 20), parseCwdReport(kind, d), true);
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

  // Links printed in a terminal open in the system browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
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
  hooks = await startHookServer({
    onEvent: (id, ev, meta) => manager && manager.onHookEvent(id, ev, meta),
    onCwd: (id, report) => manager && manager.reportShellCwd(id, report),
    onStatusLine: (_id, data) => plan && plan.report(data),
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
    claudePaths: {
      dir: claudeDir(),
      json: process.env.CLAUDE_CONFIG_DIR
        ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
        : path.join(require('node:os').homedir(), '.claude.json'),
    },
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (manager) manager.killAll();
  if (hooks) hooks.close();
  if (settingsFile) { try { fs.unlinkSync(settingsFile); } catch { /* already gone */ } }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
