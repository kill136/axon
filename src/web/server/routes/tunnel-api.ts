/**
 * Cloudflare Tunnel API
 *
 * 提供公网隧道的启动、停止、状态查询接口。
 * cloudflared 二进制由 npm 包自动管理，无需手动安装。
 *
 * Endpoints:
 *   GET  /api/tunnel/status   - 获取隧道状态
 *   POST /api/tunnel/start    - 启动隧道（如需会自动安装 cloudflared）
 *   POST /api/tunnel/stop     - 停止隧道
 */

import { Router, type Request, type Response } from 'express';
import { getTunnel } from '../tunnel.js';

const router = Router();

/**
 * 从 app.locals 中获取当前端口
 */
function getPort(req: Request): number {
  return (req.app.locals.serverPort as number) || 3456;
}

// GET /api/tunnel/status
router.get('/status', (req: Request, res: Response) => {
  const port = getPort(req);
  const tunnel = getTunnel(port);
  res.json(tunnel.info);
});

// POST /api/tunnel/start
router.post('/start', async (req: Request, res: Response) => {
  const port = getPort(req);
  const tunnel = getTunnel(port);

  try {
    const info = await tunnel.start();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tunnel/stop
router.post('/stop', async (req: Request, res: Response) => {
  const port = getPort(req);
  const tunnel = getTunnel(port);

  try {
    const info = await tunnel.stop();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
