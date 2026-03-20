/**
 * API 管理器
 * 提供API连接测试、模型查询、Token状态等功能
 *
 * 认证唯一来源：WebAuthProvider（web-auth.ts）
 */

import { configManager } from '../../config/index.js';
import { webAuth } from './web-auth.js';
import { modelConfig } from '../../models/index.js';
import type { ApiStatusPayload, ApiTestResult, ProviderInfo } from '../shared/types.js';
import { createConversationClient } from './runtime/factory.js';
import type { ConversationClient } from './runtime/types.js';
import {
  getProviderForRuntimeBackend,
  normalizeWebRuntimeModelForBackend,
  type WebRuntimeBackend,
} from '../shared/model-catalog.js';

export class ApiManager {
  private client: ConversationClient | null = null;

  constructor() {
    this.initializeClient();
  }

  private resolveRuntimeModel(runtimeBackend: WebRuntimeBackend): string {
    const configuredModel = webAuth.getCustomModelName() || webAuth.getCodexModelName();
    const preferredModel =
      configuredModel
      || (runtimeBackend === 'claude-subscription' || runtimeBackend === 'claude-compatible-api'
        ? 'haiku'
        : 'gpt-5.4');

    return normalizeWebRuntimeModelForBackend(
      runtimeBackend,
      preferredModel,
      configuredModel,
    );
  }

  /**
   * 初始化Claude客户端
   */
  private initializeClient(): void {
    try {
      const creds = webAuth.getCredentials();
      const runtimeBackend = webAuth.getRuntimeBackend();
      const model = this.resolveRuntimeModel(runtimeBackend);
      const provider = getProviderForRuntimeBackend(runtimeBackend, model);
      const configuredModel = webAuth.getCustomModelName() || webAuth.getCodexModelName();

      if (!creds.apiKey && !creds.authToken) {
        console.warn('[ApiManager] No authentication configured, please configure API Key or login with OAuth in settings');
        return;
      }

      this.client = createConversationClient({
        provider,
        model,
        apiKey: creds.apiKey,
        authToken: creds.authToken,
        baseUrl: creds.baseUrl,
        accountId: creds.accountId,
        customModelName: configuredModel,
      });
    } catch (error) {
      console.error('[ApiManager] Failed to initialize client:', error);
    }
  }

  private extractModelIds(payload: unknown): string[] {
    const values = new Set<string>();
    const models: string[] = [];

    const append = (value: unknown) => {
      const normalized = typeof value === 'string' ? value.trim() : '';
      if (!normalized || values.has(normalized)) {
        return;
      }
      values.add(normalized);
      models.push(normalized);
    };

    const visit = (value: unknown) => {
      if (typeof value === 'string') {
        append(value);
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }

      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') {
        append(record.id);
        return;
      }
      if (typeof record.name === 'string') {
        append(record.name);
        return;
      }
      if (typeof record.model === 'string') {
        append(record.model);
      }
    };

    if (Array.isArray(payload)) {
      payload.forEach(visit);
      return models;
    }

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      if (Array.isArray(record.data)) {
        record.data.forEach(visit);
      }
      if (Array.isArray(record.models)) {
        record.models.forEach(visit);
      }
    }

    return models;
  }

  private async fetchCompatibleModels(runtimeBackend: WebRuntimeBackend): Promise<string[] | null> {
    if (runtimeBackend !== 'axon-cloud') {
      return null;
    }

    const creds = webAuth.getCredentials(runtimeBackend);
    const apiKey = creds.apiKey?.trim();
    const rawBaseUrl = creds.baseUrl?.trim();
    const baseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : undefined;

    if (!apiKey || !baseUrl) {
      return null;
    }

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Model catalog endpoint returned ${response.status}`);
      }

      const payload = await response.json();
      const models = this.extractModelIds(payload);
      return models.length > 0 ? models : null;
    } catch (error) {
      console.warn('[ApiManager] Failed to fetch compatible model catalog:', error);
      return null;
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
          error: 'API client not initialized',
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
        error: error.message || 'Unknown error',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 获取可用模型列表
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const runtimeBackend = webAuth.getRuntimeBackend();

      if (webAuth.getRuntimeProvider() === 'codex') {
        return [webAuth.getCodexModelName() || 'gpt-5-codex'];
      }

      const compatibleModels = await this.fetchCompatibleModels(runtimeBackend);
      if (compatibleModels && compatibleModels.length > 0) {
        return compatibleModels;
      }

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
      const runtimeBackend = webAuth.getRuntimeBackend();
      const runtimeModel = this.resolveRuntimeModel(runtimeBackend);
      const resolvedProvider = getProviderForRuntimeBackend(runtimeBackend, runtimeModel);

      // 确定 provider 类型
      let provider: 'anthropic' | 'bedrock' | 'vertex' | 'codex' = 'anthropic';
      if (providerName === 'bedrock') {
        provider = 'bedrock';
      } else if (providerName === 'vertex') {
        provider = 'vertex';
      } else if (providerName === 'codex' || resolvedProvider === 'codex') {
        provider = 'codex';
      }

      // 确定 base URL
      const creds = webAuth.getCredentials();
      let baseUrl = creds.baseUrl || (provider === 'codex' ? webAuth.getCodexBaseUrl() : 'https://api.anthropic.com');
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
        provider: webAuth.getRuntimeProvider() === 'codex' ? 'codex' : 'anthropic',
        baseUrl: webAuth.getRuntimeProvider() === 'codex' ? webAuth.getCodexBaseUrl() : 'https://api.anthropic.com',
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
      const runtimeBackend = webAuth.getRuntimeBackend();
      const runtimeModel = this.resolveRuntimeModel(runtimeBackend);
      const runtimeProvider = getProviderForRuntimeBackend(runtimeBackend, runtimeModel);

      // 确定 provider 类型
      let type: 'anthropic' | 'bedrock' | 'vertex' | 'codex' = runtimeProvider === 'codex' ? 'codex' : 'anthropic';
      if (type !== 'codex' && (config.useBedrock || config.apiProvider === 'bedrock')) {
        type = 'bedrock';
      } else if (type !== 'codex' && (config.useVertex || config.apiProvider === 'vertex')) {
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
        type: webAuth.getRuntimeProvider() === 'codex' ? 'codex' : 'anthropic',
        name: webAuth.getRuntimeProvider() === 'codex' ? 'OpenAI Codex' : 'Anthropic',
        endpoint: webAuth.getRuntimeProvider() === 'codex' ? 'https://chatgpt.com/backend-api/codex' : 'https://api.anthropic.com',
        available: false,
      };
    }
  }

  /**
   * 获取Provider名称
   */
  private getProviderName(type: 'anthropic' | 'bedrock' | 'vertex' | 'codex'): string {
    switch (type) {
      case 'codex':
        return 'OpenAI Codex';
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
  private getProviderEndpoint(type: 'anthropic' | 'bedrock' | 'vertex' | 'codex'): string {
    if (type === 'codex') {
      return webAuth.getCodexBaseUrl();
    }
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
  private isProviderAvailable(type: 'anthropic' | 'bedrock' | 'vertex' | 'codex'): boolean {
    try {
      const tokenStatus = this.getTokenStatus();

      if (type === 'codex' || type === 'anthropic') {
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
