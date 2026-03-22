/**
 * API 管理器
 * 提供API连接测试、模型查询、Token状态等功能
 *
 * 认证唯一来源：WebAuthProvider（web-auth.ts）
 */

import { webAuth } from './web-auth.js';
import { modelConfig } from '../../models/index.js';
import type { ApiStatusPayload, ApiTestResult, ProviderInfo } from '../shared/types.js';
import { createConversationClient } from './runtime/factory.js';
import type { ConversationClient } from './runtime/types.js';
import {
  getRuntimeBackendLabel,
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
} from '../shared/model-catalog.js';
import {
  getDefaultBaseUrlForRuntimeBackend,
  getDefaultTestModelForRuntimeBackend,
} from '../shared/runtime-capabilities.js';
import { fetchRuntimeModelCatalog } from './runtime/runtime-model-catalog.js';
import { resolveRuntimeSelection } from './runtime/runtime-selection.js';

type RuntimeStatusProvider = ProviderInfo['type'];

interface RuntimeStatusSnapshot {
  runtimeBackend: WebRuntimeBackend;
  runtimeModel: string;
  provider: RuntimeStatusProvider;
  baseUrl: string;
  endpoint: string;
}

export class ApiManager {
  private client: ConversationClient | null = null;

  constructor() {
    this.initializeClient();
  }

  private getRuntimeSelection(runtimeBackend: WebRuntimeBackend) {
    const defaultModelByBackend = webAuth.getDefaultModelByBackend();
    const customModelCatalogByBackend = webAuth.getCustomModelCatalogByBackend();
    const baseSelection = resolveRuntimeSelection({
      runtimeBackend,
      defaultModelByBackend,
      customModelCatalogByBackend,
      codexModelName: webAuth.getCodexModelName(),
      customModelName: webAuth.getCustomModelName(),
    });

    const hasStoredCatalog = !!customModelCatalogByBackend?.[runtimeBackend]?.length;
    const hasStoredModel = !!baseSelection.customModelName;
    if (hasStoredModel || hasStoredCatalog) {
      return baseSelection;
    }

    return resolveRuntimeSelection({
      runtimeBackend,
      model: getDefaultTestModelForRuntimeBackend(runtimeBackend),
      defaultModelByBackend,
      customModelCatalogByBackend,
      codexModelName: webAuth.getCodexModelName(),
      customModelName: webAuth.getCustomModelName(),
    });
  }

  private resolveRuntimeModel(runtimeBackend: WebRuntimeBackend): string {
    return this.getRuntimeSelection(runtimeBackend).normalizedModel;
  }

  private resolveStatusProvider(runtimeBackend: WebRuntimeBackend): RuntimeStatusProvider {
    const runtimeProvider = this.getRuntimeSelection(runtimeBackend).provider;
    const providerName = webAuth.getProvider();

    if (providerName === 'bedrock') {
      return 'bedrock';
    }

    if (providerName === 'vertex') {
      return 'vertex';
    }

    return runtimeProvider === 'codex' ? 'codex' : 'anthropic';
  }

  private getBedrockEndpoint(): string {
    const region = process.env.AWS_REGION || 'us-east-1';
    return `https://bedrock-runtime.${region}.amazonaws.com`;
  }

  private getVertexEndpoint(): string {
    const region = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'unknown';
    return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}`;
  }

  private resolveRuntimeEndpoint(
    runtimeBackend: WebRuntimeBackend,
    provider: RuntimeStatusProvider,
  ): string {
    if (provider === 'bedrock') {
      return this.getBedrockEndpoint();
    }

    if (provider === 'vertex') {
      return this.getVertexEndpoint();
    }

    const creds = webAuth.getCredentials(runtimeBackend);
    const configuredBaseUrl = creds.baseUrl?.trim();
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }

    return getDefaultBaseUrlForRuntimeBackend(runtimeBackend, {
      useApiKey: provider === 'codex' && !creds.authToken && !!creds.apiKey,
    });
  }

  private getRuntimeStatusSnapshot(): RuntimeStatusSnapshot {
    const runtimeBackend = webAuth.getRuntimeBackend();
    const runtimeModel = this.resolveRuntimeModel(runtimeBackend);
    const provider = this.resolveStatusProvider(runtimeBackend);
    const endpoint = this.resolveRuntimeEndpoint(runtimeBackend, provider);
    const baseUrl = provider === 'bedrock'
      ? 'AWS Bedrock'
      : provider === 'vertex'
        ? 'Google Vertex AI'
        : endpoint;

    return {
      runtimeBackend,
      runtimeModel,
      provider,
      baseUrl,
      endpoint,
    };
  }

  private getSafeRuntimeStatusSnapshot(): RuntimeStatusSnapshot {
    try {
      return this.getRuntimeStatusSnapshot();
    } catch {
      const runtimeBackend: WebRuntimeBackend = 'claude-compatible-api';
      const runtimeModel = getDefaultTestModelForRuntimeBackend(runtimeBackend);
      const endpoint = getDefaultBaseUrlForRuntimeBackend(runtimeBackend);
      return {
        runtimeBackend,
        runtimeModel,
        provider: 'anthropic',
        baseUrl: endpoint,
        endpoint,
      };
    }
  }

  /**
   * 初始化Claude客户端
   */
  private initializeClient(): void {
    try {
      const creds = webAuth.getCredentials();
      const runtimeBackend = webAuth.getRuntimeBackend();
      const selection = this.getRuntimeSelection(runtimeBackend);
      const model = selection.normalizedModel;
      const provider = selection.provider;

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
        customModelName: selection.customModelName,
      });
    } catch (error) {
      console.error('[ApiManager] Failed to initialize client:', error);
    }
  }

  private async fetchCompatibleModels(runtimeBackend: WebRuntimeBackend): Promise<string[] | null> {
    if (!supportsDynamicModelCatalogForBackend(runtimeBackend)) {
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
      return await fetchRuntimeModelCatalog({
        runtimeBackend,
        apiKey,
        baseUrl,
      });
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
      const compatibleModels = await this.fetchCompatibleModels(runtimeBackend);
      if (compatibleModels && compatibleModels.length > 0) {
        return compatibleModels;
      }

      const selection = this.getRuntimeSelection(runtimeBackend);
      if (selection.provider === 'codex') {
        return [selection.customModelName || selection.normalizedModel];
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
      const runtime = this.getRuntimeStatusSnapshot();

      // Token 状态
      const tokenStatus = webAuth.getTokenStatus();

      return {
        connected: tokenStatus.valid,
        provider: runtime.provider,
        runtimeBackend: runtime.runtimeBackend,
        runtimeModel: runtime.runtimeModel,
        baseUrl: runtime.baseUrl,
        models,
        tokenStatus,
      };
    } catch (error) {
      console.error('[ApiManager] Failed to get API status:', error);
      const runtime = this.getSafeRuntimeStatusSnapshot();
      return {
        connected: false,
        provider: runtime.provider,
        runtimeBackend: runtime.runtimeBackend,
        runtimeModel: runtime.runtimeModel,
        baseUrl: runtime.baseUrl,
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
      const runtime = this.getRuntimeStatusSnapshot();

      // 基础信息
      const info: ProviderInfo = {
        type: runtime.provider,
        name: this.getProviderName(runtime.provider, runtime.runtimeBackend),
        runtimeBackend: runtime.runtimeBackend,
        runtimeModel: runtime.runtimeModel,
        endpoint: runtime.endpoint,
        available: this.isProviderAvailable(runtime.provider),
      };

      // 特定 provider 的额外信息
      if (runtime.provider === 'bedrock') {
        info.region = process.env.AWS_REGION || 'us-east-1';
        info.metadata = {
          awsProfile: process.env.AWS_PROFILE,
        };
      } else if (runtime.provider === 'vertex') {
        info.projectId = process.env.GOOGLE_CLOUD_PROJECT;
        info.region = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
        info.metadata = {
          serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        };
      }

      return info;
    } catch (error) {
      console.error('[ApiManager] Failed to get provider info:', error);
      const runtime = this.getSafeRuntimeStatusSnapshot();
      return {
        type: runtime.provider,
        name: this.getProviderName(runtime.provider, runtime.runtimeBackend),
        runtimeBackend: runtime.runtimeBackend,
        runtimeModel: runtime.runtimeModel,
        endpoint: runtime.endpoint,
        available: false,
      };
    }
  }

  /**
   * 获取Provider名称
   */
  private getProviderName(
    type: RuntimeStatusProvider,
    runtimeBackend: WebRuntimeBackend,
  ): string {
    switch (type) {
      case 'codex':
      case 'anthropic':
        return getRuntimeBackendLabel(runtimeBackend);
      case 'bedrock':
        return 'AWS Bedrock';
      case 'vertex':
        return 'Google Vertex AI';
    }
  }

  /**
   * 检查Provider是否可用
   */
  private isProviderAvailable(type: RuntimeStatusProvider): boolean {
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
