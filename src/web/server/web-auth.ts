/**
 * WebUI 认证提供者 — 唯一认证入口
 *
 * 所有 WebUI 模块获取认证信息只通过这一个类。
 *
 * 存储唯一来源：settings.json
 *   ├── apiKey        — 用户在 UI 配置的 API Key
 *   ├── oauthAccount  — 用户在 UI 登录的 OAuth token
 *   ├── authPriority  — 用户选择的认证方式 ('apiKey' | 'oauth' | 'auto')
 *   └── apiBaseUrl    — 自定义 API 地址
 *
 * 规则：
 *   authPriority = 'apiKey' → 只用 apiKey
 *   authPriority = 'oauth'  → 只用 oauthAccount
 *   authPriority = 'auto'   → 有 apiKey 用 apiKey，否则用 oauthAccount
 *   都没有 → 未认证
 *
 * 不读：环境变量、.credentials.json、config.json、Keychain、内置代理。
 * CLI 模式不受影响（CLI 继续用 src/auth/index.ts 的 initAuth/getAuth）。
 */

import * as fs from 'fs';
import { configManager } from '../../config/index.js';
import { oauthManager } from './oauth-manager.js';
import type { AuthStatus, OAuthConfig } from '../shared/types.js';
import Anthropic from '@anthropic-ai/sdk';

// ============ 类型 ============

export interface WebAuthCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

interface WebUiSettings {
  apiKey?: string;
  authPriority: 'apiKey' | 'oauth' | 'auto';
  apiBaseUrl?: string;
  customModelName?: string;
}

// ============ WebAuthProvider ============

class WebAuthProvider {

  // ---------- 读取 settings.json ----------

  /**
   * 从 settings.json 直接读取，不走 configManager.getAll()，避免环境变量污染
   */
  private readSettings(): WebUiSettings {
    try {
      const settingsPath = configManager.getConfigPaths().userSettings;
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return {
          apiKey: raw.apiKey,
          authPriority: raw.authPriority || 'auto',
          apiBaseUrl: raw.apiBaseUrl,
          customModelName: raw.customModelName,
        };
      }
    } catch {
      // 忽略
    }
    return { authPriority: 'auto' };
  }

  // ---------- Token 有效性保障（对齐官方 NM() 语义） ----------

  /** 防止并发刷新 */
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * 确保 OAuth token 有效（每次 API 调用前必须 await 此方法）
   *
   * 对齐官方 CLI：每次出站 API 请求前执行 `await NM()`
   *   - token 未过期（含 5 分钟缓冲）→ 直接返回
   *   - token 即将/已过期 → 自动刷新
   *   - 非 OAuth 认证 → 直接返回
   *
   * 返回 true 表示 token 有效或已刷新成功
   */
  async ensureValidToken(): Promise<boolean> {
    const settings = this.readSettings();

    // 非 OAuth 模式，不需要刷新
    if (settings.authPriority === 'apiKey') return true;
    if (settings.authPriority === 'auto' && settings.apiKey) return true;

    // 检查是否有 OAuth 配置
    const config = oauthManager.getOAuthConfig();
    if (!config) return true; // 完全没有 OAuth 配置，交给后续报错

    // accessToken 为空但有 refreshToken（上次刷新失败后保留的）→ 需要尝试刷新
    const needsRefreshFromEmpty = !config.accessToken && config.refreshToken;

    // token 未过期（5 分钟缓冲）且 accessToken 存在
    if (!needsRefreshFromEmpty && !oauthManager.isTokenExpired()) return true;

    // 需要刷新 — 使用并发锁
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        console.log('[WebAuth] OAuth token expiring soon, auto-refreshing...');
        await oauthManager.refreshToken();
        console.log('[WebAuth] OAuth token refreshed successfully');
        return true;
      } catch (err: any) {
        console.error('[WebAuth] OAuth token refresh failed:', err.message);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // ---------- 核心方法：获取凭证 ----------

  /**
   * 获取当前应使用的认证凭证（同步版本）
   * 注意：此方法不做 token 过期检查，调用方应先 await ensureValidToken()
   */
  getCredentials(): WebAuthCredentials {
    const settings = this.readSettings();
    const result: WebAuthCredentials = {};

    if (settings.apiBaseUrl) {
      result.baseUrl = settings.apiBaseUrl;
    }

    if (settings.authPriority === 'apiKey') {
      result.apiKey = settings.apiKey;
    } else if (settings.authPriority === 'oauth') {
      const oauthCreds = this.getOAuthCredentials();
      result.apiKey = oauthCreds.apiKey;
      result.authToken = oauthCreds.authToken;
    } else {
      // auto
      if (settings.apiKey) {
        result.apiKey = settings.apiKey;
      } else {
        const oauthCreds = this.getOAuthCredentials();
        result.apiKey = oauthCreds.apiKey;
        result.authToken = oauthCreds.authToken;
      }
    }

    return result;
  }

  /**
   * 是否已认证
   */
  isAuthenticated(): boolean {
    const creds = this.getCredentials();
    return !!(creds.apiKey || creds.authToken);
  }

  // ---------- 状态查询（给前端显示用） ----------

  /**
   * 获取认证状态（给 /api/auth/status 和 websocket 用）
   */
  getStatus(): AuthStatus {
    const settings = this.readSettings();

    // apiKey 优先检查
    if (settings.apiKey && settings.authPriority !== 'oauth') {
      return { authenticated: true, type: 'api_key', provider: this.getProvider() };
    }

    // OAuth 检查
    const oauthConfig = oauthManager.getOAuthConfig();
    if (oauthConfig?.accessToken) {
      return { authenticated: true, type: 'oauth', provider: this.getProvider() };
    }

    // auto 模式回退到 apiKey
    if (settings.apiKey) {
      return { authenticated: true, type: 'api_key', provider: this.getProvider() };
    }

    return { authenticated: false, type: 'none', provider: 'anthropic' };
  }

  /**
   * 获取 OAuth 详细状态（给前端认证状态接口用）
   */
  getOAuthStatus(): {
    authenticated: boolean;
    displayName?: string;
    subscriptionType?: string;
    expiresAt?: number;
    scopes?: string[];
  } {
    const oauthConfig = oauthManager.getOAuthConfig();
    if (!oauthConfig?.accessToken) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      displayName: oauthConfig.displayName,
      subscriptionType: oauthConfig.subscriptionType,
      expiresAt: oauthConfig.expiresAt,
      scopes: oauthConfig.scopes,
    };
  }

  /**
   * 获取 Token 状态（给 api-manager 的 getTokenStatus 用）
   */
  getTokenStatus(): { type: 'none' | 'api_key' | 'oauth'; valid: boolean; expiresAt?: number; scope?: string[] } {
    const settings = this.readSettings();

    // API Key
    if (settings.apiKey && settings.authPriority !== 'oauth') {
      return { type: 'api_key', valid: true };
    }

    // OAuth
    const oauthConfig = oauthManager.getOAuthConfig();
    if (oauthConfig?.accessToken) {
      const isExpired = oauthConfig.expiresAt ? Date.now() > oauthConfig.expiresAt : false;
      return {
        type: 'oauth',
        valid: !isExpired,
        expiresAt: oauthConfig.expiresAt,
        scope: oauthConfig.scopes,
      };
    }

    // auto 回退
    if (settings.apiKey) {
      return { type: 'api_key', valid: true };
    }

    return { type: 'none', valid: false };
  }

  // ---------- 写入操作 ----------

  /**
   * 设置 API Key（只写 settings.json）
   */
  setApiKey(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    try {
      configManager.set('apiKey', key);
      return true;
    } catch (error) {
      console.error('[WebAuth] Failed to set API Key:', error);
      return false;
    }
  }

  /**
   * 清除 API Key
   */
  clearApiKey(): void {
    try {
      configManager.set('apiKey', undefined as any);
    } catch (error) {
      console.error('[WebAuth] Failed to clear API Key:', error);
    }
  }

  /**
   * 清除所有认证（API Key + OAuth）
   */
  clearAll(): void {
    this.clearApiKey();
    oauthManager.clearOAuthConfig();
  }

  // ---------- 验证 ----------

  /**
   * 验证 API Key 是否有效
   */
  async validateApiKey(key: string): Promise<boolean> {
    try {
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch (error: any) {
      if (error?.status === 401 || error?.error?.type === 'authentication_error') {
        return false;
      }
      // 非认证错误（网络等），认为 key 可能有效
      return true;
    }
  }

  // ---------- 辅助显示 ----------

  /**
   * 获取掩码 API Key（给前端显示）
   */
  getMaskedApiKey(): string | undefined {
    const settings = this.readSettings();
    const apiKey = settings.apiKey;
    if (!apiKey) return undefined;
    if (apiKey.length > 11) {
      return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
    }
    return '***';
  }

  /**
   * 获取 WebUI 的自定义模型名
   */
  getCustomModelName(): string | undefined {
    return this.readSettings().customModelName;
  }

  /**
   * 获取认证提供商
   */
  getProvider(): string {
    const apiProvider = configManager.get('apiProvider');
    if (apiProvider) return apiProvider;
    if (configManager.get('useBedrock')) return 'bedrock';
    if (configManager.get('useVertex')) return 'vertex';
    return 'anthropic';
  }

  // ---------- 内部方法 ----------

  /**
   * 从 oauthManager 获取推理用凭证。
   * - 若 token 有 user:inference scope → 用 authToken（直接 Bearer 推理）
   * - 若 token 仅有 org:create_api_key scope 但已存 oauthApiKey → 用 apiKey 推理
   * - 否则降级为 authToken（让 API 返回真实错误）
   */
  private getOAuthCredentials(): { apiKey?: string; authToken?: string } {
    const oauthConfig = oauthManager.getOAuthConfig();
    if (!oauthConfig) return {};

    // accessToken 为空（刷新失败后清除了）则视为无凭证
    if (!oauthConfig.accessToken) return {};

    const hasInferenceScope = oauthConfig.scopes?.includes('user:inference');
    if (hasInferenceScope) {
      return { authToken: oauthConfig.accessToken };
    }
    if (oauthConfig.oauthApiKey) {
      return { apiKey: oauthConfig.oauthApiKey };
    }
    // fallback：token 没推理权限也没 API key，原样返回让 API 报错
    return { authToken: oauthConfig.accessToken };
  }
}

// 导出单例
export const webAuth = new WebAuthProvider();
