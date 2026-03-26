/**
 * Axon Desktop - Electron Main Process
 *
 * 架构：Electron 做浏览器窗口壳，内嵌标准 Node.js 运行 Web 服务器。
 * - Electron 进程：只管窗口，不运行业务代码
 * - Node.js 子进程：用内嵌的 node.exe 运行 dist/web-cli.js
 * - 两者通过 HTTP 通信（localhost:3456）
 *
 * 为什么不用 Electron 内置 Node.js？
 * 1. native module (better-sqlite3 等) 的 NODE_MODULE_VERSION 和 Electron 不匹配
 * 2. fork() 的 ELECTRON_RUN_AS_NODE 模式有各种兼容性坑
 * 3. Electron GUI 没有 stdout，pipe 输出会 EPIPE 崩溃
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3456;

/** 向渲染进程发送启动日志 */
function sendLog(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('boot-log', msg);
  }
}

/**
 * 查找内嵌的 node 二进制
 * 开发模式下用系统 node
 */
function findNodeExe() {
  const appRoot = path.join(__dirname, '..');
  const isWin = process.platform === 'win32';
  const nodeBin = isWin ? 'node.exe' : 'node';

  // 候选路径（按平台不同）
  const candidates = [
    // Windows: <installDir>/node/node.exe
    //   appRoot = <installDir>/resources/app → ../../node/node.exe
    path.join(appRoot, '..', '..', 'node', nodeBin),
    // macOS / Linux AppImage: Contents/Resources/app (or usr/share/axon/app) → ../node/node
    path.join(appRoot, '..', 'node', nodeBin),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 开发模式：用系统 node
  return 'node';
}

/**
 * 启动 Web 服务器子进程
 */
function startServer() {
  const appRoot = path.join(__dirname, '..');
  const nodeExe = findNodeExe();
  const serverScript = path.join(appRoot, 'dist', 'web-cli.js');

  // 日志文件（写到用户目录，便于排错）
  const logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logFile = path.join(logDir, 'server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const startTime = `${new Date().toISOString()}`;
  logStream.write(`\n=== Axon Server Start: ${startTime} ===\n`);
  logStream.write(`Node: ${nodeExe}\n`);
  logStream.write(`Script: ${serverScript}\n`);
  logStream.write(`CWD: ${appRoot}\n\n`);

  sendLog(`[${startTime}] Axon Server starting...`);
  sendLog(`Node: ${nodeExe}`);
  sendLog(`Script: ${serverScript}`);

  serverProcess = spawn(
    nodeExe,
    [serverScript, '--port', String(SERVER_PORT), '--no-open', '--host', '127.0.0.1'],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_MODE: '1',
        NODE_ENV: 'production',
      },
      // Windows 上隐藏控制台窗口（macOS/Linux 无影响）
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // 日志写文件 + 推送到 loading 页面
  serverProcess.stdout.on('data', (data) => {
    logStream.write(data);
    const text = data.toString().trim();
    if (text) sendLog(text);
  });
  serverProcess.stderr.on('data', (data) => {
    logStream.write(data);
    const text = data.toString().trim();
    if (text) sendLog(`[stderr] ${text}`);
  });

  serverProcess.on('error', (err) => {
    logStream.write(`[ERROR] Failed to start: ${err.message}\n`);
    sendLog(`[ERROR] ${err.message}`);
  });

  serverProcess.on('exit', (code, signal) => {
    logStream.write(`[EXIT] code=${code} signal=${signal}\n`);
    sendLog(`[EXIT] code=${code} signal=${signal}`);
    serverProcess = null;
  });
}

/**
 * 轮询检测服务器是否就绪
 * 同时尝试 HTTPS 和 HTTP（服务器可能用自签名证书）
 * 返回可用的 URL
 */
async function waitForServer(maxRetries = 60, interval = 1000) {
  const http = require('http');
  const https = require('https');

  function tryConnect(proto) {
    const mod = proto === 'https' ? https : http;
    const url = `${proto}://127.0.0.1:${SERVER_PORT}`;
    return new Promise((resolve, reject) => {
      const req = mod.get(url, { rejectUnauthorized: false }, (res) => {
        res.resume();
        resolve(url);
      });
      req.on('error', reject);
      req.setTimeout(2000, () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }

  for (let i = 0; i < maxRetries; i++) {
    // 同时尝试 HTTPS 和 HTTP，谁先通谁赢
    try {
      const url = await Promise.any([
        tryConnect('https'),
        tryConnect('http'),
      ]);
      sendLog(`Server ready at ${url}`);
      return url;
    } catch (e) {
      if (i > 0 && i % 5 === 0) {
        sendLog(`Waiting for server... (${i}s)`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
  }
  sendLog('[ERROR] Server did not respond within 60 seconds');
  return null; // 超时
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Axon',
    // macOS: 用 titleBarStyle 隐藏标题栏但保留交通灯，不设 frame:false（否则两者冲突，导致窗口事件异常）
    // Windows/Linux: 用 frame:false 去掉系统标题栏
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 10 } : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false, // 先隐藏，等内容加载好再显示
  });

  // 显示 loading 页（含实时进度日志）
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; -webkit-app-region: drag; user-select: none; }
  .loader { text-align: center; }
  .loader h1 { font-size: 36px; margin-bottom: 8px; color: #fff; letter-spacing: 2px; }
  .status { font-size: 13px; color: #888; margin-bottom: 16px; }
  .spinner { width: 36px; height: 36px; border: 3px solid #222; border-top-color: #6c63ff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .log-box { width: 520px; max-height: 180px; background: #111; border: 1px solid #222; border-radius: 6px; overflow-y: auto; padding: 10px 14px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 11.5px; line-height: 1.6; color: #777; text-align: left; -webkit-app-region: no-drag; }
  .log-box::-webkit-scrollbar { width: 4px; }
  .log-box::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-line.error { color: #ff6b6b; }
  .log-line.ready { color: #51cf66; }
  .dots { display: inline-block; width: 18px; text-align: left; }
</style>
</head>
<body>
  <div class="loader">
    <h1>Axon</h1>
    <div class="spinner"></div>
    <p class="status">Initializing<span class="dots" id="dots"></span></p>
  </div>
  <div class="log-box" id="logs"></div>
  <script>
    const logsEl = document.getElementById('logs');
    const dotsEl = document.getElementById('dots');
    const statusEl = document.querySelector('.status');
    let dotCount = 0;
    setInterval(() => { dotCount = (dotCount + 1) % 4; dotsEl.textContent = '.'.repeat(dotCount); }, 400);

    if (window.electronAPI && window.electronAPI.onBootLog) {
      window.electronAPI.onBootLog((msg) => {
        const line = document.createElement('div');
        line.className = 'log-line';
        if (msg.includes('[ERROR]') || msg.includes('[stderr]')) line.classList.add('error');
        if (msg.includes('ready') || msg.includes('Ready') || msg.includes('listening')) line.classList.add('ready');
        line.textContent = msg;
        logsEl.appendChild(line);
        logsEl.scrollTop = logsEl.scrollHeight;
        // 更新顶部状态文字
        if (msg.includes('Server ready')) { statusEl.textContent = 'Connected!'; }
        else if (msg.includes('Waiting for server')) { statusEl.innerHTML = 'Waiting for server<span class="dots" id="dots"></span>'; }
      });
    }
  </script>
</body>
</html>`)}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showError(message) {
  if (!mainWindow) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #0a0a0a; color: #e0e0e0; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
  .error { text-align: center; max-width: 500px; }
  .error h1 { color: #ff6b6b; font-size: 24px; }
  .error p { color: #888; line-height: 1.6; }
  .error code { background: #1a1a1a; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
</style>
</head>
<body>
  <div class="error">
    <h1>Failed to Start</h1>
    <p>${message}</p>
    <p>Check logs at: <code>${process.platform === 'win32' ? '%APPDATA%' : process.platform === 'darwin' ? '~/Library/Application Support' : '~/.config'}/axon/logs/server.log</code></p>
  </div>
</body>
</html>`)}`);
}

// ============================================================
// App Lifecycle
// ============================================================

// 窗口控制 IPC 处理
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => {
  mainWindow?.close();
});
ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('A valid URL is required');
  }

  await shell.openExternal(url);
});

app.whenReady().then(async () => {
  createWindow();
  startServer();

  const serverUrl = await waitForServer();
  if (serverUrl && mainWindow) {
    mainWindow.loadURL(serverUrl);
  } else {
    showError('The server did not respond within 60 seconds.');
  }
});

app.on('window-all-closed', () => {
  // macOS 上关闭窗口不退出应用（标准 macOS 行为）
  if (process.platform !== 'darwin') {
    killServer();
    app.quit();
  }
});

// macOS: 点击 dock 图标重新打开窗口
app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
    if (serverProcess) {
      // 服务器还在跑，直接加载
      waitForServer(5, 500).then(url => {
        if (url && mainWindow) mainWindow.loadURL(url);
      });
    } else {
      startServer();
      waitForServer().then(url => {
        if (url && mainWindow) mainWindow.loadURL(url);
        else showError('The server did not respond within 60 seconds.');
      });
    }
  }
});

app.on('before-quit', killServer);
process.on('exit', killServer);

function killServer() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
    serverProcess = null;
  }
}
