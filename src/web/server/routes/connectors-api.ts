/**
 * OAuth Connectors API 路由
 * 管理 OAuth 连接器的认证和配置
 */

import { Router } from 'express';
import { connectorManager } from '../connectors/index.js';

const router = Router();

// ========================================
// GET /api/connectors/callback - OAuth 回调
// 注意：这个路由必须在 /:id 之前注册！
// ========================================
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // OAuth 错误处理
  if (error) {
    console.error('[Connectors] OAuth error:', error);
    return res.redirect('/?page=customize&error=' + encodeURIComponent(error as string));
  }

  // 参数验证
  if (!code || !state) {
    console.error('[Connectors] Missing code or state');
    return res.redirect('/?page=customize&error=missing_params');
  }

  try {
    // 从请求头或协议推断 redirectBase
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectBase = `${protocol}://${host}`;

    // 处理 OAuth 回调
    const connectorId = await connectorManager.handleCallback(
      code as string,
      state as string,
      redirectBase
    );

    console.log('[Connectors] OAuth callback successful:', connectorId);

    // OAuth 成功后，尝试自动激活 MCP（异步，不阻塞重定向）
    const manager = req.app.locals.conversationManager;
    if (manager) {
      manager.activateConnectorMcp(connectorId).catch((err: any) => {
        console.warn(`[Connectors] Failed to auto-activate MCP for ${connectorId}:`, err);
      });
    }

    // 重定向回前端 Customize 页面，并传递 connected 参数
    res.redirect(`/?page=customize&connected=${connectorId}`);
  } catch (err: any) {
    console.error('[Connectors] OAuth callback failed:', err);
    res.redirect('/?page=customize&error=' + encodeURIComponent(err.message));
  }
});

// ========================================
// GET /api/connectors - 列出所有连接器
// ========================================
router.get('/', async (req, res) => {
  try {
    const connectors = connectorManager.listConnectors();
    
    // 填充 MCP 运行时状态（工具数量、连接状态）
    const manager = req.app.locals.conversationManager;
    if (manager) {
      for (const connector of connectors) {
        if (connector.mcpServerName) {
          const tools = manager.getMcpToolsForConnector(connector.id);
          connector.mcpConnected = tools.length > 0;
          connector.mcpToolCount = tools.length;
        }
      }
    }

    res.json({ connectors });
  } catch (err: any) {
    console.error('[Connectors] Failed to list connectors:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// GET /api/connectors/:id - 单个连接器详情
// ========================================
router.get('/:id', async (req, res) => {
  try {
    const connector = connectorManager.getConnector(req.params.id);
    if (!connector) {
      return res.status(404).json({ error: 'Connector not found' });
    }

    // 填充 MCP 运行时状态
    const manager = req.app.locals.conversationManager;
    if (manager && connector.mcpServerName) {
      const tools = manager.getMcpToolsForConnector(connector.id);
      connector.mcpConnected = tools.length > 0;
      connector.mcpToolCount = tools.length;
    }

    res.json(connector);
  } catch (err: any) {
    console.error('[Connectors] Failed to get connector:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/connect - 启动 OAuth
// ========================================
router.post('/:id/connect', async (req, res) => {
  try {
    // 从请求头或协议推断 redirectBase
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectBase = `${protocol}://${host}`;

    const result = connectorManager.startOAuth(req.params.id, redirectBase);
    res.json(result);
  } catch (err: any) {
    console.error('[Connectors] Failed to start OAuth:', err);
    res.status(400).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/disconnect - 断开连接
// ========================================
router.post('/:id/disconnect', async (req, res) => {
  try {
    // 先停用 MCP（在断开连接之前）
    const manager = req.app.locals.conversationManager;
    if (manager) {
      await manager.deactivateConnectorMcp(req.params.id).catch((err: any) => {
        console.warn(`[Connectors] Failed to deactivate MCP for ${req.params.id}:`, err);
      });
    }

    connectorManager.disconnect(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Connectors] Failed to disconnect:', err);
    res.status(400).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/config - 保存 OAuth 客户端配置
// ========================================
router.post('/:id/config', async (req, res) => {
  const { clientId, clientSecret } = req.body;

  // 参数验证
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'clientId and clientSecret are required' });
  }

  try {
    connectorManager.setClientConfig(req.params.id, { clientId, clientSecret });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Connectors] Failed to save config:', err);
    res.status(400).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/activate-mcp - 激活 MCP Server
// ========================================
router.post('/:id/activate-mcp', async (req, res) => {
  try {
    const manager = req.app.locals.conversationManager;
    if (!manager) {
      return res.status(500).json({ error: 'ConversationManager not available' });
    }

    const result = await manager.activateConnectorMcp(req.params.id);
    res.json(result);
  } catch (err: any) {
    console.error('[Connectors] Failed to activate MCP:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/deactivate-mcp - 停用 MCP Server
// ========================================
router.post('/:id/deactivate-mcp', async (req, res) => {
  try {
    const manager = req.app.locals.conversationManager;
    if (!manager) {
      return res.status(500).json({ error: 'ConversationManager not available' });
    }

    await manager.deactivateConnectorMcp(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Connectors] Failed to deactivate MCP:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// POST /api/connectors/:id/refresh - 刷新 Token
// ========================================
router.post('/:id/refresh', async (req, res) => {
  try {
    const success = await connectorManager.refreshTokenIfNeeded(req.params.id);
    
    if (success) {
      // 返回更新后的 connector 状态
      const connector = connectorManager.getConnector(req.params.id);
      res.json({ success: true, connector });
    } else {
      res.status(400).json({ error: 'Token refresh failed' });
    }
  } catch (err: any) {
    console.error('[Connectors] Failed to refresh token:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
