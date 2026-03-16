/**
 * WebUI 服务器入口
 * Express + WebSocket 服务器
 * 开发模式下集成 Vite，生产模式下提供静态文件
 */

import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { randomUUID } from 'crypto';
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

  // 生成 mcp-cli 内部通信 token（仅本次进程生命周期有效）
  // CLI 子进程通过环境变量继承此 token，API 端点校验
  if (!process.env.MCP_CLI_TOKEN) {
    const { randomBytes } = await import('crypto');
    process.env.MCP_CLI_TOKEN = randomBytes(16).toString('hex');
  }

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

  // 确保全局 AXON.md 存在（~/.axon/AXON.md），让铁律等行为规范开箱即用
  // CLI 入口有自己的初始化逻辑，Web 模式需要在这里兜底
  const globalAxonDir = path.join(os.homedir(), '.axon');
  const globalAxonMd = path.join(globalAxonDir, 'AXON.md');
  if (!fs.existsSync(globalAxonMd)) {
    try {
      const { createClaudeMdTemplate } = await import('../../rules/index.js');
      if (!fs.existsSync(globalAxonDir)) {
        fs.mkdirSync(globalAxonDir, { recursive: true });
      }
      fs.writeFileSync(globalAxonMd, createClaudeMdTemplate(), 'utf-8');
      console.log(`[Axon] Created default ~/.axon/AXON.md`);
    } catch (e) {
      // Non-fatal: skip if template generation fails
    }
  }

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

  // Axon Cloud 路由（注册、登录、余额查询）
  const axonCloudRouter = await import('./routes/axon-cloud.js');
  app.use('/api/axon-cloud', axonCloudRouter.default);

  // Agent Network API 路由
  const networkRouter = await import('./routes/network-api.js');
  app.use('/api/network', networkRouter.default);

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

  // ====== Artifacts API 路由（产物画廊） ======
  const artifactsApiRouter = await import('./routes/artifacts-api.js');
  app.use('/api/artifacts', artifactsApiRouter.default);

  // ====== 官网（Landing Page）路由 ======
  // 根据域名区分：chatbi.site → 官网，其他 → Web UI
  // 官网域名列表（可通过环境变量扩展）
  const LANDING_HOSTS = (process.env.LANDING_HOSTS || 'chatbi.site,www.chatbi.site').split(',').map(h => h.trim().toLowerCase());

  // 下载代理路由（官网域名 + 所有域名都可用）
  const downloadProxyRouter = await import('./routes/download-proxy.js');
  app.use(downloadProxyRouter.default);

  // Landing page 静态文件
  const landingPagePath = path.join(__dirname, '../../../landing-page');
  const landingPageExists = fs.existsSync(landingPagePath);
  if (landingPageExists) {
    console.log(`   Landing page: ${landingPagePath}`);

    // 官网域名拦截：匹配到官网域名时，serve landing-page 静态文件
    app.use((req, res, next) => {
      const hostname = (req.hostname || req.headers.host || '').split(':')[0].toLowerCase();
      if (!LANDING_HOSTS.includes(hostname)) {
        return next(); // 非官网域名，跳过，交给 Web UI
      }

      // 官网请求，serve landing-page 静态文件
      express.static(landingPagePath, {
        index: ['index.html'],
        extensions: ['html'],
      })(req, res, () => {
        // 静态文件未找到时，返回 index.html（SPA fallback 不需要，官网是多页面）
        res.status(404).sendFile(path.join(landingPagePath, 'index.html'));
      });
    });
  }

  // ====== Web UI 静态文件 ======
  // 前端静态文件路径
  // 在生产环境下，代码在 dist/web/server，需要找到 src/web/client/dist
  // 在开发环境下，代码在 src/web/server，需要找到 src/web/client
  const projectRoot = path.join(__dirname, '../../..');
  const clientPath = path.join(projectRoot, 'src/web/client');
  const clientDistPath = path.join(clientPath, 'dist');

  if (isDev) {
    // 开发模式：使用 Vite 中间件（始终启用 HMR）
    try {
      const { createServer: createViteServer } = await import('vite');

      const vite = await createViteServer({
        root: clientPath,
        server: {
          middlewareMode: true,
          allowedHosts: true,
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('   Mode: Development (Vite HMR)');
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

  // 启动 Agent Network（AI Agent 间去中心化通信）
  let agentNetwork: import('../../network/index.js').AgentNetwork | null = null;
  {
    const networkConfig = (configManager.getAll() as any)?.network;
    if (networkConfig?.enabled) {
      try {
        const { AgentNetwork } = await import('../../network/index.js');
        const { broadcastMessage } = await import('./websocket.js');
        const { VERSION } = await import('../../version.js');
        agentNetwork = new AgentNetwork();
        await agentNetwork.start(
          { enabled: true, port: networkConfig.port || 7860, advertise: networkConfig.advertise !== false, autoAcceptSameOwner: networkConfig.autoAcceptSameOwner !== false, name: networkConfig.name },
          cwd,
          VERSION,
        );

        // 转发事件到前端
        agentNetwork.on('agent:found', (agent: any) => broadcastMessage({ type: 'network:agent_found', payload: agent }));
        agentNetwork.on('agent:lost', (agentId: string) => broadcastMessage({ type: 'network:agent_lost', payload: { agentId } }));
        agentNetwork.on('agent:updated', (agent: any) => broadcastMessage({ type: 'network:agent_updated', payload: agent }));
        agentNetwork.on('message', (entry: any) => broadcastMessage({ type: 'network:message', payload: entry }));
        agentNetwork.on('trust_request', (agent: any) => broadcastMessage({ type: 'network:trust_request', payload: agent }));
        agentNetwork.on('chat:message', (msg: any) => broadcastMessage({ type: 'network:chat_message', payload: msg }));

        // 监听委派任务事件：创建新会话执行任务，完成后回调通知委派方
        agentNetwork.on('task:delegated', async (taskData: {
          taskId: string;
          fromAgentId: string;
          fromName: string;
          description: string;
          fullContext: string;
          attachments?: any[];
        }) => {
          const taskLog = (msg: string) => console.log(`[AgentNetwork:Task:${taskData.taskId.slice(0, 8)}] ${msg}`);
          const taskErr = (msg: string, err?: any) => console.error(`[AgentNetwork:Task:${taskData.taskId.slice(0, 8)}] ${msg}`, err?.message || err || '');
          taskLog(`Received delegated task from ${taskData.fromName}: ${taskData.description.slice(0, 80)}`);

          try {
            // 标记任务为执行中
            agentNetwork!.markTaskRunning(taskData.taskId);
            taskLog('Task marked as running');

            // 通知前端有委派任务正在执行（通过 network:task_executing 事件，Network Panel 可展示）
            broadcastMessage({
              type: 'network:task_executing',
              payload: {
                taskId: taskData.taskId,
                fromName: taskData.fromName,
                description: taskData.description,
                status: 'running',
              },
            });

            // 创建新会话
            const sessionMgr = conversationManager.getSessionManager();
            const title = `Delegated: ${taskData.description.slice(0, 50)}`;
            const newSession = sessionMgr.createSession({
              name: title,
              model: model,
              tags: ['webui', 'delegated-task'],
              projectPath: cwd,
            });
            const sessionId = newSession.metadata.id;
            taskLog(`Created session ${sessionId} for task execution`);

            // 通知前端新会话创建（携带委派任务元信息，前端据此不切换会话而是弹通知）
            broadcastMessage({
              type: 'session_created',
              payload: {
                sessionId,
                name: title,
                model: model,
                createdAt: newSession.metadata.createdAt,
                tags: ['delegated-task'],
                // 委派任务专属字段
                fromAgent: taskData.fromName,
                taskDescription: taskData.description,
              },
            });

            // 构建 prompt
            const prompt = buildDelegatedTaskPrompt(taskData);
            taskLog(`Built prompt (${prompt.length} chars), starting AI conversation...`);

            // 构建广播回调（让前端能看到执行过程）
            const messageId = randomUUID();
            const callbacks = buildDelegatedTaskCallbacks(broadcastMessage, conversationManager, sessionId, messageId, agentNetwork!, taskData.taskId);

            broadcastMessage({ type: 'message_start', payload: { messageId, sessionId } });
            broadcastMessage({ type: 'status', payload: { status: 'thinking', sessionId } });

            // 执行 AI 对话（bypassPermissions 模式，委派任务无人交互）
            await conversationManager.chat(
              sessionId,
              prompt,
              undefined,
              model,
              callbacks,
              cwd,
              undefined,
              'bypassPermissions',
            );

            taskLog('AI conversation completed, extracting result...');

            // 提取最后一条 AI 回复作为任务结果
            const history = conversationManager.getHistory(sessionId);
            let resultText = 'Task completed.';
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].role === 'assistant') {
                const textParts = history[i].content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text);
                if (textParts.length > 0) {
                  resultText = textParts.join('\n');
                  break;
                }
              }
            }

            agentNetwork!.completeTask(taskData.taskId, resultText);
            taskLog(`Completed successfully, result: ${resultText.slice(0, 100)}...`);

            // 通知前端任务完成
            broadcastMessage({
              type: 'network:task_executing',
              payload: {
                taskId: taskData.taskId,
                fromName: taskData.fromName,
                description: taskData.description,
                status: 'completed',
                result: resultText.slice(0, 200),
              },
            });
          } catch (err: any) {
            taskErr('Failed', err);
            try {
              agentNetwork!.failTask(taskData.taskId, err.message || String(err));
            } catch (failErr: any) {
              taskErr('failTask also failed', failErr);
            }

            // 通知前端任务失败
            broadcastMessage({
              type: 'network:task_executing',
              payload: {
                taskId: taskData.taskId,
                fromName: taskData.fromName,
                description: taskData.description,
                status: 'failed',
                error: err.message || String(err),
              },
            });
          }
        });

        // ====== Agent Chat: 收到对方消息 → 创建/复用 session → 走正常会话 loop ======
        // 私聊：每个 agentId 一个 session；群聊：每个 groupId 共享一个 session
        const chatSessions = new Map<string, string>(); // agentId|group:{groupId} → sessionId

        agentNetwork.on('chat:received', async (chatData: {
          fromAgentId: string;
          fromName: string;
          message: string;
          groupId?: string;
          groupName?: string;
          groupMembers?: string[];
        }) => {
          const chatLog = (msg: string) => console.log(`[AgentNetwork:Chat:${chatData.fromName}] ${msg}`);
          const chatErr = (msg: string, err?: any) => console.error(`[AgentNetwork:Chat:${chatData.fromName}] ${msg}`, err?.message || err || '');
          chatLog(`Received message: ${chatData.message.slice(0, 80)}${chatData.groupId ? ` (group: ${chatData.groupName || chatData.groupId})` : ''}`);

          try {
            // session key：群聊用 groupId，私聊用 agentId
            const sessionKey = chatData.groupId
              ? `group:${chatData.groupId}`
              : chatData.fromAgentId;

            let sessionId = chatSessions.get(sessionKey);
            const sessionMgr = conversationManager.getSessionManager();
            let isNewSession = false;

            if (sessionId) {
              const meta = sessionMgr.getMetadata(sessionId);
              if (!meta) {
                chatLog(`Session ${sessionId} expired, creating new one`);
                sessionId = undefined;
                chatSessions.delete(sessionKey);
              }
            }

            if (!sessionId) {
              const title = chatData.groupId
                ? `Group: ${chatData.groupName || chatData.groupId.slice(0, 8)}`
                : `Chat: ${chatData.fromName}`;
              const newSession = sessionMgr.createSession({
                name: title,
                model: model,
                tags: chatData.groupId ? ['webui', 'agent-group-chat'] : ['webui', 'agent-chat'],
                projectPath: cwd,
              });
              sessionId = newSession.metadata.id;
              chatSessions.set(sessionKey, sessionId);
              isNewSession = true;
              chatLog(`Created new chat session ${sessionId}`);

              broadcastMessage({
                type: 'session_created',
                payload: {
                  sessionId,
                  name: title,
                  model: model,
                  createdAt: newSession.metadata.createdAt,
                  tags: chatData.groupId ? ['agent-group-chat'] : ['agent-chat'],
                  fromAgent: chatData.fromName,
                },
              });
            }

            // 构建消息内容
            let messageContent = chatData.message;
            if (chatData.groupId) {
              // 群聊：标注发言者，首条消息附带群信息
              if (isNewSession) {
                const memberCount = chatData.groupMembers?.length || 0;
                messageContent = `<system-reminder>This is a group chat "${chatData.groupName || 'unnamed'}" with ${memberCount} members. Messages will be prefixed with [SenderName]. Respond to the group.</system-reminder>\n\n[${chatData.fromName}]: ${chatData.message}`;
              } else {
                messageContent = `[${chatData.fromName}]: ${chatData.message}`;
              }
            } else {
              // 私聊：首条消息附带来源标注
              if (isNewSession) {
                messageContent = `<system-reminder>This conversation is with AI agent "${chatData.fromName}" (${chatData.fromAgentId.slice(0, 8)}). Messages are from this agent. Respond naturally.</system-reminder>\n\n${chatData.message}`;
              }
            }

            chatLog(`Starting conversation in session ${sessionId}...`);

            const messageId = randomUUID();
            const callbacks = buildAgentChatCallbacks(
              broadcastMessage, conversationManager, sessionId, messageId,
              agentNetwork!, chatData.fromAgentId, chatLog, chatErr,
              chatData.groupId,
            );

            broadcastMessage({ type: 'message_start', payload: { messageId, sessionId } });
            broadcastMessage({ type: 'status', payload: { status: 'thinking', sessionId } });

            await conversationManager.chat(
              sessionId,
              messageContent,
              undefined,
              model,
              callbacks,
              cwd,
            );
          } catch (err: any) {
            chatErr('Failed to handle chat message', err);
          }
        });

        // 注入到 app.locals 供 API 路由使用
        app.locals.agentNetwork = agentNetwork;
      } catch (error) {
        console.error('[AgentNetwork] Failed to start:', error);
      }
    }
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

  // 自动启动 Ollama 适配器（如果 settings.json 中配置了 ollamaModel）
  {
    const ollamaModel = (configManager.getAll() as any)?.ollamaModel;
    const ollamaUrl = (configManager.getAll() as any)?.ollamaUrl || 'http://localhost:11434';
    if (ollamaModel) {
      try {
        const { startOllamaAdapter } = await import('../../proxy/ollama-adapter.js');
        const adapterUrl = await startOllamaAdapter({
          port: 18080,
          ollamaUrl,
          model: ollamaModel,
        });
        console.log(`[Ollama] Adapter started: ${adapterUrl} → ${ollamaUrl} (model: ${ollamaModel})`);
      } catch (error) {
        console.warn('[Ollama] Failed to start adapter:', error);
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

// ============================================================================
// Agent Network 委派任务辅助函数
// ============================================================================

/**
 * 构建委派任务的 AI prompt
 */
export function buildDelegatedTaskPrompt(taskData: {
  fromName: string;
  description: string;
  fullContext: string;
  attachments?: any[];
}): string {
  const parts: string[] = [];
  parts.push(`[Delegated Task] Another AI agent "${taskData.fromName}" has delegated a task to you.`);
  parts.push('');
  parts.push(`**Task:** ${taskData.description}`);

  if (taskData.fullContext && taskData.fullContext !== `Task: ${taskData.description}`) {
    parts.push('');
    parts.push(`**Context:**`);
    parts.push(taskData.fullContext);
  }

  parts.push('');
  parts.push('Please execute this task autonomously. Use all available tools as needed. When done, summarize what you accomplished.');

  return parts.join('\n');
}

/**
 * 构建委派任务的广播回调（让前端能看到执行过程）
 */
export function buildDelegatedTaskCallbacks(
  broadcastFn: (msg: any) => void,
  cm: ConversationManager,
  sessionId: string,
  messageId: string,
  network: import('../../network/index.js').AgentNetwork,
  taskId: string,
): import('./conversation.js').StreamCallbacks {
  let toolCallCount = 0;
  return {
    onThinkingStart: () => {
      broadcastFn({ type: 'thinking_start', payload: { messageId, sessionId } });
    },
    onThinkingDelta: (text: string) => {
      broadcastFn({ type: 'thinking_delta', payload: { messageId, text, sessionId } });
    },
    onThinkingComplete: () => {
      broadcastFn({ type: 'thinking_complete', payload: { messageId, sessionId } });
    },
    onTextDelta: (text: string) => {
      broadcastFn({ type: 'text_delta', payload: { messageId, text, sessionId } });
    },
    onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
      toolCallCount++;
      broadcastFn({ type: 'tool_use_start', payload: { messageId, toolUseId, toolName, input, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'tool_executing', message: `Executing ${toolName}...`, sessionId } });
      // 上报进度（粗略估计，每个工具调用算一定进度）
      const progress = Math.min(90, toolCallCount * 15);
      network.reportTaskProgress(taskId, progress, `Executing ${toolName}`);
    },
    onToolUseDelta: (toolUseId: string, partialJson: string) => {
      broadcastFn({ type: 'tool_use_delta', payload: { toolUseId, partialJson, sessionId } });
    },
    onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
      broadcastFn({
        type: 'tool_result',
        payload: { toolUseId, success, output, error, data: data as any, defaultCollapsed: true, sessionId },
      });
    },
    onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
      await cm.persistSession(sessionId);
      broadcastFn({ type: 'message_complete', payload: { messageId, stopReason: (stopReason || 'end_turn') as any, usage, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });
    },
    onError: (error: Error) => {
      broadcastFn({ type: 'error', payload: { error: error.message, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });
    },
    onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
      broadcastFn({ type: 'context_compact', payload: { phase, info, sessionId } });
    },
    onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
      broadcastFn({ type: 'context_update', payload: { ...usage, sessionId } });
    },
  };
}

/**
 * 构建 Agent Chat 的广播回调（IM 通道风格）
 * 与 buildDelegatedTaskCallbacks 的区别：
 * - 不上报 task progress（不是委派任务）
 * - onComplete 时自动提取 AI 回复并转发给对方 agent
 */
export function buildAgentChatCallbacks(
  broadcastFn: (msg: any) => void,
  cm: ConversationManager,
  sessionId: string,
  messageId: string,
  network: import('../../network/index.js').AgentNetwork,
  targetAgentId: string,
  chatLog: (msg: string) => void,
  chatErr: (msg: string, err?: any) => void,
  groupId?: string,
): import('./conversation.js').StreamCallbacks {
  return {
    onThinkingStart: () => {
      broadcastFn({ type: 'thinking_start', payload: { messageId, sessionId } });
    },
    onThinkingDelta: (text: string) => {
      broadcastFn({ type: 'thinking_delta', payload: { messageId, text, sessionId } });
    },
    onThinkingComplete: () => {
      broadcastFn({ type: 'thinking_complete', payload: { messageId, sessionId } });
    },
    onTextDelta: (text: string) => {
      broadcastFn({ type: 'text_delta', payload: { messageId, text, sessionId } });
    },
    onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
      broadcastFn({ type: 'tool_use_start', payload: { messageId, toolUseId, toolName, input, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'tool_executing', message: `Executing ${toolName}...`, sessionId } });
    },
    onToolUseDelta: (toolUseId: string, partialJson: string) => {
      broadcastFn({ type: 'tool_use_delta', payload: { toolUseId, partialJson, sessionId } });
    },
    onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
      broadcastFn({
        type: 'tool_result',
        payload: { toolUseId, success, output, error, data: data as any, defaultCollapsed: true, sessionId },
      });
    },
    onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
      await cm.persistSession(sessionId);
      broadcastFn({ type: 'message_complete', payload: { messageId, stopReason: (stopReason || 'end_turn') as any, usage, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });

      // 提取最后一条 AI 回复，自动转发给对方 agent
      const history = cm.getHistory(sessionId);
      let replyText = '';
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') {
          const textParts = history[i].content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text);
          if (textParts.length > 0) {
            replyText = textParts.join('\n');
            break;
          }
        }
      }

      if (replyText) {
        chatLog(`Sending reply (${replyText.length} chars)${groupId ? ` to group ${groupId}` : ''}`);
        network.sendChatReply(targetAgentId, replyText, groupId).catch(err => {
          chatErr('Failed to send reply', err);
        });
      }
    },
    onError: (error: Error) => {
      broadcastFn({ type: 'error', payload: { error: error.message, sessionId } });
      broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });
    },
    onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
      broadcastFn({ type: 'context_compact', payload: { phase, info, sessionId } });
    },
    onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
      broadcastFn({ type: 'context_update', payload: { ...usage, sessionId } });
    },
  };
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

