/**
 * API 代理服务管理
 *
 * 包装 proxy/server.ts 的 createProxyServer 为可在 WebUI 中启停的服务。
 * 配置存储在 settings.json 的 apiProxy 字段（passthrough）。
 */

import * as crypto from 'node:crypto';
import { configManager } from '../../../config/index.js';
import { webAuth } from '../web-auth.js';
import { oauthManager } from '../oauth-manager.js';

// ============ 类型 ============

export interface ApiProxyConfig {
  proxyKey?: string;
  port?: number;
  host?: string;
}

export interface ApiProxyStatus {
  running: boolean;
  config?: ApiProxyConfig;
  port?: number;
  host?: string;
  startedAt?: number;
  stats?: {
    totalRequests: number;
  };
}

// ============ ProxyService ============

class ProxyService {
  private proxyInstance: { server: any; start: () => Promise<void>; stop: () => Promise<void>; logs: any[]; totalRequests: number } | null = null;
  private startedAt: number | null = null;
  private currentConfig: ApiProxyConfig | null = null;

  /**
   * 从 settings.json 读取 apiProxy 配置
   */
  getConfig(): ApiProxyConfig {
    const all = configManager.getAll() as any;
    return all.apiProxy || {};
  }

  /**
   * 保存 apiProxy 配置到 settings.json
   */
  saveConfig(config: ApiProxyConfig): void {
    configManager.save({ apiProxy: config } as any);
    this.currentConfig = config;
  }

  /**
   * 启动代理服务器
   */
  async start(config?: Partial<ApiProxyConfig>): Promise<{ success: boolean; message: string }> {
    if (this.proxyInstance) {
      return { success: false, message: 'Proxy is already running' };
    }

    // 合并已保存配置与传入配置
    const saved = this.getConfig();
    const merged: ApiProxyConfig = { ...saved, ...config };

    // 生成 proxy key（如果没有）
    if (!merged.proxyKey) {
      merged.proxyKey = crypto.randomBytes(16).toString('hex');
    }

    const port = merged.port || 8082;
    const host = merged.host || '0.0.0.0';
    const proxyKey = merged.proxyKey;

    // 获取当前的 Anthropic API Key
    const creds = webAuth.getCredentials();
    if (!creds.apiKey && !creds.authToken) {
      return { success: false, message: 'No API Key or OAuth token configured. Please configure authentication first.' };
    }

    try {
      const { createProxyServer } = await import('../../../proxy/server.js');

      // 确定认证模式：优先 apiKey，其次 OAuth
      const oauthConfig = oauthManager.getOAuthConfig();
      const useOAuth = !creds.apiKey && creds.authToken;

      const proxyConfig: any = {
        port,
        host,
        proxyApiKey: proxyKey,
        authMode: useOAuth ? 'oauth' : 'api-key',
        targetBaseUrl: creds.baseUrl || 'https://api.anthropic.com',
      };

      if (!useOAuth) {
        proxyConfig.anthropicApiKey = creds.apiKey;
      } else {
        proxyConfig.oauthAccessToken = creds.authToken;
        proxyConfig.oauthRefreshToken = oauthConfig?.refreshToken || '';
        proxyConfig.oauthExpiresAt = oauthConfig?.expiresAt || 0;
      }

      this.proxyInstance = await createProxyServer(proxyConfig);
      await this.proxyInstance!.start();
      this.startedAt = Date.now();
      this.currentConfig = merged;

      // 保存配置（不含敏感的 anthropicKey）
      this.saveConfig(merged);

      return { success: true, message: `Proxy started on ${host}:${port}` };
    } catch (error: any) {
      this.proxyInstance = null;
      return { success: false, message: `Failed to start proxy: ${error.message}` };
    }
  }

  /**
   * 停止代理服务器
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.proxyInstance) {
      return { success: true, message: 'Proxy is not running' };
    }

    try {
      await this.proxyInstance.stop();
      this.proxyInstance = null;
      this.startedAt = null;
      return { success: true, message: 'Proxy stopped' };
    } catch (error: any) {
      this.proxyInstance = null;
      this.startedAt = null;
      return { success: false, message: `Failed to stop proxy: ${error.message}` };
    }
  }

  /**
   * 获取代理状态
   */
  getStatus(): ApiProxyStatus {
    const config = this.currentConfig || this.getConfig();

    if (!this.proxyInstance) {
      return { running: false, config };
    }

    return {
      running: true,
      config,
      port: config.port || 8082,
      host: config.host || '0.0.0.0',
      startedAt: this.startedAt || undefined,
      stats: {
        totalRequests: this.proxyInstance.totalRequests,
      },
    };
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.proxyInstance !== null;
  }
}

// 单例
export const proxyService = new ProxyService();
