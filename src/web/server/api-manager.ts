/**
 * API 管理器
 * 提供API连接测试、模型查询、Token状态等功能
 *
 * 认证唯一来源：WebAuthProvider（web-auth.ts）
 */

import { ClaudeClient } from '../../core/client.js';
import { configManager } from '../../config/index.js';
import { webAuth } from './web-auth.js';
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
      const creds = webAuth.getCredentials();

      if (!creds.apiKey && !creds.authToken) {
        console.warn('[ApiManager] No authentication configured, please configure API Key or login with OAuth in settings');
        return;
      }

      this.client = new ClaudeClient({
        apiKey: creds.apiKey,
        authToken: creds.authToken,
        baseUrl: creds.baseUrl,
      });
    } catch (error) {
      console.error('[ApiManager] Failed to initialize client:', error);
    }
  }

  /**
   * 测试API连接
   */
  async testConnection(): Promise<ApiTestResult> {
    const startTime = Date.now();

    try {
      // 确保 OAuth token 有效（对齐官方 NM()）
      await webAuth.ensureValidToken();

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
      const allModels = modelConfig.getAllModels().map(m => m.id);
      const tokenStatus = webAuth.getTokenStatus();

      // 如果使用 OAuth，检查 scope 过滤模型
      if (tokenStatus.type === 'oauth') {
        const scope = tokenStatus.scope || [];
        if (!scope.includes('user:inference')) {
          return allModels.filter(m => m.includes('haiku'));
        }
      }

      return allModels;
    } catch (error) {
      console.error('[ApiManager] Failed to get model list:', error);
      return [];
    }
  }

  /**
   * 获取API状态
   */
  async getStatus(): Promise<ApiStatusPayload> {
    try {
      // 确保 OAuth token 有效（对齐官方 NM()）
      await webAuth.ensureValidToken();

      const models = await this.getAvailableModels();
      const providerName = webAuth.getProvider();

      // 确定 provider 类型
      let provider: 'anthropic' | 'bedrock' | 'vertex' = 'anthropic';
      if (providerName === 'bedrock') {
        provider = 'bedrock';
      } else if (providerName === 'vertex') {
        provider = 'vertex';
      }

      // 确定 base URL
      const creds = webAuth.getCredentials();
      let baseUrl = creds.baseUrl || 'https://api.anthropic.com';
      if (provider === 'bedrock') {
        baseUrl = 'AWS Bedrock';
      } else if (provider === 'vertex') {
        baseUrl = 'Google Vertex AI';
      }

      // Token 状态
      const tokenStatus = webAuth.getTokenStatus();

      return {
        connected: tokenStatus.valid,
        provider,
        baseUrl,
        models,
        tokenStatus,
      };
    } catch (error) {
      console.error('[ApiManager] Failed to get API status:', error);
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
    return webAuth.getTokenStatus();
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
      console.error('[ApiManager] Failed to get provider info:', error);
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
