// Flicker — preload script
// Exposes a narrow, safe API to the renderer (flicker.html) instead of
// giving it raw Node/Electron access. contextIsolation stays on.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flicker', {
  pickFolder: (promptText) => ipcRenderer.invoke('pick-folder', promptText),
  listFiles: (dir) => ipcRenderer.invoke('list-files', dir),
  fileOp: (params) => ipcRenderer.invoke('file-op', params),
  openFolder: (sourceDir) => ipcRenderer.invoke('open-folder', { sourceDir })
});
