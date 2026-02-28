/**
 * WebUI 服务器入口
 * Express + WebSocket 服务器
 * 开发模式下集成 Vite，生产模式下提供静态文件
 */

import express from 'express';
import { createServer } from 'http';
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
  // 初始化运行时日志系统 — 拦截所有 console 输出并持久化到 ~/.claude/runtime.log
  logger.init({
    interceptConsole: true,
    minLevel: 'info',
  });

  // 启用 ErrorWatcher — 实时感知 error 日志并聚合分析
  // 错误感知是基础能力，所有模式都启用；仅自动修复（Phase 2）需要 evolve 模式
  errorWatcher.enable();
  logger.setErrorWatcher((entry) => errorWatcher.onError(entry));

  // 设置 CLAUDE_CODE_ENTRYPOINT 环境变量（如果未设置）
  // 官方 Claude Code 使用此变量标识启动入口点
  // WebUI 模式使用 'claude-vscode' 以匹配官方的 VSCode 扩展入口
  if (!process.env.CLAUDE_CODE_ENTRYPOINT) {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode';
  }

  // 定时任务由 WebScheduler 统一管理（稍后初始化）

  const {
    port = parseInt(process.env.PORT || process.env.CLAUDE_WEB_PORT || '3456'),
    host = process.env.CLAUDE_WEB_HOST || '0.0.0.0',
    cwd = process.cwd(),
    model = process.env.CLAUDE_MODEL || 'opus',
    ngrok: enableNgrok = process.env.ENABLE_NGROK === 'true' || !!process.env.NGROK_AUTHTOKEN,
    open: autoOpen = process.env.CLAUDE_WEB_NO_OPEN !== 'true',
  } = options;

  // 创建 Express 应用
  const app = express();
  const server = createServer(app);

  // 创建 WebSocket 服务器（使用 noServer 模式，手动处理 upgrade 事件）
  // 这样可以避免与 Vite HMR WebSocket 冲突
  const wss = new WebSocketServer({ noServer: true });

  // 手动处理 HTTP upgrade 事件，只将 /ws 路径的请求转发给我们的 WebSocket 服务器
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
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
        console.log('   模式: 开发 (Vite, HMR 已禁用 - Evolve 模式)');
      } else {
        console.log('   模式: 开发 (Vite HMR)');
      }
    } catch (e) {
      console.warn('   警告: Vite 未安装，使用静态文件模式');
      setupStaticFiles(app, clientDistPath);
    }
  } else {
    // 生产模式：提供静态文件
    setupStaticFiles(app, clientDistPath);
    console.log('   模式: 生产');
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

  // 注入 ErrorWatcher 通知回调 — 错误达到阈值时通知当前活跃会话的主 Agent
  {
    const { broadcastMessage } = await import('./websocket.js');
    conversationManager.setBroadcast(broadcastMessage);

    errorWatcher.setErrorNotifier(async (pattern, sourceContext) => {
      const notification = [
        `<system-reminder>`,
        `[ErrorWatcher] 检测到源码错误反复发生，请检查是否需要修复：`,
        `- 模块: ${pattern.sample.module}`,
        `- 错误: ${pattern.sample.msg.slice(0, 200)}`,
        `- 位置: ${pattern.sourceLocation || '未知'}`,
        `- 5分钟内重复 ${pattern.count} 次`,
        pattern.sample.stack ? `- 堆栈: ${pattern.sample.stack.slice(0, 300)}` : '',
        ``,
        `源码上下文:`,
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
      console.error('[ExecutionManager] 初始化恢复失败:', error);
    }
  }, 1000);

  // 用于存储 ngrok 隧道 listener
  let ngrokListener: any = null;

  // 启动服务器
  await new Promise<void>((resolve) => {
    server.listen(port, host, async () => {
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      const url = `http://${displayHost}:${port}`;
      console.log(`\n🌐 Claude Code WebUI 已启动`);
      console.log(`   地址: ${url}`);
      console.log(`   WebSocket: ws://${displayHost}:${port}/ws`);
      console.log(`   工作目录: ${cwd}`);
      console.log(`   模型: ${model}`);

      // 显示网络访问地址（局域网、Tailscale）
      if (host === '0.0.0.0') {
        const addrs = getNetworkAddresses();
        if (addrs.tailscale.length > 0) {
          for (const ip of addrs.tailscale) {
            console.log(`   📱 Tailscale: http://${ip}:${port}`);
          }
        }
        if (addrs.lan.length > 0) {
          for (const ip of addrs.lan) {
            console.log(`   📱 局域网:   http://${ip}:${port}`);
          }
        }
        if (addrs.tailscale.length === 0 && addrs.lan.length === 0) {
          console.log(`   💡 提示: 安装 Tailscale 可从手机远程访问`);
        }
      }

      // 自动打开浏览器
      if (autoOpen) {
        try {
          const open = (await import('open')).default;
          await open(url);
          console.log(`   🌍 已在浏览器中打开`);
        } catch (error) {
          console.log(`   ⚠️  无法自动打开浏览器，请手动访问上述地址`);
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
        console.log(`   ⚠️  ngrok: 未设置 NGROK_AUTHTOKEN 环境变量`);
        console.log(`   ⚠️  请访问 https://dashboard.ngrok.com/get-started/your-authtoken 获取 authtoken\n`);
      } else {
        console.log(`   🔗 正在创建 ngrok 隧道...`);

        // 创建 ngrok 隧道
        ngrokListener = await ngrok.forward({
          addr: port,
          authtoken: authtoken,
        });

        const ngrokUrl = ngrokListener.url();
        console.log(`   🌍 公网地址: ${ngrokUrl}`);
        console.log(`   🌍 公网 WebSocket: ${ngrokUrl?.replace('https://', 'wss://').replace('http://', 'ws://')}/ws\n`);
      }
    } catch (err: any) {
      console.log(`   ⚠️  ngrok 隧道创建失败: ${err.message}`);
      console.log(`   ⚠️  请检查 NGROK_AUTHTOKEN 是否正确\n`);
    }
  } else {
    console.log('');
  }

  // 优雅关闭 - 处理 SIGINT (Ctrl+C) 和 SIGTERM (tsx watch 重启)
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${signal}] 正在关闭服务器...`);

    // 停止定时调度器
    webScheduler?.stop();

    // 先持久化所有活跃会话，防止热更新丢数据
    try {
      await conversationManager.persistAllSessions();
    } catch (err) {
      console.error('持久化会话失败:', err);
    }

    // 关闭 ngrok 隧道
    if (ngrokListener) {
      try {
        await ngrokListener.close();
        console.log('   ngrok 隧道已关闭');
      } catch (err) {
        // 忽略关闭错误
      }
    }

    // 进化重启使用退出码 42，正常退出使用 0
    const exitCode = isEvolveRestartRequested() ? 42 : 0;
    if (isEvolveRestartRequested()) {
      console.log('   [Evolve] 进化重启: 退出码 42');
    }

    wss.close();
    server.close(() => {
      console.log('服务器已关闭');
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
    console.warn(`   警告: 前端未构建，请先运行 cd src/web/client && npm run build`);
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        return next();
      }
      res.status(503).send(`
        <html>
          <head><title>Claude Code WebUI</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>🚧 前端未构建</h1>
            <p>请先构建前端：</p>
            <pre style="background: #f5f5f5; padding: 20px; display: inline-block;">
cd src/web/client
npm install
npm run build</pre>
            <p>然后重启服务器</p>
          </body>
        </html>
      `);
    });
    return;
  }

  app.use(express.static(clientDistPath));

  // SPA 回退 - 所有未匹配的路由返回 index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
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

