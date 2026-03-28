/**
 * Electron Preload Script
 * 通过 contextBridge 向渲染进程安全暴露窗口控制 API 和自动更新 API
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onBootLog: (callback) => ipcRenderer.on('boot-log', (_event, msg) => callback(msg)),

  // 自动更新
  update: {
    /** 监听更新状态变化 (status: 'checking' | 'downloading' | 'ready' | 'idle' | 'error') */
    onStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('update-status', handler);
      return () => ipcRenderer.removeListener('update-status', handler);
    },
    /** 手动触发检查更新 */
    checkForUpdate: () => ipcRenderer.invoke('update-check'),
    /** 安装已下载的更新并重启 */
    install: () => ipcRenderer.send('update-install'),
  },
});
