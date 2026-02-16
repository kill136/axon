/**
 * OAuth 认证路由
 * 处理OAuth登录流程的所有端点
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { OAUTH_ENDPOINTS, exchangeAuthorizationCode, saveAuthSecure, getAuth, isAuthenticated, logout, initAuth, type AuthConfig } from '../../../auth/index.js';
import { isDemoMode } from '../../../utils/env-check.js';

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

// 清理过期会话（30分钟）
setInterval(() => {
  const now = Date.now();
  for (const [authId, session] of oauthSessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      oauthSessions.delete(authId);
    }
  }
}, 5 * 60 * 1000); // 每5分钟清理一次

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

    // 保存认证信息到文件
    saveAuthSecure(authConfig);

    // 重新初始化认证状态
    initAuth();

    // 更新会话状态
    session.status = 'completed';
    session.authConfig = authConfig;

    console.log('[OAuth] Token exchange successful!');

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
 * GET /api/auth/status
 * 获取当前认证状态
 */
router.get('/status', async (req: Request, res: Response) => {
  // 直接获取当前认证状态（已经在服务器启动时初始化了）
  let auth = getAuth();
  const authenticated = isAuthenticated();

  // 自动刷新即将过期的 token（5分钟内过期）
  if (auth && auth.type === 'oauth' && auth.expiresAt && auth.refreshToken) {
    const fiveMinutesLater = Date.now() + 5 * 60 * 1000;
    if (auth.expiresAt < fiveMinutesLater) {
      try {
        console.log('[OAuth] Token expiring soon, attempting refresh...');
        const { refreshTokenAsync } = await import('../../../auth/index.js');
        const refreshed = await refreshTokenAsync(auth);
        if (refreshed) {
          console.log('[OAuth] Token refreshed successfully');
          auth = refreshed;
        } else {
          console.log('[OAuth] Token refresh failed');
        }
      } catch (error) {
        console.error('[OAuth] Token refresh error:', error);
      }
    }
  }

  // 调试日志
  console.log('[OAuth] Status check:', {
    hasAuth: !!auth,
    authenticated,
    type: auth?.type,
    accountType: auth?.accountType,
    hasAccessToken: !!auth?.accessToken,
    hasAuthToken: !!auth?.authToken,
    expiresAt: auth?.expiresAt,
    now: Date.now(),
    expired: auth?.expiresAt ? auth.expiresAt < Date.now() : 'no-expiry',
  });

  // 如果是内置 API 配置，返回未认证状态（不应显示为已登录）
  if (auth?.isBuiltin) {
    return res.json({
      authenticated: false,
      type: 'builtin',
    });
  }

  if (!authenticated || !auth) {
    return res.json({
      authenticated: false,
    });
  }

  // IS_DEMO 模式下隐藏敏感信息 - 官网实现:
  // if(A.organization&&!process.env.IS_DEMO)...
  // if(A.email&&!process.env.IS_DEMO)...
  const demoMode = isDemoMode();

  res.json({
    authenticated: true,
    type: auth.type,
    accountType: auth.accountType,
    // IS_DEMO 模式下不返回 email
    email: demoMode ? undefined : auth.email,
    expiresAt: auth.expiresAt,
    scopes: auth.scopes || auth.scope,
    // 通知前端当前是否为 Demo 模式
    isDemoMode: demoMode,
  });
});

/**
 * POST /api/auth/logout
 * 登出
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    logout();
    
    // 额外清理 configManager 中的 OAuth 配置
    const { configManager } = await import('../../../config/index.js');
    configManager.set('oauthToken', undefined as any);
    configManager.set('oauthAccount', undefined as any);
    configManager.set('oauthRefreshToken', undefined as any);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[OAuth] Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

export default router;
