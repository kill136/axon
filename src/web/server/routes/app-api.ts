/**
 * App Management REST API
 *
 * 管理用户创建的 Web 应用：CRUD、进程启停、隧道分享
 */

import { Router, type Request, type Response } from 'express';
import { getAppManager } from '../app-manager.js';

const router = Router();

/**
 * localhost-only 中间件 — 写操作（创建、修改、删除、进程管理）仅允许本地访问
 */
function requireLocalhost(req: Request, res: Response, next: () => void) {
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  if (!isLocal) {
    res.status(403).json({ success: false, error: 'This operation is only allowed from localhost' });
    return;
  }
  next();
}

function manager() {
  return getAppManager();
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * GET /api/apps — 列出所有 App（含运行状态）
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const apps = manager().list();
    res.json({ success: true, data: apps });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/apps — 注册新 App
 */
router.post('/', requireLocalhost, (req: Request, res: Response) => {
  try {
    const { name, description, directory, icon, startCommand, port, entryPath, env, sessionId } = req.body;
    if (!name || !directory || !startCommand) {
      res.status(400).json({ success: false, error: 'name, directory, and startCommand are required' });
      return;
    }

    const app = manager().register({
      name,
      description,
      directory,
      icon,
      startCommand,
      port: port ? Number(port) : undefined,
      entryPath: entryPath || undefined,
      env,
      sessionId,
    });

    res.json({ success: true, data: app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/apps/:id — 获取单个 App
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const app = manager().get(req.params.id);
    if (!app) {
      res.status(404).json({ success: false, error: 'App not found' });
      return;
    }
    res.json({ success: true, data: app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/apps/:id — 更新 App 配置
 */
router.put('/:id', requireLocalhost, (req: Request, res: Response) => {
  try {
    const app = manager().update(req.params.id, req.body);
    res.json({ success: true, data: app });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      res.status(404).json({ success: false, error: err.message });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

/**
 * DELETE /api/apps/:id — 删除 App
 */
router.delete('/:id', requireLocalhost, async (req: Request, res: Response) => {
  try {
    await manager().remove(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 进程管理
// ============================================================================

/**
 * POST /api/apps/:id/start — 启动 App
 */
router.post('/:id/start', requireLocalhost, async (req: Request, res: Response) => {
  try {
    const app = await manager().start(req.params.id);
    res.json({ success: true, data: app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/apps/:id/stop — 停止 App
 */
router.post('/:id/stop', requireLocalhost, async (req: Request, res: Response) => {
  try {
    const app = await manager().stop(req.params.id);
    res.json({ success: true, data: app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/apps/:id/restart — 重启 App
 */
router.post('/:id/restart', requireLocalhost, async (req: Request, res: Response) => {
  try {
    const app = await manager().restart(req.params.id);
    res.json({ success: true, data: app });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/apps/:id/logs — 获取进程日志
 */
router.get('/:id/logs', (req: Request, res: Response) => {
  try {
    const lines = req.query.lines ? Number(req.query.lines) : undefined;
    const logs = manager().getLogs(req.params.id, lines);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// Tunnel 管理
// ============================================================================

/**
 * POST /api/apps/:id/tunnel/start — 启动隧道
 */
router.post('/:id/tunnel/start', requireLocalhost, async (req: Request, res: Response) => {
  try {
    const url = await manager().startTunnel(req.params.id);
    res.json({ success: true, data: { url } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/apps/:id/tunnel/stop — 停止隧道
 */
router.post('/:id/tunnel/stop', requireLocalhost, async (req: Request, res: Response) => {
  try {
    await manager().stopTunnel(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
