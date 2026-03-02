/**
 * 配置管理 API 路由
 * 处理所有配置相关的 HTTP 请求
 */

import type { Express, Request, Response } from 'express';
import { webConfigService } from '../services/config-service.js';
import { webAuth } from '../web-auth.js';

/**
 * 统一的响应格式
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 发送成功响应
 */
function sendSuccess<T>(res: Response, data: T, message?: string): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    ...(message && { message })
  };
  res.json(response);
}

/**
 * 发送错误响应
 */
function sendError(res: Response, error: unknown, statusCode: number = 500): void {
  const errorMessage = error instanceof Error ? error.message : '未知错误';
  const response: ApiResponse = {
    success: false,
    error: errorMessage
  };
  res.status(statusCode).json(response);
}

/**
 * 设置配置 API 路由
 */
export function setupConfigApiRoutes(app: Express): void {

  // ============================================================
  // 获取配置端点
  // ============================================================

  /**
   * GET /api/config/all
   * 获取所有配置
   */
  app.get('/api/config/all', async (req: Request, res: Response) => {
    try {
      const config = await webConfigService.getAllConfig();
      sendSuccess(res, config, '成功获取所有配置');
    } catch (error) {
      console.error('[Config API] Failed to get all config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/api
   * 获取 API 配置
   */
  app.get('/api/config/api', async (req: Request, res: Response) => {
    try {
      const apiConfig = await webConfigService.getApiConfig();
      sendSuccess(res, apiConfig, '成功获取 API 配置');
    } catch (error) {
      console.error('[Config API] Failed to get API config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/permissions
   * 获取权限配置
   */
  app.get('/api/config/permissions', async (req: Request, res: Response) => {
    try {
      const permissionsConfig = await webConfigService.getPermissionsConfig();
      sendSuccess(res, permissionsConfig, '成功获取权限配置');
    } catch (error) {
      console.error('[Config API] Failed to get permissions config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/hooks
   * 获取 Hooks 配置
   */
  app.get('/api/config/hooks', async (req: Request, res: Response) => {
    try {
      const hooksConfig = await webConfigService.getHooksConfig();
      sendSuccess(res, hooksConfig, '成功获取 Hooks 配置');
    } catch (error) {
      console.error('[Config API] Failed to get hooks config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/logging
   * 获取日志配置
   */
  app.get('/api/config/logging', async (req: Request, res: Response) => {
    try {
      const loggingConfig = await webConfigService.getLoggingConfig();
      sendSuccess(res, loggingConfig, '成功获取日志配置');
    } catch (error) {
      console.error('[Config API] Failed to get logging config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/proxy
   * 获取代理配置
   */
  app.get('/api/config/proxy', async (req: Request, res: Response) => {
    try {
      const proxyConfig = await webConfigService.getProxyConfig();
      sendSuccess(res, proxyConfig, '成功获取代理配置');
    } catch (error) {
      console.error('[Config API] Failed to get proxy config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/security
   * 获取安全配置
   */
  app.get('/api/config/security', async (req: Request, res: Response) => {
    try {
      const securityConfig = await webConfigService.getSecurityConfig();
      sendSuccess(res, securityConfig, '成功获取安全配置');
    } catch (error) {
      console.error('[Config API] Failed to get security config:', error);
      sendError(res, error);
    }
  });

  // ============================================================
  // 更新配置端点
  // ============================================================

  /**
   * PUT /api/config/api
   * 更新 API 配置
   */
  app.put('/api/config/api', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updateApiConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'API 配置已成功更新');
      } else {
        sendError(res, new Error('更新 API 配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update API config:', error);
      sendError(res, error);
    }
  });

  /**
   * POST /api/config/api/test
   * 测试 API 连接
   */
  app.post('/api/config/api/test', async (req: Request, res: Response) => {
    try {
      const { apiBaseUrl, customModelName } = req.body;
      let { apiKey } = req.body;

      // 如果前端发来的是掩码值或空值，回退到已保存的真实 key
      if (!apiKey || apiKey.includes('...') || apiKey.includes('***')) {
        const creds = webAuth.getCredentials();
        apiKey = creds.apiKey;
      }

      if (!apiKey) {
        return sendError(res, new Error('需要提供 API Key 进行测试'), 400);
      }

      // 导入 Anthropic SDK
      const Anthropic = (await import('@anthropic-ai/sdk')).default;

      // 创建临时客户端
      const client = new Anthropic({
        apiKey: apiKey,
        baseURL: apiBaseUrl || undefined,
      });

      // 发送一个简单的测试请求
      const testModel = customModelName || 'claude-haiku-4-5-20251001';
      
      try {
        const response = await client.messages.create({
          model: testModel,
          max_tokens: 10,
          messages: [{
            role: 'user',
            content: 'Hi'
          }]
        });

        // 测试成功
        sendSuccess(res, {
          success: true,
          model: testModel,
          baseUrl: apiBaseUrl || 'https://api.anthropic.com',
          responseId: response.id,
        }, 'API 连接测试成功');
      } catch (apiError: any) {
        // API 调用失败
        const errorMessage = apiError.message || String(apiError);
        const statusCode = apiError.status || 500;
        
        console.error('[Config API] API test failed:', errorMessage);
        
        return res.status(400).json({
          success: false,
          error: `API 测试失败: ${errorMessage}`,
          details: {
            statusCode,
            message: errorMessage,
          }
        });
      }
    } catch (error) {
      console.error('[Config API] Failed to test API connection:', error);
      sendError(res, error, 500);
    }
  });


  /**
   * PUT /api/config/permissions
   * 更新权限配置
   */
  app.put('/api/config/permissions', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updatePermissionsConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, '权限配置已成功更新');
      } else {
        sendError(res, new Error('更新权限配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update permissions config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/hooks
   * 更新 Hooks 配置
   */
  app.put('/api/config/hooks', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updateHooksConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Hooks 配置已成功更新');
      } else {
        sendError(res, new Error('更新 Hooks 配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update hooks config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/logging
   * 更新日志配置
   */
  app.put('/api/config/logging', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updateLoggingConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, '日志配置已成功更新');
      } else {
        sendError(res, new Error('更新日志配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update logging config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/proxy
   * 更新代理配置
   */
  app.put('/api/config/proxy', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updateProxyConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, '代理配置已成功更新');
      } else {
        sendError(res, new Error('更新代理配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update proxy config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/security
   * 更新安全配置
   */
  app.put('/api/config/security', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('无效的请求体'), 400);
      }

      const success = await webConfigService.updateSecurityConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, '安全配置已成功更新');
      } else {
        sendError(res, new Error('更新安全配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update security config:', error);
      sendError(res, error);
    }
  });

  // ============================================================
  // 配置管理端点
  // ============================================================

  /**
   * POST /api/config/export
   * 导出配置
   */
  app.post('/api/config/export', async (req: Request, res: Response) => {
    try {
      const { maskSecrets = true, format = 'json' } = req.body;

      const exportData = await webConfigService.exportConfig({
        maskSecrets,
        format,
      });

      if (req.body.asFile) {
        // 设置文件下载响应头
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="claude-config-${Date.now()}.json"`);
        res.send(exportData);
      } else {
        sendSuccess(res, JSON.parse(exportData), '配置导出成功');
      }
    } catch (error) {
      console.error('[Config API] Failed to export config:', error);
      sendError(res, error);
    }
  });

  /**
   * POST /api/config/import
   * 导入配置
   */
  app.post('/api/config/import', async (req: Request, res: Response) => {
    try {
      const { config } = req.body;

      if (!config) {
        return sendError(res, new Error('无效的配置数据'), 400);
      }

      // 如果 config 是对象，转换为 JSON 字符串
      const configStr = typeof config === 'string' ? config : JSON.stringify(config);

      const result = await webConfigService.importConfig(configStr);

      sendSuccess(res, { imported: result }, '配置导入成功');
    } catch (error) {
      console.error('[Config API] Failed to import config:', error);
      sendError(res, error);
    }
  });

  /**
   * POST /api/config/validate
   * 验证配置
   */
  app.post('/api/config/validate', async (req: Request, res: Response) => {
    try {
      const { config } = req.body;

      if (!config || typeof config !== 'object') {
        return sendError(res, new Error('无效的配置数据'), 400);
      }

      const validationResult = await webConfigService.validateConfig(config);

      if (validationResult.valid) {
        sendSuccess(res, validationResult, '配置验证通过');
      } else {
        res.status(400).json({
          success: false,
          data: validationResult,
          message: '配置验证失败'
        });
      }
    } catch (error) {
      console.error('[Config API] Failed to validate config:', error);
      sendError(res, error);
    }
  });

  /**
   * POST /api/config/reset
   * 重置配置
   */
  app.post('/api/config/reset', async (req: Request, res: Response) => {
    try {
      const { confirm } = req.body;

      if (!confirm) {
        return sendError(res, new Error('需要确认重置操作'), 400);
      }

      const success = await webConfigService.resetConfig();

      if (success) {
        sendSuccess(res, { reset: true }, '所有配置已重置为默认值');
      } else {
        sendError(res, new Error('重置配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to reset config:', error);
      sendError(res, error);
    }
  });

  // ============================================================
  // 配置历史和备份端点
  // ============================================================

  /**
   * GET /api/config/source/:key
   * 获取配置项来源
   */
  app.get('/api/config/source/:key', async (req: Request, res: Response) => {
    try {
      const { key } = req.params;

      if (!key) {
        return sendError(res, new Error('缺少配置键名'), 400);
      }

      const source = await webConfigService.getConfigSource(key);
      sendSuccess(res, source, `成功获取 ${key} 的配置来源`);
    } catch (error) {
      console.error('[Config API] Failed to get config source:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/sources
   * 获取所有配置来源
   */
  app.get('/api/config/sources', async (req: Request, res: Response) => {
    try {
      const sources = await webConfigService.getAllConfigSources();
      sendSuccess(res, sources, '成功获取所有配置来源');
    } catch (error) {
      console.error('[Config API] Failed to get all config sources:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/backups
   * 获取备份列表
   */
  app.get('/api/config/backups', async (req: Request, res: Response) => {
    try {
      const backups = await webConfigService.listBackups();
      sendSuccess(res, backups, '成功获取备份列表');
    } catch (error) {
      console.error('[Config API] Failed to get backup list:', error);
      sendError(res, error);
    }
  });

  /**
   * POST /api/config/restore
   * 从备份恢复
   */
  app.post('/api/config/restore', async (req: Request, res: Response) => {
    try {
      const { backupId, confirm } = req.body;

      if (!backupId) {
        return sendError(res, new Error('缺少备份 ID'), 400);
      }

      if (!confirm) {
        return sendError(res, new Error('需要确认恢复操作'), 400);
      }

      const success = await webConfigService.restoreFromBackup(backupId);

      if (success) {
        sendSuccess(res, { restored: true, backupId }, `成功从备份 ${backupId} 恢复配置`);
      } else {
        sendError(res, new Error('恢复配置失败'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to restore config:', error);
      sendError(res, error);
    }
  });

  console.log('[Config API] Config API routes configured');
}

/**
 * 默认导出路由设置函数
 */
export default setupConfigApiRoutes;
