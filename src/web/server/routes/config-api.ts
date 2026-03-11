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
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
      sendSuccess(res, config, 'Successfully retrieved all configurations');
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
      sendSuccess(res, apiConfig, 'Successfully retrieved API configuration');
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
      sendSuccess(res, permissionsConfig, 'Successfully retrieved permissions configuration');
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
      sendSuccess(res, hooksConfig, 'Successfully retrieved Hooks configuration');
    } catch (error) {
      console.error('[Config API] Failed to get hooks config:', error);
      sendError(res, error);
    }
  });

  /**
   * GET /api/config/advanced
   * 获取高级配置
   */
  app.get('/api/config/advanced', async (req: Request, res: Response) => {
    try {
      const advancedConfig = await webConfigService.getAdvancedConfig();
      sendSuccess(res, advancedConfig);
    } catch (error) {
      console.error('[Config API] Failed to get advanced config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/advanced
   * 更新高级配置
   */
  app.put('/api/config/advanced', async (req: Request, res: Response) => {
    try {
      const updates = req.body;
      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('Invalid request body'), 400);
      }
      const success = await webConfigService.updateAdvancedConfig(updates);
      if (success) {
        sendSuccess(res, { updated: true }, 'Advanced configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update advanced configuration'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update advanced config:', error);
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
      sendSuccess(res, loggingConfig, 'Successfully retrieved logging configuration');
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
      sendSuccess(res, proxyConfig, 'Successfully retrieved proxy configuration');
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
      sendSuccess(res, securityConfig, 'Successfully retrieved security configuration');
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updateApiConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'API configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update API configuration'), 500);
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
        return sendError(res, new Error('API Key is required for testing'), 400);
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
        }, 'API connection test successful');
      } catch (apiError: any) {
        // API 调用失败
        const errorMessage = apiError.message || String(apiError);
        const statusCode = apiError.status || 500;
        
        console.error('[Config API] API test failed:', errorMessage);
        
        return res.status(400).json({
          success: false,
          error: `API test failed: ${errorMessage}`,
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
   * GET /api/config/embedding
   * 获取 Embedding 配置
   */
  app.get('/api/config/embedding', async (req: Request, res: Response) => {
    try {
      const embeddingConfig = await webConfigService.getEmbeddingConfig();
      sendSuccess(res, embeddingConfig);
    } catch (error) {
      console.error('[Config API] Failed to get embedding config:', error);
      sendError(res, error);
    }
  });

  /**
   * PUT /api/config/embedding
   * 更新 Embedding 配置
   */
  app.put('/api/config/embedding', async (req: Request, res: Response) => {
    try {
      const updates = req.body;
      if (!updates || typeof updates !== 'object') {
        return sendError(res, new Error('Invalid request body'), 400);
      }
      const success = await webConfigService.updateEmbeddingConfig(updates);
      if (success) {
        sendSuccess(res, { updated: true }, 'Embedding configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update embedding configuration'), 500);
      }
    } catch (error) {
      console.error('[Config API] Failed to update embedding config:', error);
      sendError(res, error);
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updatePermissionsConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Permissions configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update permissions configuration'), 500);
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updateHooksConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Hooks configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update Hooks configuration'), 500);
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updateLoggingConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Logging configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update logging configuration'), 500);
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updateProxyConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Proxy configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update proxy configuration'), 500);
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
        return sendError(res, new Error('Invalid request body'), 400);
      }

      const success = await webConfigService.updateSecurityConfig(updates);

      if (success) {
        sendSuccess(res, { updated: true }, 'Security configuration updated successfully');
      } else {
        sendError(res, new Error('Failed to update security configuration'), 500);
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
        sendSuccess(res, JSON.parse(exportData), 'Configuration exported successfully');
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
        return sendError(res, new Error('Invalid configuration data'), 400);
      }

      // 如果 config 是对象，转换为 JSON 字符串
      const configStr = typeof config === 'string' ? config : JSON.stringify(config);

      const result = await webConfigService.importConfig(configStr);

      sendSuccess(res, { imported: result }, 'Configuration imported successfully');
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
        return sendError(res, new Error('Invalid configuration data'), 400);
      }

      const validationResult = await webConfigService.validateConfig(config);

      if (validationResult.valid) {
        sendSuccess(res, validationResult, 'Configuration validation passed');
      } else {
        res.status(400).json({
          success: false,
          data: validationResult,
          message: 'Configuration validation failed'
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
        return sendError(res, new Error('Reset operation requires confirmation'), 400);
      }

      const success = await webConfigService.resetConfig();

      if (success) {
        sendSuccess(res, { reset: true }, 'All configurations have been reset to defaults');
      } else {
        sendError(res, new Error('Failed to reset configuration'), 500);
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
        return sendError(res, new Error('Missing configuration key name'), 400);
      }

      const source = await webConfigService.getConfigSource(key);
      sendSuccess(res, source, `Successfully retrieved configuration source for ${key}`);
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
      sendSuccess(res, sources, 'Successfully retrieved all configuration sources');
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
      sendSuccess(res, backups, 'Successfully retrieved backup list');
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
        return sendError(res, new Error('Missing backup ID'), 400);
      }

      if (!confirm) {
        return sendError(res, new Error('Restore operation requires confirmation'), 400);
      }

      const success = await webConfigService.restoreFromBackup(backupId);

      if (success) {
        sendSuccess(res, { restored: true, backupId }, `Successfully restored configuration from backup ${backupId}`);
      } else {
        sendError(res, new Error('Failed to restore configuration'), 500);
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
