/**
 * API 管理器
 * 提供API连接测试、模型查询、Token状态等功能
 */

import { ClaudeClient } from '../../core/client.js';
import { configManager } from '../../config/index.js';
import { initAuth, getAuth } from '../../auth/index.js';
import { modelConfig } from '../../models/index.js';
import type { ApiStatusPayload, ApiTestResult, ProviderInfo } from '../shared/types.js';

export class ApiManager {
  private client: ClaudeClient | null = null;

  constructor() {
    this.initializeClient();
  }

  /**
   * 初始化Claude客户端
   */
  private initializeClient(): void {
    try {
      let auth = getAuth();
      // 如果还没初始化过认证，先初始化（确保内置默认配置生效）
      if (!auth) {
        auth = initAuth();
      }
      const apiKey = auth?.apiKey || configManager.getApiKey();
      const authToken = auth?.type === 'oauth' ? (auth.accessToken || auth.authToken) : undefined;

      if (!apiKey && !authToken) {
        console.warn('[ApiManager] 未找到 API Key 或 Auth Token');
        return;
      }

      this.client = new ClaudeClient({
        apiKey,
        authToken,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
      });
    } catch (error) {
      console.error('[ApiManager] 初始化客户端失败:', error);
    }
  }

  /**
   * 测试API连接
   */
  async testConnection(): Promise<ApiTestResult> {
    const startTime = Date.now();

    try {
      if (!this.client) {
        this.initializeClient();
      }

      if (!this.client) {
        return {
          success: false,
          latency: 0,
          model: '',
          error: 'API 客户端未初始化',
          timestamp: Date.now(),
        };
      }

      // 使用最小的模型和token进行快速测试
      const testModel = 'haiku';
      const response = await this.client.createMessage(
        [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        undefined, // 不需要 tools
        undefined, // 不需要 system prompt
        { enableThinking: false }
      );

      const latency = Date.now() - startTime;

      return {
        success: true,
        latency,
        model: response.model || testModel,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        model: '',
        error: error.message || '未知错误',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 获取可用模型列表
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      // 从配置中获取所有已知模型
      const allModels = modelConfig.getAllModels().map(m => m.id);

      // 根据认证类型过滤模型
      const auth = getAuth();
      if (auth?.type === 'oauth') {
        // OAuth 模式下，检查 scope 确定可用模型
        const scopes = auth.scope || auth.scopes || [];
        if (scopes.includes('user:inference')) {
          // 有 inference scope，所有模型都可用
          return allModels;
        } else {
          // 没有 inference scope，只能使用基础模型
          return allModels.filter(m => m.includes('haiku'));
        }
      }

      // API Key 模式，所有模型都可用
      return allModels;
    } catch (error) {
      console.error('[ApiManager] 获取模型列表失败:', error);
      return [];
    }
  }

  /**
   * 获取API状态
   */
  async getStatus(): Promise<ApiStatusPayload> {
    try {
      const auth = getAuth();
      const config = configManager.getAll();
      const models = await this.getAvailableModels();

      // 确定 provider 类型
      let provider: 'anthropic' | 'bedrock' | 'vertex' = 'anthropic';
      if (config.useBedrock || config.apiProvider === 'bedrock') {
        provider = 'bedrock';
      } else if (config.useVertex || config.apiProvider === 'vertex') {
        provider = 'vertex';
      }

      // 确定 base URL
      let baseUrl = 'https://api.anthropic.com';
      if (process.env.ANTHROPIC_BASE_URL) {
        baseUrl = process.env.ANTHROPIC_BASE_URL;
      } else if (provider === 'bedrock') {
        baseUrl = 'AWS Bedrock';
      } else if (provider === 'vertex') {
        baseUrl = 'Google Vertex AI';
      }

      // Token 状态
      const tokenStatus = this.getTokenStatus();

      return {
        connected: tokenStatus.valid,
        provider,
        baseUrl,
        models,
        tokenStatus,
      };
    } catch (error) {
      console.error('[ApiManager] 获取API状态失败:', error);
      return {
        connected: false,
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        models: [],
        tokenStatus: {
          type: 'none',
          valid: false,
        },
      };
    }
  }

  /**
   * 获取Token状态
   */
  getTokenStatus(): ApiStatusPayload['tokenStatus'] {
    try {
      const auth = getAuth();

      if (!auth) {
        return {
          type: 'none',
          valid: false,
        };
      }

      if (auth.type === 'api_key') {
        return {
          type: 'api_key',
          valid: !!auth.apiKey,
        };
      }

      if (auth.type === 'oauth') {
        const token = auth.accessToken || auth.authToken;
        const scopes = auth.scope || auth.scopes || [];

        // 检查token是否过期
        let expiresAt: number | undefined;
        if (auth.expiresAt) {
          expiresAt = typeof auth.expiresAt === 'number'
            ? auth.expiresAt
            : new Date(auth.expiresAt).getTime();
        }

        const isExpired = expiresAt ? Date.now() > expiresAt : false;

        return {
          type: 'oauth',
          valid: !!token && !isExpired,
          expiresAt,
          scope: scopes,
        };
      }

      return {
        type: 'none',
        valid: false,
      };
    } catch (error) {
      console.error('[ApiManager] 获取Token状态失败:', error);
      return {
        type: 'none',
        valid: false,
      };
    }
  }

  /**
   * 获取Provider信息
   */
  getProviderInfo(): ProviderInfo {
    try {
      const config = configManager.getAll();

      // 确定 provider 类型
      let type: 'anthropic' | 'bedrock' | 'vertex' = 'anthropic';
      if (config.useBedrock || config.apiProvider === 'bedrock') {
        type = 'bedrock';
      } else if (config.useVertex || config.apiProvider === 'vertex') {
        type = 'vertex';
      }

      // 基础信息
      const info: ProviderInfo = {
        type,
        name: this.getProviderName(type),
        endpoint: this.getProviderEndpoint(type),
        available: this.isProviderAvailable(type),
      };

      // 特定 provider 的额外信息
      if (type === 'bedrock') {
        info.region = process.env.AWS_REGION || 'us-east-1';
        info.metadata = {
          awsProfile: process.env.AWS_PROFILE,
        };
      } else if (type === 'vertex') {
        info.projectId = process.env.GOOGLE_CLOUD_PROJECT;
        info.region = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
        info.metadata = {
          serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        };
      }

      return info;
    } catch (error) {
      console.error('[ApiManager] 获取Provider信息失败:', error);
      return {
        type: 'anthropic',
        name: 'Anthropic',
        endpoint: 'https://api.anthropic.com',
        available: false,
      };
    }
  }

  /**
   * 获取Provider名称
   */
  private getProviderName(type: 'anthropic' | 'bedrock' | 'vertex'): string {
    switch (type) {
      case 'anthropic':
        return 'Anthropic';
      case 'bedrock':
        return 'AWS Bedrock';
      case 'vertex':
        return 'Google Vertex AI';
    }
  }

  /**
   * 获取Provider端点
   */
  private getProviderEndpoint(type: 'anthropic' | 'bedrock' | 'vertex'): string {
    if (type === 'anthropic') {
      return process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    } else if (type === 'bedrock') {
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://bedrock-runtime.${region}.amazonaws.com`;
    } else {
      const region = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
      const project = process.env.GOOGLE_CLOUD_PROJECT || 'unknown';
      return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}`;
    }
  }

  /**
   * 检查Provider是否可用
   */
  private isProviderAvailable(type: 'anthropic' | 'bedrock' | 'vertex'): boolean {
    try {
      const tokenStatus = this.getTokenStatus();

      if (type === 'anthropic') {
        return tokenStatus.valid;
      } else if (type === 'bedrock') {
        // 检查AWS凭据
        return !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
      } else {
        // 检查Google凭据
        return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT);
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * 重新初始化客户端
   */
  reinitialize(): void {
    this.client = null;
    this.initializeClient();
  }
}

// 导出单例
export const apiManager = new ApiManager();
