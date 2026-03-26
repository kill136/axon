/**
 * Electron Preload Script
 * 通过 contextBridge 向渲染进程安全暴露窗口控制 API
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onBootLog: (callback) => ipcRenderer.on('boot-log', (_event, msg) => callback(msg)),
});
