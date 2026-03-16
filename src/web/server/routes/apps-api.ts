/**
 * AI 应用工厂 — API 路由
 * 
 * 管理用户通过自然语言创建的 Web 应用
 */

import { Router, Request, Response } from 'express';
import { AppFactory } from '../app-factory.js';

const router = Router();

/**
 * 获取或创建 AppFactory 实例（挂在 app.locals 上）
 */
function getFactory(req: Request): AppFactory {
  if (!req.app.locals.appFactory) {
    req.app.locals.appFactory = new AppFactory();
  }
  return req.app.locals.appFactory;
}

/**
 * GET /api/apps — 列出所有应用
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const apps = factory.listApps();
    res.json({ apps });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps — 创建新应用
 * Body: { name: string, description: string, sessionId?: string }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, sessionId, icon, workingDirectory } = req.body;
    if (!name || !description) {
      res.status(400).json({ error: 'name and description are required' });
      return;
    }

    const factory = getFactory(req);
    const app = factory.createApp(name, description, sessionId || '', icon, workingDirectory);
    res.status(201).json({ app });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id — 获取单个应用详情
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const app = factory.getApp(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    res.json({ app });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/apps/:id — 更新应用元数据
 * Body: { name?, icon?, status? }
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const app = factory.updateAppMeta(req.params.id, req.body);
    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    res.json({ app });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/apps/:id — 删除应用
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const success = factory.deleteApp(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/publish — 发布应用到公网
 * Body: { method: 'surge' | 'tunnel' }
 */
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const app = factory.getApp(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    if (app.status !== 'ready') {
      res.status(400).json({ error: 'App is not ready for publishing' });
      return;
    }

    const method = req.body.method || 'surge';

    if (method === 'surge') {
      const url = await factory.publishToSurge(req.params.id);
      res.json({ url, method: 'surge' });
    } else if (method === 'tunnel') {
      // Tunnel 需要知道本地端口
      const port = req.app.locals.port || 3456;
      // Tunnel 分享的是整个 Axon 实例，用户通过 /apps/:id/ 访问
      const { url, process: tunnelProcess } = await factory.publishToTunnel(port);
      // 存储 tunnel 进程以便后续清理
      req.app.locals.tunnelProcesses = req.app.locals.tunnelProcesses || {};
      req.app.locals.tunnelProcesses[req.params.id] = tunnelProcess;

      factory.updateAppMeta(req.params.id, {
        publish: {
          tunnelUrl: `${url}/apps/${req.params.id}/`,
          publishedAt: new Date().toISOString(),
        },
      });

      res.json({ url: `${url}/apps/${req.params.id}/`, method: 'tunnel' });
    } else {
      res.status(400).json({ error: `Unknown publish method: ${method}` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/write — 直接写入应用文件（供 AI 对话流程调用）
 * Body: { filename: string, content: string }
 */
router.post('/:id/write', (req: Request, res: Response) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      res.status(400).json({ error: 'filename and content are required' });
      return;
    }

    const factory = getFactory(req);
    const success = factory.writeAppFile(req.params.id, filename, content);
    if (!success) {
      res.status(404).json({ error: 'App not found or path not allowed' });
      return;
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id/files/:filename — 读取应用文件
 */
router.get('/:id/files/*path', (req: Request, res: Response) => {
  try {
    const factory = getFactory(req);
    const filename = req.params.path || 'index.html';
    const content = factory.readAppFile(req.params.id, filename);
    if (content === null) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
