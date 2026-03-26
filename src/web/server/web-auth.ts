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
import { codexAuthManager, type CodexAuthConfig } from './codex-auth-manager.js';
import type { AuthStatus } from '../shared/types.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  getProviderForRuntimeBackend,
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../shared/model-catalog.js';
import {
  getDefaultBaseUrlForRuntimeBackend,
  getRuntimeOAuthRefreshStrategy,
} from '../shared/runtime-capabilities.js';
import {
  normalizeRuntimeConfigShape,
  type RuntimeConfigApiProvider,
} from '../shared/setup-runtime.js';

function isCodexCompatibleModel(model?: string): boolean {
  if (!model) return false;
  const normalized = model.trim();
  if (!normalized) return false;
  return /^(gpt-|o\d(?:$|[-_])|codex)/i.test(normalized) || normalized.toLowerCase().includes('codex');
}

// ============ 类型 ============

export interface WebAuthCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  accountId?: string;
}

interface WebUiSettings {
  apiKey?: string;
  authPriority: 'apiKey' | 'oauth' | 'auto';
  apiBaseUrl?: string;
  apiProvider?: string;
  customModelName?: string;
  runtimeBackend?: WebRuntimeBackend;
  runtimeProvider?: 'anthropic' | 'codex';
  defaultModelByBackend?: Partial<Record<WebRuntimeBackend, string>>;
  customModelCatalogByBackend?: Partial<Record<WebRuntimeBackend, string[]>>;
}

function isCodexChatGptBaseUrlCandidate(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (parsed.hostname === 'chatgpt.com' && normalizedPath === '/backend-api/codex') {
      return true;
    }

    return /\/backend-api\/codex$/i.test(normalizedPath);
  } catch {
    return false;
  }
}

function isCodexApiKeyBaseUrlCandidate(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (normalizedPath === '/v1') {
      return true;
    }

    return isCodexChatGptBaseUrlCandidate(baseUrl);
  } catch {
    return false;
  }
}

function isRuntimeConfigApiProvider(value?: string): value is RuntimeConfigApiProvider {
  return value === 'anthropic'
    || value === 'openai-compatible'
    || value === 'axon-cloud'
    || value === 'bedrock'
    || value === 'vertex';
}

// ============ WebAuthProvider ============

class WebAuthProvider {

  // ---------- 读取 settings.json ----------

  /**
   * 从 settings.json 直接读取，不走 configManager.getAll()，避免环境变量污染。
   * 当 settings.json 没有 apiKey 时，回退到环境变量 ANTHROPIC_API_KEY / AXON_API_KEY。
   * 这样 Railway/Docker 等容器化部署只需设置环境变量，无需持久化 settings.json。
   */
  private readSettings(): WebUiSettings {
    try {
      const settingsPath = configManager.getConfigPaths().userSettings;
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const result: WebUiSettings = {
          apiKey: raw.apiKey,
          authPriority: raw.authPriority || 'auto',
          apiBaseUrl: raw.apiBaseUrl,
          apiProvider: raw.apiProvider,
          customModelName: raw.customModelName,
          runtimeBackend: raw.runtimeBackend,
          runtimeProvider: raw.runtimeProvider || 'anthropic',
          defaultModelByBackend: raw.defaultModelByBackend,
          customModelCatalogByBackend: raw.customModelCatalogByBackend,
        };

        // settings.json 没有 apiKey 时，回退到环境变量
        if (!result.apiKey) {
          const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
          if (envKey) {
            result.apiKey = envKey;
          }
        }

        // apiBaseUrl 也支持环境变量回退
        if (!result.apiBaseUrl) {
          const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
          if (envBaseUrl) {
            result.apiBaseUrl = envBaseUrl;
          }
        }

        return result;
      }
    } catch {
      // 忽略
    }

    // settings.json 不存在时，也检查环境变量
    const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
    const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
    return {
      apiKey: envKey,
      authPriority: 'auto',
      apiBaseUrl: envBaseUrl,
      apiProvider: undefined,
      runtimeBackend: undefined,
      runtimeProvider: 'anthropic',
      defaultModelByBackend: undefined,
      customModelCatalogByBackend: undefined,
    };
  }

  private inferRuntimeBackend(settings: WebUiSettings): WebRuntimeBackend {
    const oauthConfig = oauthManager.getOAuthConfig();

    if (
      settings.authPriority === 'oauth'
      && oauthConfig?.subscriptionType === 'console'
      && settings.runtimeProvider !== 'codex'
      && (!settings.runtimeBackend || settings.runtimeBackend === 'claude-subscription')
    ) {
      return 'claude-compatible-api';
    }

    if (settings.apiBaseUrl?.includes('chatbi.site')) {
      return 'axon-cloud';
    }

    return normalizeRuntimeConfigShape({
      updates: {
        runtimeBackend: settings.runtimeBackend,
        runtimeProvider: settings.runtimeProvider,
        apiProvider: isRuntimeConfigApiProvider(settings.apiProvider) ? settings.apiProvider : undefined,
        authPriority: settings.authPriority,
      },
    }).runtimeBackend;
  }

  private getStoredModelForBackend(
    backend: WebRuntimeBackend,
    settings: WebUiSettings = this.readSettings(),
  ): string | undefined {
    const mapped = settings.defaultModelByBackend?.[backend]?.trim();
    if (mapped) {
      return mapped;
    }

    const legacyModel = settings.customModelName?.trim();
    if (!legacyModel) {
      return undefined;
    }

    if (supportsDynamicModelCatalogForBackend(backend)) {
      return legacyModel;
    }

    const provider = getProviderForRuntimeBackend(backend);
    if (provider === 'codex') {
      return isCodexCompatibleModel(legacyModel) ? legacyModel : undefined;
    }

    return !isCodexCompatibleModel(legacyModel) ? legacyModel : undefined;
  }

  private getNormalizedModelMap(
    settings: WebUiSettings = this.readSettings(),
  ): Partial<Record<WebRuntimeBackend, string>> {
    const runtimeBackend = this.inferRuntimeBackend(settings);
    const models: Partial<Record<WebRuntimeBackend, string>> = {
      ...(settings.defaultModelByBackend || {}),
    };

    const currentModel = this.getStoredModelForBackend(runtimeBackend, settings);
    if (currentModel) {
      models[runtimeBackend] = currentModel;
    }

    return models;
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
  async ensureValidToken(
    runtimeBackend: WebRuntimeBackend = this.inferRuntimeBackend(this.readSettings()),
  ): Promise<boolean> {
    const settings = this.readSettings();
    const refreshStrategy = getRuntimeOAuthRefreshStrategy(runtimeBackend, {
      authPriority: settings.authPriority,
    });

    if (refreshStrategy === 'codex') {
      const codexConfig = codexAuthManager.getAuthConfig();
      if (!codexConfig?.accessToken) return true;
      if (!codexAuthManager.isTokenExpired()) return true;

      if (this.refreshPromise) {
        return this.refreshPromise;
      }

      this.refreshPromise = (async () => {
        try {
          console.log('[WebAuth] Codex token expiring soon, auto-refreshing...');
          await codexAuthManager.refreshToken();
          console.log('[WebAuth] Codex token refreshed successfully');
          return true;
        } catch (err: any) {
          console.error('[WebAuth] Codex token refresh failed:', err.message);
          return false;
        } finally {
          this.refreshPromise = null;
        }
      })();

      return this.refreshPromise;
    }

    if (refreshStrategy !== 'anthropic') return true;

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
  getCredentials(
    runtimeBackend: WebRuntimeBackend = this.inferRuntimeBackend(this.readSettings()),
  ): WebAuthCredentials {
    const settings = this.readSettings();

    if (runtimeBackend === 'codex-subscription') {
      const codexCreds = this.getCodexCredentials();
      return {
        apiKey: codexCreds.apiKey,
        authToken: codexCreds.authToken,
        accountId: codexCreds.accountId,
        baseUrl: this.getCodexBaseUrl(settings),
      };
    }

    const result: WebAuthCredentials = {};

    const isAnthropicOAuthMode =
      settings.authPriority === 'oauth'
      && (runtimeBackend === 'claude-subscription' || runtimeBackend === 'claude-compatible-api');

    if (isAnthropicOAuthMode) {
      // OAuth 凭据由 Anthropic 官方颁发，必须发到 api.anthropic.com
      // 不能使用用户之前配置的自定义 apiBaseUrl（可能是代理，不认 OAuth key）
      const oauthCreds = this.getOAuthCredentials();
      result.apiKey = oauthCreds.apiKey;
      result.authToken = oauthCreds.authToken;
    } else {
      if (settings.apiBaseUrl) {
        result.baseUrl = settings.apiBaseUrl;
      }
      result.apiKey = settings.apiKey;
    }

    return result;
  }

  /**
   * 是否已认证
   */
  isAuthenticated(runtimeBackend?: WebRuntimeBackend): boolean {
    const creds = this.getCredentials(runtimeBackend);
    return !!(creds.apiKey || creds.authToken);
  }

  // ---------- 状态查询（给前端显示用） ----------

  /**
   * 判断当前用户是否通过 Axon Cloud 认证（apiBaseUrl 包含 chatbi.site）
   */
  isAxonCloudUser(): boolean {
    const settings = this.readSettings();
    return this.inferRuntimeBackend(settings) === 'axon-cloud'
      || (!!settings.apiBaseUrl && settings.apiBaseUrl.includes('chatbi.site'));
  }

  /**
   * 获取认证状态（给 /api/auth/status 和 websocket 用）
   */
  getStatus(): AuthStatus {
    const settings = this.readSettings();
    const runtimeBackend = this.inferRuntimeBackend(settings);

    if (runtimeBackend === 'codex-subscription') {
      const codexConfig = codexAuthManager.getAuthConfig();
      if (codexConfig?.accessToken || codexConfig?.apiKey || codexConfig?.authMethod === 'api_key') {
        return { authenticated: true, type: 'oauth', provider: 'codex', runtimeBackend };
      }
    }

    // apiKey 优先检查
    if (settings.apiKey && settings.authPriority !== 'oauth') {
      return { authenticated: true, type: 'api_key', provider: this.getProvider(), runtimeBackend };
    }

    // OAuth 检查
    const oauthConfig = oauthManager.getOAuthConfig();
    if (oauthConfig?.accessToken) {
      return { authenticated: true, type: 'oauth', provider: this.getProvider(), runtimeBackend };
    }

    // auto 模式回退到 apiKey
    if (settings.apiKey) {
      return { authenticated: true, type: 'api_key', provider: this.getProvider(), runtimeBackend };
    }

    return { authenticated: false, type: 'none', provider: 'anthropic', runtimeBackend };
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
    if (this.getRuntimeBackend() === 'codex-subscription') {
      const codexStatus = this.getCodexStatus();
      if (!codexStatus.authenticated) {
        return { authenticated: false };
      }
      return {
        authenticated: true,
        displayName: codexStatus.displayName,
        subscriptionType: 'chatgpt',
        expiresAt: codexStatus.expiresAt,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
      };
    }

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
    const runtimeBackend = this.inferRuntimeBackend(settings);

    if (runtimeBackend === 'codex-subscription') {
      const codexConfig = codexAuthManager.getAuthConfig();
      if (codexConfig?.accessToken) {
        const isExpired = codexConfig.expiresAt ? Date.now() > codexConfig.expiresAt : false;
        return {
          type: 'oauth',
          valid: !isExpired,
          expiresAt: codexConfig.expiresAt,
          scope: ['openid', 'profile', 'email', 'offline_access'],
        };
      }
      if (codexConfig?.apiKey || codexConfig?.authMethod === 'api_key') {
        return {
          type: 'api_key',
          valid: true,
        };
      }
      return { type: 'none', valid: false };
    }

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
   * 保存 API Key 并将认证优先级设为 apiKey
   */
  saveApiKeyLogin(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    try {
      configManager.set('apiKey', key);
      configManager.set('authPriority', 'apiKey');
      configManager.set('runtimeBackend', 'claude-compatible-api');
      configManager.set('runtimeProvider', 'anthropic');
      return true;
    } catch (error) {
      console.error('[WebAuth] Failed to save API Key login:', error);
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
    codexAuthManager.clearAuthConfig();
    configManager.set('runtimeBackend', 'claude-subscription');
    configManager.set('runtimeProvider', 'anthropic');
  }

  async activateCodexLogin(config?: Partial<CodexAuthConfig>): Promise<void> {
    if (config) {
      await codexAuthManager.saveAuthConfig(config);
    }
    configManager.set('runtimeBackend', 'codex-subscription');
    configManager.set('runtimeProvider', 'codex');
    configManager.set('authPriority', 'oauth');
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
    return this.getStoredModelForBackend(this.getRuntimeBackend());
  }

  getCodexModelName(): string | undefined {
    const customModel = this.getStoredModelForBackend(this.getRuntimeBackend());
    return isCodexCompatibleModel(customModel) ? customModel : undefined;
  }

  getCodexBaseUrl(settings: WebUiSettings = this.readSettings()): string {
    const envBaseUrl = process.env.OPENAI_CODEX_BASE_URL?.trim();
    if (envBaseUrl) {
      return envBaseUrl.replace(/\/+$/, '');
    }

    const codexConfig = codexAuthManager.getAuthConfig();
    const usesApiKey = !codexConfig?.accessToken && !!(codexConfig?.apiKey || codexConfig?.authMethod === 'api_key');
    const configuredBaseUrl = settings.apiBaseUrl?.trim();
    const isSupportedConfiguredBaseUrl = configuredBaseUrl
      && (usesApiKey
        ? isCodexApiKeyBaseUrlCandidate(configuredBaseUrl)
        : isCodexChatGptBaseUrlCandidate(configuredBaseUrl));
    if (configuredBaseUrl && isSupportedConfiguredBaseUrl) {
      return configuredBaseUrl.replace(/\/+$/, '');
    }

    return getDefaultBaseUrlForRuntimeBackend('codex-subscription', {
      useApiKey: usesApiKey,
    });
  }

  getRuntimeBackend(): WebRuntimeBackend {
    return this.inferRuntimeBackend(this.readSettings());
  }

  getRuntimeProvider(): WebRuntimeProvider {
    const runtimeBackend = this.getRuntimeBackend();
    const runtimeModel = this.getStoredModelForBackend(runtimeBackend);
    return getProviderForRuntimeBackend(runtimeBackend, runtimeModel);
  }

  getDefaultModelByBackend(): Partial<Record<WebRuntimeBackend, string>> {
    return this.getNormalizedModelMap();
  }

  getCustomModelCatalogByBackend(): Partial<Record<WebRuntimeBackend, string[]>> {
    return this.readSettings().customModelCatalogByBackend || {};
  }

  /**
   * 获取认证提供商
   */
  getProvider(): string {
    const runtimeBackend = this.getRuntimeBackend();
    if (runtimeBackend === 'codex-subscription') {
      return 'codex';
    }
    if (runtimeBackend === 'axon-cloud') {
      return 'axon-cloud';
    }
    if (runtimeBackend === 'claude-subscription') {
      return 'anthropic';
    }
    if (runtimeBackend === 'claude-compatible-api') {
      const apiProvider = configManager.get('apiProvider');
      if (apiProvider === 'bedrock' || apiProvider === 'vertex' || apiProvider === 'anthropic') {
        return apiProvider;
      }
      return 'anthropic';
    }
    if (runtimeBackend === 'openai-compatible-api') {
      return 'openai-compatible';
    }
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

  private getCodexCredentials(): { apiKey?: string; authToken?: string; accountId?: string } {
    const codexConfig = codexAuthManager.getAuthConfig();
    if (!codexConfig) return {};
    if (codexConfig.accessToken) {
      return {
        authToken: codexConfig.accessToken,
        accountId: codexConfig.accountId,
      };
    }
    if (codexConfig.apiKey) {
      return {
        apiKey: codexConfig.apiKey,
      };
    }
    return {};
  }

  getCodexStatus(): {
    authenticated: boolean;
    displayName?: string;
    email?: string;
    accountId?: string;
    expiresAt?: number;
  } {
    const config = codexAuthManager.getAuthConfig();
    if (!config?.accessToken && !config?.apiKey) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      displayName: config.displayName || config.email || (config.apiKey ? 'API Key' : undefined),
      email: config.email,
      accountId: config.accountId,
      expiresAt: config.expiresAt,
    };
  }
}

// 导出单例
export const webAuth = new WebAuthProvider();
