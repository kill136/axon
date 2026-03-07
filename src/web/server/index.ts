/**
 * WebUI 服务器入口
 * Express + WebSocket 服务器
 * 开发模式下集成 Vite，生产模式下提供静态文件
 */

import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { ConversationManager } from './conversation.js';
import { setupWebSocket } from './websocket.js';
import { setupApiRoutes } from './routes/api.js';
import { setupConfigApiRoutes } from './routes/config-api.js';
import { initI18n } from '../../i18n/index.js';
import { configManager } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { errorWatcher } from '../../utils/error-watcher.js';
import {
  requestEvolveRestart,
  isEvolveEnabled,
  triggerGracefulShutdown,
  isEvolveRestartRequested,
  registerGracefulShutdown,
} from './evolve-state.js';

// Re-export for backward compatibility
export { requestEvolveRestart, isEvolveEnabled, triggerGracefulShutdown };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebServerOptions {
  port?: number;
  host?: string;
  cwd?: string;
  model?: string;
  ngrok?: boolean;
  open?: boolean;
}

export interface WebServerResult {
  conversationManager: ConversationManager;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerResult> {
  // 初始化运行时日志系统 — 拦截所有 console 输出并持久化到 ~/.axon/runtime.log
  logger.init({
    interceptConsole: true,
    minLevel: 'info',
  });

  // 启用 ErrorWatcher — 实时感知 error 日志并聚合分析
  // 错误感知是基础能力，所有模式都启用；仅自动修复（Phase 2）需要 evolve 模式
  errorWatcher.enable();
  logger.setErrorWatcher((entry) => errorWatcher.onError(entry));

  // 设置 AXON_ENTRYPOINT 环境变量（如果未设置）
  // 官方 Axon 使用此变量标识启动入口点
  // WebUI 模式使用 'claude-vscode' 以匹配官方的 VSCode 扩展入口
  if (!process.env.AXON_ENTRYPOINT) {
    process.env.AXON_ENTRYPOINT = 'claude-vscode';
  }

  // 定时任务由 WebScheduler 统一管理（稍后初始化）

  const {
    port = parseInt(process.env.PORT || process.env.AXON_WEB_PORT || '3456'),
    host = process.env.AXON_WEB_HOST || '0.0.0.0',
    cwd = process.cwd(),
    model = process.env.AXON_MODEL || 'opus',
    ngrok: enableNgrok = process.env.ENABLE_NGROK === 'true' || !!process.env.NGROK_AUTHTOKEN,
    open: autoOpen = process.env.AXON_WEB_NO_OPEN !== 'true',
  } = options;

  // 创建 Express 应用
  const app = express();

  // 自动检测 SSL 证书，有则用 HTTPS（Slack OAuth 等要求 https redirect_uri）
  const certDir = path.join(process.cwd(), '.axon-certs');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');
  const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
  const server = useHttps
    ? createHttpsServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
    : createServer(app);

  // 暴露协议信息，供 ConversationManager 构建系统提示词时使用
  process.env.AXON_WEB_PROTO = useHttps ? 'https' : 'http';
  process.env.AXON_WEB_PORT = String(port);

  // 创建 WebSocket 服务器（使用 noServer 模式，手动处理 upgrade 事件）
  // 这样可以避免与 Vite HMR WebSocket 冲突
  const wss = new WebSocketServer({ noServer: true });

  // 端口转发模块（反向代理 /proxy/:port/* → localhost:<port>）
  const { handleProxyUpgrade } = await import('./routes/port-forward.js');

  // 手动处理 HTTP upgrade 事件
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);

    if (pathname === '/ws') {
      // Axon WebSocket 连接
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname.startsWith('/proxy/')) {
      // 端口转发 WebSocket 升级
      handleProxyUpgrade(request, socket as any, head);
    }
    // 其他路径（如 Vite HMR）由 Vite 处理，不需要在这里处理
  });

  // 初始化 i18n（WebUI server 需要独立初始化，CLI 入口有自己的初始化）
  await initI18n(configManager.getAll().language);

  // 创建对话管理器
  const conversationManager = new ConversationManager(cwd, model);
  await conversationManager.initialize();

  // 检测开发模式（需要在 CORS 配置之前）
  const isDev = process.env.NODE_ENV !== 'production' && !process.argv[1]?.includes('dist');

  // 中间件
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS 配置：开发模式全开，生产模式限制为同源
  app.use((req, res, next) => {
    if (isDev) {
      res.header('Access-Control-Allow-Origin', '*');
    } else {
      // 生产模式：只允许同源请求，不设置 Access-Control-Allow-Origin
      // 浏览器同源请求不需要 CORS 头
      const origin = req.headers.origin;
      if (origin) {
        const requestHost = new URL(origin).host;
        const serverHost = `${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
        if (requestHost === serverHost || requestHost === `localhost:${port}` || requestHost === `127.0.0.1:${port}`) {
          res.header('Access-Control-Allow-Origin', origin);
        }
      }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 设置 app.locals，供各路由使用
  app.locals.conversationManager = conversationManager;

  // API 路由
  setupApiRoutes(app, conversationManager);

  // 配置管理 API 路由
  setupConfigApiRoutes(app);

  // OAuth 认证路由
  const authRouter = await import('./routes/auth.js');
  app.use('/api/auth/oauth', authRouter.default);

  // 蓝图 API 路由（项目导航、符号浏览、调用图等）
  const blueprintRouter = await import('./routes/blueprint-api.js');
  app.use('/api/blueprint', blueprintRouter.default);

  // tRPC API 路由（端到端类型安全）
  const { createExpressMiddleware } = await import('@trpc/server/adapters/express');
  const { appRouter } = await import('./trpc/appRouter.js');
  const { createContext } = await import('./trpc/index.js');
  app.use('/api/trpc', createExpressMiddleware({
    router: appRouter,
    createContext,
  }));

  // 蓝图需求收集对话 API 路由
  const blueprintRequirementRouter = await import('./routes/blueprint-requirement-api.js');
  app.use('/api/blueprint/requirement', blueprintRequirementRouter.default);

  // AI Hover API 路由（智能悬停提示）
  const aiHoverRouter = await import('./routes/ai-hover.js');
  app.use('/api/ai-hover', aiHoverRouter.default);

  // AI Editor API 路由（代码导游、热力图、重构建议、AI气泡）
  const aiEditorRouter = await import('./routes/ai-editor.js');
  app.use('/api/ai-editor', aiEditorRouter.default);

  // AutoComplete API 路由（路径补全、AI Inline 补全）
  const autocompleteRouter = await import('./routes/autocomplete-api.js');
  app.use('/api/ai-editor', autocompleteRouter.default);

  // 定时任务管理 API 路由
  const scheduleRouter = await import('./routes/schedule-api.js');
  app.use('/api/schedule', scheduleRouter.default);

  // Connectors API 路由（OAuth 连接器管理）
  const connectorsRouter = await import('./routes/connectors-api.js');
  app.use('/api/connectors', connectorsRouter.default);

  // LSP API 路由（Monaco Editor go-to-definition 支持）
  const lspRouter = await import('./routes/lsp-api.js');
  app.use('/api/lsp', lspRouter.default);

  // 端口转发路由（反向代理用户应用）
  const portForwardRouter = await import('./routes/port-forward.js');
  app.use('/proxy', portForwardRouter.default);

  // 前端静态文件路径
  // 在生产环境下，代码在 dist/web/server，需要找到 src/web/client/dist
  // 在开发环境下，代码在 src/web/server，需要找到 src/web/client
  const projectRoot = path.join(__dirname, '../../..');
  const clientPath = path.join(projectRoot, 'src/web/client');
  const clientDistPath = path.join(clientPath, 'dist');

  if (isDev) {
    // 开发模式：使用 Vite 中间件
    try {
      const { createServer: createViteServer } = await import('vite');

      // Evolve 模式下禁用 Vite 文件监听
      // 原因：模型修改多个前端文件时，改完第 1 个 Vite 就 HMR 推送半成品代码到浏览器 → 崩溃
      // 禁用后文件随便改，等 SelfEvolve 重启后浏览器重连加载完整的新代码
      const isEvolve = isEvolveEnabled();
      const viteWatchConfig = isEvolve
        ? { ignored: ['**/*'] } // 忽略所有文件变化
        : undefined;

      const vite = await createViteServer({
        root: clientPath,
        server: {
          middlewareMode: true,
          allowedHosts: true,
          watch: viteWatchConfig,
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      if (isEvolve) {
        console.log('   Mode: Development (Vite, HMR disabled - Evolve mode)');
      } else {
        console.log('   Mode: Development (Vite HMR)');
      }
    } catch (e) {
      console.warn('   Warning: Vite not installed, using static file mode');
      setupStaticFiles(app, clientDistPath);
    }
  } else {
    // 生产模式：提供静态文件
    setupStaticFiles(app, clientDistPath);
    console.log('   Mode: Production');
  }

  // 设置 WebSocket 处理
  setupWebSocket(wss, conversationManager);

  // 注入 WebSocket 广播函数到 BashTool（仅 WebUI 模式需要）
  try {
    const { setBroadcastMessage } = await import('../../tools/bash.js');
    const { broadcastMessage: wsBroadcast } = await import('./websocket.js');
    setBroadcastMessage(wsBroadcast);
  } catch {
    // 忽略
  }

  // 启动 Web Server 内嵌定时调度器
  // 替代独立 daemon 进程，直接在 Web Server 中调度定时任务并投递到对话
  let webScheduler: import('./web-scheduler.js').WebScheduler | null = null;
  {
    const { WebScheduler } = await import('./web-scheduler.js');
    const { broadcastMessage } = await import('./websocket.js');
    webScheduler = new WebScheduler({
      conversationManager,
      broadcastMessage,
      defaultModel: model,
      cwd,
    });
    conversationManager.setWebScheduler(webScheduler);
    webScheduler.start();
  }

  // 启动 IM 通道管理器（Telegram/飞书等 IM 平台 → AI 的反向通道）
  let channelManager: import('./channels/index.js').ChannelManager | null = null;
  {
    const { ChannelManager } = await import('./channels/index.js');
    const { broadcastMessage, setChannelManager } = await import('./websocket.js');
    channelManager = new ChannelManager(conversationManager, model, cwd);
    channelManager.setBroadcast(broadcastMessage);
    // 注册 webhook 路由（WhatsApp 等需要公网回调的通道）
    channelManager.setupWebhookRoutes(app);
    // 注入到 WebSocket 处理器，使 channel:* 消息可用
    setChannelManager(channelManager);
    // 延迟初始化，不阻塞服务器启动
    setTimeout(async () => {
      try {
        await channelManager!.initialize();
      } catch (error) {
        console.error('[ChannelManager] Initialization failed:', error);
      }
    }, 2000);
  }

  // 启动 Eye Daemon（摄像头持续拍照后台服务）
  // 用户在 settings.json 的 eye 字段配置 { autoStart: true, camera: 0, interval: 0.5 }
  {
    const eyeConfig = (configManager.getAll() as any)?.eye as import('../../eye/index.js').EyeConfig | undefined;
    if (eyeConfig?.autoStart) {
      try {
        const { startEye } = await import('../../eye/index.js');
        const result = await startEye(eyeConfig);
        if (result.success) {
          console.log(`[Eye] ${result.message}`);
        } else {
          console.warn(`[Eye] ${result.message}`);
        }
      } catch (error) {
        console.warn('[Eye] Failed to start eye daemon:', error);
      }
    }
  }

  // 注入 ErrorWatcher 通知回调 — 错误达到阈值时通知当前活跃会话的主 Agent
  {
    const { broadcastMessage } = await import('./websocket.js');
    conversationManager.setBroadcast(broadcastMessage);

    errorWatcher.setErrorNotifier(async (pattern, sourceContext) => {
      const notification = [
        `<system-reminder>`,
        `[ErrorWatcher] Repeated source code error detected, please check if it needs fixing:`,
        `- Module: ${pattern.sample.module}`,
        `- Error: ${pattern.sample.msg.slice(0, 200)}`,
        `- Location: ${pattern.sourceLocation || 'unknown'}`,
        `- Repeated ${pattern.count} times in 5 minutes`,
        pattern.sample.stack ? `- Stack: ${pattern.sample.stack.slice(0, 300)}` : '',
        ``,
        `Source context:`,
        '```typescript',
        sourceContext.slice(0, 800),
        '```',
        `</system-reminder>`,
      ].filter(Boolean).join('\n');

      const sent = await conversationManager.notifyActiveSession(notification);
      if (!sent) {
        console.log('[ErrorWatcher] No active session to notify');
      }
    });
  }

  // 延迟恢复未完成的蓝图执行（仅在 WebUI 服务器模式下）
  setTimeout(async () => {
    try {
      const { executionManager } = await import('./routes/blueprint-api.js');
      await executionManager.initRecovery();
    } catch (error) {
      console.error('[ExecutionManager] Initialization recovery failed:', error);
    }
  }, 1000);

  // 用于存储 ngrok 隧道 listener
  let ngrokListener: any = null;

  // 启动服务器
  await new Promise<void>((resolve) => {
    server.listen(port, host, async () => {
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      const proto = useHttps ? 'https' : 'http';
      const wsProto = useHttps ? 'wss' : 'ws';
      const url = `${proto}://${displayHost}:${port}`;
      console.log(`\n🌐 Axon WebUI started${useHttps ? ' (HTTPS)' : ''}`);
      console.log(`   URL: ${url}`);
      console.log(`   WebSocket: ${wsProto}://${displayHost}:${port}/ws`);
      console.log(`   Working Directory: ${cwd}`);
      console.log(`   Model: ${model}`);

      // 显示网络访问地址（局域网、Tailscale）
      if (host === '0.0.0.0') {
        const addrs = getNetworkAddresses();
        if (addrs.tailscale.length > 0) {
          for (const ip of addrs.tailscale) {
            console.log(`   📱 Tailscale: ${proto}://${ip}:${port}`);
          }
        }
        if (addrs.lan.length > 0) {
          for (const ip of addrs.lan) {
            console.log(`   📱 LAN:   ${proto}://${ip}:${port}`);
          }
        }
        if (addrs.tailscale.length === 0 && addrs.lan.length === 0) {
          console.log(`   💡 Tip: Install Tailscale for remote mobile access`);
        }
      }

      // 自动打开浏览器
      if (autoOpen) {
        try {
          const open = (await import('open')).default;
          await open(url);
          console.log(`   🌍 Opened in browser`);
        } catch (error) {
          console.log(`   ⚠️  Unable to open browser automatically, please visit the URL above manually`);
        }
      }

      resolve();
    });
  });

  // 如果启用了 ngrok 或设置了 NGROK_AUTHTOKEN，创建公网隧道
  const shouldEnableNgrok = enableNgrok || !!process.env.NGROK_AUTHTOKEN;
  if (shouldEnableNgrok) {
    try {
      const ngrok = await import('@ngrok/ngrok');

      // 检查 authtoken
      const authtoken = process.env.NGROK_AUTHTOKEN;
      if (!authtoken) {
        console.log(`   ⚠️  ngrok: NGROK_AUTHTOKEN environment variable not set`);
        console.log(`   ⚠️  Please visit https://dashboard.ngrok.com/get-started/your-authtoken to get authtoken\n`);
      } else {
        console.log(`   🔗 Creating ngrok tunnel...`);

        // 创建 ngrok 隧道
        ngrokListener = await ngrok.forward({
          addr: port,
          authtoken: authtoken,
        });

        const ngrokUrl = ngrokListener.url();
        console.log(`   🌍 Public URL: ${ngrokUrl}`);
        console.log(`   🌍 Public WebSocket: ${ngrokUrl?.replace('https://', 'wss://').replace('http://', 'ws://')}/ws\n`);
      }
    } catch (err: any) {
      console.log(`   ⚠️  ngrok tunnel creation failed: ${err.message}`);
      console.log(`   ⚠️  Please check if NGROK_AUTHTOKEN is correct\n`);
    }
  } else {
    console.log('');
  }

  // 后台版本检查（不阻塞启动）
  setTimeout(async () => {
    try {
      const config = configManager.getAll();
      if ((config as any).autoUpdatesChannel === 'disabled') return;
      const { checkVersion } = await import('../../updater/index.js');
      const result = await checkVersion();
      if (result.hasUpdate) {
        console.log(`\n📦 New version ${result.latest} available (current: ${result.current}). Run 'axon update' to upgrade.`);
        (globalThis as any).__axon_update_info = result;
      } else {
        (globalThis as any).__axon_update_info = { hasUpdate: false, current: result.current, latest: result.latest };
      }
    } catch {
      // Update check failed silently - don't disrupt the server
    }
  }, 3000);

  // 优雅关闭 - 处理 SIGINT (Ctrl+C) 和 SIGTERM (tsx watch 重启)
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${signal}] Shutting down server...`);

    // 停止定时调度器
    webScheduler?.stop();

    // 停止 Eye Daemon
    try {
      const { stopEye } = await import('../../eye/index.js');
      await stopEye();
    } catch { /* ignore */ }

    // 先持久化所有活跃会话，防止热更新丢数据
    try {
      await conversationManager.persistAllSessions();
    } catch (err) {
      console.error('Failed to persist session:', err);
    }

    // 关闭 ngrok 隧道
    if (ngrokListener) {
      try {
        await ngrokListener.close();
        console.log('   ngrok tunnel closed');
      } catch (err) {
        // 忽略关闭错误
      }
    }

    // 进化重启使用退出码 42，正常退出使用 0
    const exitCode = isEvolveRestartRequested() ? 42 : 0;
    if (isEvolveRestartRequested()) {
      console.log('   [Evolve] Evolution restart: exit code 42');
    }

    wss.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(exitCode);
    });

    // 兜底：如果 server.close 卡住，3秒后强制退出
    setTimeout(() => process.exit(exitCode), 3000);
  };

  // 注册到 evolve-state，供 SelfEvolveTool 通过 triggerGracefulShutdown() 调用
  registerGracefulShutdown(gracefulShutdown);

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return { conversationManager };
}

/**
 * 获取本机网络地址（Tailscale、局域网）
 */
function getNetworkAddresses(): { tailscale: string[]; lan: string[] } {
  const result = { tailscale: [] as string[], lan: [] as string[] };
  const interfaces = os.networkInterfaces();

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;

      // Tailscale 使用 100.x.x.x (CGNAT 范围)
      if (addr.address.startsWith('100.')) {
        result.tailscale.push(addr.address);
      }
      // 常见局域网段
      else if (addr.address.startsWith('192.168.') ||
               addr.address.startsWith('10.') ||
               addr.address.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
        result.lan.push(addr.address);
      }
    }
  }

  return result;
}

function setupStaticFiles(app: express.Application, clientDistPath: string) {
  // 检查 dist 目录是否存在
  if (!fs.existsSync(clientDistPath)) {
    console.warn(`   Warning: Frontend not built, please run cd src/web/client && npm run build first`);
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws') || req.path.startsWith('/proxy/')) {
        return next();
      }
      res.status(503).send(`
        <html>
          <head><title>Axon WebUI</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>🚧 Frontend Not Built</h1>
            <p>Please build the frontend first:</p>
            <pre style="background: #f5f5f5; padding: 20px; display: inline-block;">
cd src/web/client
npm install
npm run build</pre>
            <p>Then restart the server.</p>
          </body>
        </html>
      `);
    });
    return;
  }

  app.use(express.static(clientDistPath));

  // SPA 回退 - 所有未匹配的路由返回 index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws') || req.path.startsWith('/proxy/')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 如果直接运行此文件，启动服务器
const isMainModule = process.argv[1]?.includes('server') ||
                     process.argv[1]?.endsWith('web.js') ||
                     process.argv[1]?.endsWith('web.ts');

if (isMainModule) {
  startWebServer().catch(console.error);
}

