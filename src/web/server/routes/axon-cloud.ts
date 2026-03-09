/**
 * Axon Cloud 路由
 * 提供注册、登录、余额查询等 API
 */

import { Router, Request, Response } from 'express';
import { axonCloudService } from '../services/axon-cloud-service.js';
import { webConfigService } from '../services/config-service.js';

const router = Router();

/**
 * Axon Cloud session 存储（内存）
 * 生产环境应使用 Redis 等持久化存储
 */
interface AxonCloudSession {
  username: string;
  sessionCookie: string;
  apiKey: string;
  createdAt: number;
}

const sessions = new Map<string, AxonCloudSession>();

// 清理过期 session（30 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      sessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);

/**
 * POST /api/axon-cloud/register
 * 用户注册
 *
 * 流程：
 * 1. 调用 AxonCloudService.register()
 * 2. 注册成功后自动登录并获取 token
 * 3. 自动配置 API Key 和 Base URL 到 Axon 配置
 * 4. 返回用户信息和额度
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, email } = req.body as {
      username: string;
      password: string;
      email: string;
    };

    // 参数验证
    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, and email are required',
      });
    }

    console.log('[AxonCloud] Register request:', { username, email });

    // 调用注册服务
    const result = await axonCloudService.register({
      username,
      password,
      email,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Registration failed',
      });
    }

    // 注册成功，自动配置 API
    try {
      await webConfigService.updateApiConfig({
        apiKey: result.apiKey,
        apiBaseUrl: result.apiBaseUrl,
        apiProvider: 'openai-compatible', // NewAPI 兼容 OpenAI 格式
        customModelName: 'claude-3-5-sonnet-20241022', // 默认模型
      });
      console.log('[AxonCloud] API config updated after registration');
    } catch (configError) {
      console.error('[AxonCloud] Failed to update config:', configError);
      // 配置失败不影响注册流程
    }

    res.json({
      success: true,
      username: result.username,
      quota: result.quota,
      apiKey: result.apiKey,
    });
  } catch (error) {
    console.error('[AxonCloud] Register error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * POST /api/axon-cloud/login
 * 用户登录
 *
 * 流程：
 * 1. 调用 AxonCloudService.login()
 * 2. 登录成功后获取 token
 * 3. 自动配置 API Key 和 Base URL 到 Axon 配置
 * 4. 返回用户信息和额度
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as {
      username: string;
      password: string;
    };

    // 参数验证
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
      });
    }

    console.log('[AxonCloud] Login request:', { username });

    // 调用登录服务
    const result = await axonCloudService.login({
      username,
      password,
    });

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error || 'Login failed',
      });
    }

    // 登录成功，自动配置 API
    try {
      await webConfigService.updateApiConfig({
        apiKey: result.apiKey,
        apiBaseUrl: result.apiBaseUrl,
        apiProvider: 'openai-compatible', // NewAPI 兼容 OpenAI 格式
        customModelName: 'claude-3-5-sonnet-20241022', // 默认模型
      });
      console.log('[AxonCloud] API config updated after login');
    } catch (configError) {
      console.error('[AxonCloud] Failed to update config:', configError);
      // 配置失败不影响登录流程
    }

    res.json({
      success: true,
      username: result.username,
      quota: result.quota,
    });
  } catch (error) {
    console.error('[AxonCloud] Login error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /api/axon-cloud/balance
 * 获取余额信息
 *
 * 注意：当前版本暂未实现 session 管理，
 * 前端可以在登录时获取余额，暂不支持实时查询
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    // TODO: 实现 session 管理，从 session 中获取用户的 sessionCookie
    // 当前版本返回默认提示
    res.json({
      success: false,
      error: 'Balance query requires session management (not implemented yet)',
    });
  } catch (error) {
    console.error('[AxonCloud] Balance query error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * POST /api/axon-cloud/logout
 * 登出（清除 Axon Cloud 相关配置）
 *
 * 注意：这里不清除 API Key，只是提供一个登出端点
 * 用户如需切换回自带 Key，可以在 Settings 中手动配置
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // 清除 session（如果有实现 session 管理）
    // 当前版本暂无需操作

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('[AxonCloud] Logout error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

export default router;
