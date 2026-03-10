/**
 * Axon Cloud 路由
 * 提供注册、登录、余额查询等 API
 */

import { Router, Request, Response } from 'express';
import { axonCloudService, type AxonCloudSession } from '../services/axon-cloud-service.js';
import { webConfigService } from '../services/config-service.js';

const router = Router();

/** 内存 session 存储，key = username */
interface StoredSession extends AxonCloudSession {
  username: string;
  apiKey: string;
  createdAt: number;
}

const sessions = new Map<string, StoredSession>();

// 清理过期 session（30 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      sessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** 注册/登录成功后的公共处理：存 session + 配 API */
async function handleAuthSuccess(result: { username: string; quota: number; apiKey: string; apiBaseUrl: string; session?: AxonCloudSession }) {
  if (result.session) {
    sessions.set(result.username, {
      ...result.session,
      username: result.username,
      apiKey: result.apiKey,
      createdAt: Date.now(),
    });
  }

  try {
    await webConfigService.updateApiConfig({
      apiKey: result.apiKey,
      apiBaseUrl: result.apiBaseUrl,
      customModelName: '',  // NewAPI 支持模型别名路由，不需要硬编码模型名
    });
    console.log('[AxonCloud] API config updated');
  } catch (e) {
    console.error('[AxonCloud] Failed to update config:', e);
  }
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, email } = req.body as { username: string; password: string; email: string };
    if (!username || !password || !email) {
      return res.status(400).json({ success: false, error: 'Username, password, and email are required' });
    }

    const result = await axonCloudService.register({ username, password, email });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    await handleAuthSuccess(result);
    res.json({ success: true, username: result.username, quota: result.quota, apiKey: result.apiKey });
  } catch (error) {
    console.error('[AxonCloud] Register error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username: string; password: string };
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const result = await axonCloudService.login({ username, password });
    if (!result.success) {
      return res.status(401).json({ success: false, error: result.error });
    }

    await handleAuthSuccess(result);
    res.json({ success: true, username: result.username, quota: result.quota });
  } catch (error) {
    console.error('[AxonCloud] Login error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.get('/balance', async (req: Request, res: Response) => {
  try {
    const username = req.query.username as string;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }

    const session = sessions.get(username);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session expired, please login again' });
    }

    const balance = await axonCloudService.getBalance(session.accessToken, session.userId);
    res.json({ success: true, quota: balance.quota, used: balance.used, remaining: balance.quota - balance.used });
  } catch (error) {
    console.error('[AxonCloud] Balance error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username?: string };
    if (username) sessions.delete(username);
    res.json({ success: true });
  } catch (error) {
    console.error('[AxonCloud] Logout error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

export default router;
