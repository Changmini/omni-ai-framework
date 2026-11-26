'use strict';

// The bridge of the detached preview window: only what the preview needs
// (its state, opening the drawing in the browser, going back into the main
// window). The drawing itself runs in a sandboxed frame and sees none of it.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (handler) => {
  const listener = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('previewApi', {
  previewCheck: (id) => ipcRenderer.invoke('preview:check', id),
  previewOpenExternal: (id) => ipcRenderer.invoke('preview:open-external', id),
  previewAttach: () => ipcRenderer.invoke('preview:attach'),
  previewTarget: () => ipcRenderer.invoke('preview:target'),
  onPreviewChanged: on('preview:changed'),
  onPreviewTarget: on('preview:target'),
  onPreviewBlocked: on('preview:blocked'),
});
