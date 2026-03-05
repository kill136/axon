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

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3456;

/**
 * 查找内嵌的 node.exe
 * 打包后在 <app根>/node/node.exe
 * 开发模式下用系统 node
 */
function findNodeExe() {
  const appRoot = path.join(__dirname, '..');

  // 打包模式：内嵌的 node.exe
  const embeddedNode = path.join(appRoot, '..', '..', 'node', 'node.exe');
  if (fs.existsSync(embeddedNode)) {
    return embeddedNode;
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

  logStream.write(`\n=== Axon Server Start: ${new Date().toISOString()} ===\n`);
  logStream.write(`Node: ${nodeExe}\n`);
  logStream.write(`Script: ${serverScript}\n`);
  logStream.write(`CWD: ${appRoot}\n\n`);

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
      // Windows 上隐藏控制台窗口
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // 日志写文件，不写 Electron 的 stdout（GUI 模式没有 stdout）
  serverProcess.stdout.on('data', (data) => {
    logStream.write(data);
  });
  serverProcess.stderr.on('data', (data) => {
    logStream.write(data);
  });

  serverProcess.on('error', (err) => {
    logStream.write(`[ERROR] Failed to start: ${err.message}\n`);
  });

  serverProcess.on('exit', (code, signal) => {
    logStream.write(`[EXIT] code=${code} signal=${signal}\n`);
    serverProcess = null;
  });
}

/**
 * 轮询检测服务器是否就绪
 * 同时尝试 HTTPS 和 HTTP（服务器可能用自签名证书）
 * 返回可用的 URL
 */
async function waitForServer(maxRetries = 30, interval = 1000) {
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
      return url;
    } catch (e) {
      await new Promise(r => setTimeout(r, interval));
    }
  }
  return null; // 超时
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Axon',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false, // 先隐藏，等内容加载好再显示
  });

  // 显示 loading 页
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
  .loader { text-align: center; }
  .loader h1 { font-size: 36px; margin-bottom: 20px; color: #fff; }
  .loader p { font-size: 14px; color: #666; }
  .spinner { width: 40px; height: 40px; border: 3px solid #222; border-top-color: #6c63ff; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="loader">
    <h1>Axon</h1>
    <div class="spinner"></div>
    <p>Starting server...</p>
  </div>
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
    <p>Check logs at: <code>%APPDATA%/axon/logs/server.log</code></p>
  </div>
</body>
</html>`)}`);
}

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(async () => {
  createWindow();
  startServer();

  const serverUrl = await waitForServer();
  if (serverUrl && mainWindow) {
    mainWindow.loadURL(serverUrl);
  } else {
    showError('The server did not respond within 30 seconds.');
  }
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
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
