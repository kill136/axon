/**
 * OAuth 认证路由
 * 处理OAuth登录流程的所有端点
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { createServer, type Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
  OAUTH_ENDPOINTS,
  exchangeAuthorizationCode,
  createOAuthApiKey,
  importOfficialClaudeCodeAuth,
  type AuthConfig,
} from '../../../auth/index.js';
import { isDemoMode } from '../../../utils/env-check.js';
import { configManager } from '../../../config/index.js';
import { oauthManager } from '../oauth-manager.js';
import { CODEX_OAUTH_CONFIG, codexAuthManager, type CodexAuthConfig } from '../codex-auth-manager.js';
import { webAuth } from '../web-auth.js';

const router = Router();

// OAuth会话存储（内存存储，生产环境应使用Redis）
interface OAuthSession {
  authId: string;
  accountType: 'claude.ai' | 'console';
  state: string;
  codeVerifier: string;
  status: 'pending' | 'completed' | 'failed';
  authConfig?: AuthConfig;
  error?: string;
  createdAt: number;
}

const oauthSessions = new Map<string, OAuthSession>();

interface CodexOAuthSession {
  authId: string;
  state: string;
  codeVerifier: string;
  status: 'pending' | 'completed' | 'failed';
  mode: 'auto' | 'manual';
  auth?: Pick<CodexAuthConfig, 'accountId' | 'email' | 'expiresAt'>;
  error?: string;
  createdAt: number;
}

const codexOauthSessions = new Map<string, CodexOAuthSession>();
let codexCallbackServer: Server | null = null;
let codexCallbackServerStarting: Promise<boolean> | null = null;

// 清理过期会话（30分钟）
setInterval(() => {
  const now = Date.now();
  for (const [authId, session] of oauthSessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      oauthSessions.delete(authId);
    }
  }
  for (const [authId, session] of codexOauthSessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      codexOauthSessions.delete(authId);
    }
  }
}, 5 * 60 * 1000); // 每5分钟清理一次

function renderCallbackPage(title: string, message: string, kind: 'success' | 'error'): string {
  const color = kind === 'success' ? '#22c55e' : '#ef4444';
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 48px 20px; }
          h1 { color: ${color}; margin-bottom: 12px; }
          p { color: #334155; font-size: 16px; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <p>${message}</p>
      </body>
    </html>
  `;
}

function findCodexSessionByState(state: string): CodexOAuthSession | undefined {
  for (const session of codexOauthSessions.values()) {
    if (session.state === state) {
      return session;
    }
  }
  return undefined;
}

async function finalizeCodexSession(session: CodexOAuthSession, code: string): Promise<void> {
  const codexAuth = await codexAuthManager.exchangeAuthorizationCode(code, session.codeVerifier);
  await webAuth.activateCodexLogin(codexAuth);
  session.status = 'completed';
  session.error = undefined;
  session.auth = {
    accountId: codexAuth.accountId,
    email: codexAuth.email,
    expiresAt: codexAuth.expiresAt,
  };
}

async function ensureCodexCallbackServer(): Promise<boolean> {
  if (codexCallbackServer?.listening) {
    return true;
  }

  if (codexCallbackServerStarting) {
    return codexCallbackServerStarting;
  }

  const startPromise = new Promise<boolean>((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', CODEX_OAUTH_CONFIG.redirectUri);
        if (requestUrl.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = requestUrl.searchParams.get('code') || '';
        const state = requestUrl.searchParams.get('state') || '';
        const session = state ? findCodexSessionByState(state) : undefined;

        if (!state || !session) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackPage('Codex 登录失败', '未找到匹配的登录会话，请返回 Web UI 重试。', 'error'));
          return;
        }

        if (!code) {
          session.status = 'failed';
          session.error = 'Missing authorization code';
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackPage('Codex 登录失败', '浏览器回调中没有拿到授权码。', 'error'));
          return;
        }

        try {
          await finalizeCodexSession(session, code);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackPage('Codex 登录成功', '授权已完成，你可以回到 Axon Web IDE。', 'success'));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to complete Codex login';
          session.status = 'failed';
          session.error = message;
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackPage('Codex 登录失败', message, 'error'));
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCallbackPage('Codex 登录失败', error instanceof Error ? error.message : 'Unexpected callback error', 'error'));
      }
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      codexCallbackServerStarting = null;
      if (error.code === 'EADDRINUSE') {
        console.warn('[CodexAuth] localhost:1455 is already in use, fallback to manual callback paste');
        resolve(false);
        return;
      }
      console.error('[CodexAuth] Failed to start callback server:', error);
      resolve(false);
    });

    server.listen(1455, () => {
      codexCallbackServer = server;
      codexCallbackServerStarting = null;
      console.log('[CodexAuth] Listening for OAuth callback on http://localhost:1455/auth/callback');
      resolve(true);
    });
  });

  codexCallbackServerStarting = startPromise;
  return startPromise;
}

/**
 * POST /api/auth/oauth/start
 * 启动OAuth登录流程
 *
 * 重要：使用官方的 redirectUri，因为 OAuth 服务器只接受预注册的回调URL
 * 用户授权后会跳转到官方页面显示授权码，需要手动复制粘贴
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { accountType } = req.body as { accountType: 'claude.ai' | 'console' };

    if (!accountType || !['claude.ai', 'console'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type' });
    }

    const oauthConfig = OAUTH_ENDPOINTS[accountType];

    // 生成OAuth参数
    const authId = uuidv4();
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // 保存OAuth会话
    oauthSessions.set(authId, {
      authId,
      accountType,
      state,
      codeVerifier,
      status: 'pending',
      createdAt: Date.now(),
    });

    // 使用官方的 redirectUri（OAuth 服务器只接受预注册的回调URL）
    const authUrl = new URL(oauthConfig.authorizationEndpoint);
    authUrl.searchParams.set('code', 'true');  // 请求显示授权码
    authUrl.searchParams.set('client_id', oauthConfig.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', oauthConfig.redirectUri);  // 使用官方回调URL
    authUrl.searchParams.set('scope', oauthConfig.scope.join(' '));
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);  // 只使用 state，不包含 authId

    res.json({
      authId,
      authUrl: authUrl.toString(),
      // 告诉前端需要手动输入授权码
      requiresManualCode: true,
    });
  } catch (error) {
    console.error('[OAuth] Failed to start OAuth:', error);
    res.status(500).json({ error: 'Failed to start OAuth login' });
  }
});

/**
 * 注意：原有的 GET /api/auth/oauth/callback 路由已被移除
 * 因为实际使用的是官方的 redirect_uri，用户通过手动输入授权码完成流程
 * 这个路由永远不会被触发
 */

/**
 * GET /api/auth/oauth/status/:authId
 * 检查OAuth状态
 */
router.get('/status/:authId', (req: Request, res: Response) => {
  const { authId } = req.params;

  const session = oauthSessions.get(authId);
  if (!session) {
    return res.status(404).json({ error: 'OAuth session not found' });
  }

  res.json({
    status: session.status,
    error: session.error,
    authConfig: session.status === 'completed' ? session.authConfig : undefined,
  });
});

/**
 * POST /api/auth/oauth/submit-code
 * 提交手动输入的授权码
 *
 * 当用户在官方授权页面完成授权后，会看到一个授权码
 * 用户需要将这个授权码复制并粘贴到前端界面
 */
router.post('/submit-code', async (req: Request, res: Response) => {
  try {
    const { authId, code } = req.body as { authId: string; code: string };

    if (!authId || !code) {
      return res.status(400).json({ error: 'Missing authId or code' });
    }

    // 获取OAuth会话
    const session = oauthSessions.get(authId);
    if (!session) {
      return res.status(404).json({ error: 'OAuth session not found or expired' });
    }

    if (session.status === 'completed') {
      return res.json({ success: true, message: 'Already authenticated' });
    }

    // 清理输入的授权码
    let cleanCode = code.trim();
    // 移除可能的引号
    cleanCode = cleanCode.replace(/^["']|["']$/g, '');
    // 移除 URL fragment (#state)
    cleanCode = cleanCode.split('#')[0];
    // 如果用户粘贴了完整的URL，提取code参数
    if (cleanCode.includes('code=')) {
      const match = cleanCode.match(/code=([^&]+)/);
      if (match) {
        cleanCode = match[1];
      }
    }

    // 获取OAuth配置
    const oauthConfig = OAUTH_ENDPOINTS[session.accountType];

    console.log('[OAuth] Exchanging code for token...');
    console.log('[OAuth] AuthId:', authId);
    console.log('[OAuth] Code (first 10 chars):', cleanCode.substring(0, 10) + '...');

    // 交换authorization code为access token
    const tokenResponse = await exchangeAuthorizationCode(
      oauthConfig,
      cleanCode,
      session.codeVerifier,
      session.state
    );

    // 打印 token exchange 返回值（调试）
    console.log('[OAuth] Token response keys:', Object.keys(tokenResponse));
    console.log('[OAuth] Has refresh_token:', !!tokenResponse.refresh_token);
    console.log('[OAuth] Has scope:', !!tokenResponse.scope);
    console.log('[OAuth] expires_in:', tokenResponse.expires_in);

    // 创建认证配置
    const authConfig: AuthConfig = {
      type: 'oauth',
      accountType: session.accountType,
      authToken: tokenResponse.access_token,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope?.split(' ') || oauthConfig.scope,
      scopes: tokenResponse.scope?.split(' ') || oauthConfig.scope,
    };

    // 如果 token 没有 user:inference scope（订阅用户常见），
    // 需要调用 createOAuthApiKey 换取能做推理的临时 API Key
    const grantedScopes = authConfig.scopes as string[] || [];
    let oauthApiKey: string | undefined;
    if (!grantedScopes.includes('user:inference')) {
      console.log('[OAuth] Token lacks user:inference scope, creating API key via org:create_api_key...');
      try {
        const key = await createOAuthApiKey(tokenResponse.access_token);
        if (key) {
          oauthApiKey = key;
          console.log('[OAuth] API key created successfully for inference');
        } else {
          console.warn('[OAuth] createOAuthApiKey returned null, inference may fail');
        }
      } catch (e) {
        console.error('[OAuth] Failed to create API key:', e);
      }
    }

    // 保存到 oauthManager（settings.json 的 oauthAccount 字段）
    oauthManager.saveOAuthConfig({
      accessToken: authConfig.accessToken!,
      refreshToken: authConfig.refreshToken,
      expiresAt: authConfig.expiresAt as number | undefined,
      scopes: grantedScopes,
      subscriptionType: session.accountType,
      oauthApiKey,
    });

    const runtimeBackend = session.accountType === 'console'
      ? 'claude-compatible-api'
      : 'claude-subscription';

    // 关键：设置 authPriority 和 runtimeBackend，否则系统不知道用户已通过 OAuth 登录
    // 没有这一步，如果用户之前配置过 API Key，getStatus() 仍然优先使用 API Key
    configManager.set('authPriority', 'oauth');
    configManager.set('runtimeBackend', runtimeBackend);
    configManager.set('runtimeProvider', 'anthropic');
    configManager.set('apiProvider', 'anthropic');

    // 更新会话状态
    session.status = 'completed';
    session.authConfig = authConfig;

    console.log('[OAuth] Token exchange successful! accountType=%s, runtimeBackend=%s', session.accountType, runtimeBackend);

    res.json({
      success: true,
      authConfig: {
        type: authConfig.type,
        accountType: authConfig.accountType,
        expiresAt: authConfig.expiresAt,
      },
    });
  } catch (error) {
    console.error('[OAuth] Submit code error:', error);

    // 提供更友好的错误信息
    let errorMessage = 'Failed to exchange authorization code';
    if (error instanceof Error) {
      if (error.message.includes('invalid_grant') || error.message.includes('Invalid')) {
        errorMessage = 'Authorization code is invalid or expired. Please try again.';
      } else {
        errorMessage = error.message;
      }
    }

    res.status(400).json({ error: errorMessage });
  }
});

/**
 * POST /api/auth/oauth/import-local
 * 导入当前机器上 Claude Code 已有的订阅登录态
 */
router.post('/import-local', async (_req: Request, res: Response) => {
  try {
    const importedAuth = importOfficialClaudeCodeAuth();

    await oauthManager.saveOAuthConfig({
      accessToken: importedAuth.accessToken,
      refreshToken: importedAuth.refreshToken,
      expiresAt: importedAuth.expiresAt,
      scopes: importedAuth.scopes,
      subscriptionType: importedAuth.subscriptionType || importedAuth.accountType,
      rateLimitTier: importedAuth.rateLimitTier,
    });

    configManager.set('authPriority', 'oauth');
    configManager.set('runtimeBackend', 'claude-subscription');
    configManager.set('runtimeProvider', 'anthropic');
    configManager.set('apiProvider', 'anthropic');

    res.json({
      success: true,
      auth: {
        accountType: importedAuth.subscriptionType || importedAuth.accountType,
        expiresAt: importedAuth.expiresAt,
        scopes: importedAuth.scopes,
        source: importedAuth.source,
      },
    });
  } catch (error) {
    console.error('[OAuth] Import local Claude Code auth failed:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to import local Claude Code auth',
    });
  }
});

/**
 * GET /api/auth/status
 * 获取当前认证状态（唯一来源：WebAuthProvider）
 */
const handleAuthStatus = async (_req: Request, res: Response) => {
  const demoMode = isDemoMode();
  const status = webAuth.getStatus();

  if (!status.authenticated) {
    return res.json({ authenticated: false, runtimeBackend: status.runtimeBackend });
  }

  if (status.type === 'api_key') {
    // 检查是否是 Axon Cloud 用户（apiBaseUrl 包含 chatbi.site）
    const isAxonCloud = webAuth.isAxonCloudUser();
    return res.json({
      authenticated: true,
      type: 'api_key',
      provider: status.provider,
      accountType: isAxonCloud ? 'axon-cloud' : 'api',
      isAxonCloud,
      runtimeBackend: status.runtimeBackend,
      isDemoMode: demoMode,
    });
  }

  if (status.type === 'oauth') {
    // 统一的 token 有效性检查（对齐官方 NM()）
    await webAuth.ensureValidToken();

    if (status.provider === 'codex') {
      const codexStatus = webAuth.getCodexStatus();
      return res.json({
        authenticated: true,
        type: 'oauth',
        provider: 'codex',
        runtimeBackend: status.runtimeBackend,
        accountType: 'chatgpt',
        displayName: codexStatus.displayName,
        email: codexStatus.email,
        accountId: codexStatus.accountId,
        expiresAt: codexStatus.expiresAt,
        isDemoMode: demoMode,
      });
    }

    // 获取刷新后的 OAuth 详细信息
    const oauthStatus = webAuth.getOAuthStatus();

    return res.json({
      authenticated: true,
      type: 'oauth',
      provider: status.provider,
      runtimeBackend: status.runtimeBackend,
      accountType: oauthStatus.subscriptionType || 'subscription',
      displayName: oauthStatus.displayName,
      expiresAt: oauthStatus.expiresAt,
      scopes: oauthStatus.scopes,
      isDemoMode: demoMode,
    });
  }

  res.json({ authenticated: false, runtimeBackend: status.runtimeBackend });
};

router.get('/status', handleAuthStatus);

// 兼容旧前端路径
router.get('/oauth/status', handleAuthStatus);

/**
 * POST /api/auth/api-key
 * 使用 API Key 直接登录
 */
router.post('/api-key', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body as { apiKey: string };

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'API Key is required' });
    }

    const trimmedKey = apiKey.trim();

    // 验证 API Key 有效性
    const isValid = await webAuth.validateApiKey(trimmedKey);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    // 保存 API Key 并将认证优先级设为 apiKey
    const saved = webAuth.saveApiKeyLogin(trimmedKey);
    if (!saved) {
      return res.status(500).json({ error: 'Failed to save API Key' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Auth] API Key login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * 登出（清除 WebUI 管理的所有认证）
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    webAuth.clearAll();
    res.json({ success: true });
  } catch (error) {
    console.error('[OAuth] Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// 兼容旧前端路径
router.post('/oauth/logout', async (req: Request, res: Response) => {
  webAuth.clearAll();
  res.json({ success: true });
});

/**
 * POST /api/auth/codex/start
 * 启动 Codex ChatGPT OAuth 登录
 */
router.post('/codex/start', async (_req: Request, res: Response) => {
  try {
    const authId = uuidv4();
    const state = crypto.randomBytes(32).toString('hex');
    const { codeVerifier, codeChallenge } = codexAuthManager.generatePkcePair();
    const authUrl = codexAuthManager.buildAuthorizationUrl(state, codeChallenge);
    const autoCallback = await ensureCodexCallbackServer();

    codexOauthSessions.set(authId, {
      authId,
      state,
      codeVerifier,
      status: 'pending',
      mode: autoCallback ? 'auto' : 'manual',
      createdAt: Date.now(),
    });

    res.json({
      authId,
      authUrl,
      redirectUri: CODEX_OAUTH_CONFIG.redirectUri,
      autoCallback,
      requiresManualPaste: !autoCallback,
    });
  } catch (error) {
    console.error('[CodexAuth] Failed to start OAuth:', error);
    res.status(500).json({ error: 'Failed to start Codex login' });
  }
});

/**
 * GET /api/auth/codex/status/:authId
 * 查询 Codex 登录流程状态（供前端轮询）
 */
router.get('/codex/status/:authId', (req: Request, res: Response) => {
  const session = codexOauthSessions.get(req.params.authId);
  if (!session) {
    return res.status(404).json({ error: 'Codex auth session not found or expired' });
  }

  res.json({
    status: session.status,
    mode: session.mode,
    error: session.error,
    auth: session.auth,
  });
});

/**
 * POST /api/auth/codex/submit
 * 提交浏览器回调 URL 或 code
 */
router.post('/codex/submit', async (req: Request, res: Response) => {
  try {
    const { authId, callbackUrl, code } = req.body as { authId: string; callbackUrl?: string; code?: string };
    const session = codexOauthSessions.get(authId);
    if (!session) {
      return res.status(404).json({ error: 'Codex auth session not found or expired' });
    }

    if (session.status === 'completed') {
      return res.json({
        success: true,
        auth: session.auth,
      });
    }

    let parsedCode = code?.trim() || '';
    let parsedState = '';

    if (callbackUrl) {
      const url = new URL(callbackUrl.trim());
      parsedCode = url.searchParams.get('code') || parsedCode;
      parsedState = url.searchParams.get('state') || '';
    }

    if (!parsedCode) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }
    if (parsedState && parsedState !== session.state) {
      return res.status(400).json({ error: 'Authorization state does not match' });
    }

    await finalizeCodexSession(session, parsedCode);

    res.json({
      success: true,
      auth: session.auth,
    });
  } catch (error) {
    console.error('[CodexAuth] Submit code error:', error);
    const session = codexOauthSessions.get(req.body?.authId);
    if (session) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Failed to complete Codex login';
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to complete Codex login',
    });
  }
});

/**
 * POST /api/auth/codex/import-local
 * 导入本机 ~/.codex/auth.json + ~/.codex/config.toml
 */
router.post('/codex/import-local', async (_req: Request, res: Response) => {
  try {
    const config = await codexAuthManager.importOfficialAuthFile();
    const importedCodexConfig = codexAuthManager.importOfficialConfigFile();
    await webAuth.activateCodexLogin(config);

    if (importedCodexConfig) {
      const currentConfig = configManager.getAll() as Record<string, any>;
      const mergedDefaultModelByBackend = {
        ...(currentConfig.defaultModelByBackend && typeof currentConfig.defaultModelByBackend === 'object'
          ? currentConfig.defaultModelByBackend
          : {}),
        ...(importedCodexConfig.defaultModelByBackend || {}),
      };

      configManager.save({
        apiProvider: 'openai-compatible',
        apiBaseUrl: importedCodexConfig.apiBaseUrl || undefined,
        customModelName: importedCodexConfig.customModelName || undefined,
        defaultModelByBackend: Object.keys(mergedDefaultModelByBackend).length > 0
          ? mergedDefaultModelByBackend
          : undefined,
      } as any);
    }

    res.json({
      success: true,
      auth: {
        accountId: config.accountId,
        email: config.email,
        expiresAt: config.expiresAt,
      },
      importedConfig: importedCodexConfig
        ? {
            apiBaseUrl: importedCodexConfig.apiBaseUrl || undefined,
            customModelName: importedCodexConfig.customModelName,
            modelProvider: importedCodexConfig.modelProvider,
            wireApi: importedCodexConfig.wireApi,
          }
        : undefined,
    });
  } catch (error) {
    console.error('[CodexAuth] Import local auth failed:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to import local Codex auth',
    });
  }
});

export default router;
