'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const pty = require('node-pty');
const { SessionManager } = require('./sessions');
const { startHookServer } = require('./hook-server');
const { buildClaudeSettings } = require('./claude-settings');
const { shellLaunch, parseCwdReport, INIT_DIR } = require('./shell');
const { withWslEnv } = require('./wsl');
const { gitBranch } = require('./git');
const { readTeam, readTasks } = require('./teams');

let win = null;
let manager = null;

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
  ipcMain.handle('session:kill', (_e, id) => manager.kill(str(id, 20)));
  ipcMain.handle('session:sendLine', (_e, id, text) => manager.sendLine(str(id, 20), str(text) ?? ''));
  ipcMain.on('session:write', (_e, id, data) => {
    const d = str(data);
    if (d !== null) manager.write(str(id, 20), d);
  });
  ipcMain.on('session:resize', (_e, id, cols, rows) => manager.resize(str(id, 20), int(cols), int(rows)));
  ipcMain.handle('session:reorder', (_e, ids) =>
    manager.reorder(Array.isArray(ids) ? ids.slice(0, 500).map((x) => str(x, 20)).filter(Boolean) : []));
  ipcMain.handle('session:rename', (_e, id, name) => manager.rename(str(id, 20), str(name, 200) ?? ''));
  // Raw OSC 7 / OSC 9;9 payload from the terminal; parsed here, not in the page.
  ipcMain.on('session:cwd', (_e, id, kind, data) => {
    const d = str(data, 4000);
    if (d !== null && (kind === 7 || kind === 9)) manager.setCwd(str(id, 20), parseCwdReport(kind, d));
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
}

// One app instance: the hooks settings file and its port belong to it.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

let hooks = null;

app.whenReady().then(async () => {
  // Claude Code hooks for app terminals only: a local receiver plus a settings
  // file that the shell integration passes to claude with --settings.
  hooks = await startHookServer({
    onEvent: (id, ev) => manager && manager.onHookEvent(id, ev),
    onCwd: (id, report) => manager && manager.reportShellCwd(id, report),
  });
  const settingsFile = path.join(app.getPath('userData'), 'claude-hooks.json');
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
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
