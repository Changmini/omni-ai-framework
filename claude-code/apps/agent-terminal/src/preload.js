'use strict';

// The only bridge between the page and the main process. The page gets these
// functions and nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (handler) => {
  const listener = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('agentApi', {
  platform: process.platform,
  create: (opts) => ipcRenderer.invoke('session:create', opts),
  list: () => ipcRenderer.invoke('session:list'),
  kill: (id) => ipcRenderer.invoke('session:kill', id),
  sendLine: (id, text) => ipcRenderer.invoke('session:sendLine', id, text),
  write: (id, data) => ipcRenderer.send('session:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', id, cols, rows),
  rename: (id, name) => ipcRenderer.invoke('session:rename', id, name),
  claudeConfig: (id) => ipcRenderer.invoke('session:config', id),
  focusPane: (id, target) => ipcRenderer.invoke('session:focusPane', id, target),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  reorder: (ids) => ipcRenderer.invoke('session:reorder', ids),
  reportCwd: (id, kind, data) => ipcRenderer.send('session:cwd', id, kind, data),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  onData: on('session:data'),
  onExit: on('session:exit'),
  onStatus: on('session:status'),
  onRemoved: on('session:removed'),
  onAgent: on('session:agent'),
  onMeta: on('session:meta'),
});
