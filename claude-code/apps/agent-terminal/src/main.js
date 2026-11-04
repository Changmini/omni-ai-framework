'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const pty = require('node-pty');
const { SessionManager } = require('./sessions');

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

app.whenReady().then(() => {
  manager = new SessionManager({ spawn: pty.spawn, emit: send });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => manager && manager.killAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
