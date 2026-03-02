/**
 * OAuth 管理器
 * 完全基于 Anthropic 官方 CLI 的 OAuth 实现
 * 提供登录、token 刷新、用户信息获取等功能
 */

import axios, { type AxiosInstance } from 'axios';
import { configManager } from '../../config/index.js';
import type { OAuthConfig, OAuthTokenResponse, UserRoles, SubscriptionInfo } from '../shared/types.js';

/**
 * OAuth 常量（从官方源码提取）
 */
export const OAUTH_CONSTANTS = {
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  SCOPES: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code', 'user:mcp_servers'],

  // 生产环境 URLs
  CONSOLE_AUTHORIZE_URL: 'https://platform.claude.com/oauth/authorize',
  CLAUDE_AI_AUTHORIZE_URL: 'https://claude.ai/oauth/authorize',
  TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
  API_KEY_URL: 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
  ROLES_URL: 'https://api.anthropic.com/api/oauth/claude_cli/roles',
  CONSOLE_SUCCESS_URL: 'https://platform.claude.com/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dclaude-code',
  CLAUDEAI_SUCCESS_URL: 'https://platform.claude.com/oauth/code/success?app=claude-code',
  CALLBACK_URL: 'https://platform.claude.com/oauth/code/callback',

  // 本地开发 URLs（用于测试）
  DEV_AUTHORIZE_URL: 'http://localhost:3000/oauth/authorize',
  DEV_TOKEN_URL: 'http://localhost:3000/v1/oauth/token',
  DEV_API_KEY_URL: 'http://localhost:3000/api/oauth/claude_cli/create_api_key',
  DEV_ROLES_URL: 'http://localhost:3000/api/oauth/claude_cli/roles',
};

/**
 * OAuth 管理器类
 */
export class OAuthManager {
  private httpClient: AxiosInstance;
  private isDev: boolean = false;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 检测是否为开发环境
    this.isDev = process.env.NODE_ENV === 'development' || process.env.OAUTH_DEV_MODE === 'true';
  }

  /**
   * 获取当前使用的 OAuth URLs
   */
  private getUrls() {
    if (this.isDev) {
      return {
        authorize: OAUTH_CONSTANTS.DEV_AUTHORIZE_URL,
        token: OAUTH_CONSTANTS.DEV_TOKEN_URL,
        apiKey: OAUTH_CONSTANTS.DEV_API_KEY_URL,
        roles: OAUTH_CONSTANTS.DEV_ROLES_URL,
      };
    }
    return {
      authorize: OAUTH_CONSTANTS.CONSOLE_AUTHORIZE_URL,
      token: OAUTH_CONSTANTS.TOKEN_URL,
      apiKey: OAUTH_CONSTANTS.API_KEY_URL,
      roles: OAUTH_CONSTANTS.ROLES_URL,
    };
  }

  /**
   * 生成 OAuth 登录 URL
   * @param redirectUri - 回调 URI
   * @param state - 状态参数（用于防止 CSRF）
   */
  generateAuthUrl(redirectUri: string, state?: string): string {
    const urls = this.getUrls();
    const params = new URLSearchParams({
      client_id: OAUTH_CONSTANTS.CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_CONSTANTS.SCOPES.join(' '),
    });

    if (state) {
      params.append('state', state);
    }

    return `${urls.authorize}?${params.toString()}`;
  }

  /**
   * 使用授权码交换 access token
   * @param code - OAuth 授权码
   * @param redirectUri - 回调 URI（必须与生成授权 URL 时一致）
   */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
    const urls = this.getUrls();

    try {
      const response = await this.httpClient.post(urls.token, {
        grant_type: 'authorization_code',
        code,
        client_id: OAUTH_CONSTANTS.CLIENT_ID,
        redirect_uri: redirectUri,
      });

      if (response.status !== 200) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const data = response.data;
      const { access_token, refresh_token, expires_in, scope } = data;

      const expiresAt = Date.now() + expires_in * 1000;
      const scopes = this.parseScopes(scope);

      // 获取用户角色和订阅信息
      const userInfo = await this.fetchUserInfo(access_token);

      // 保存到配置
      await this.saveOAuthConfig({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        scopes,
        ...userInfo,
      });

      console.log('[OAuthManager] Token exchange successful');

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        scopes,
        subscriptionType: userInfo.subscriptionType,
        rateLimitTier: userInfo.rateLimitTier,
      };
    } catch (error: any) {
      console.error('[OAuthManager] Token exchange failed:', error.message);
      throw new Error(`OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * 刷新 access token（完全基于官方实现）
   * @param refreshToken - 刷新令牌
   */
  async refreshToken(refreshToken?: string): Promise<OAuthTokenResponse> {
    const urls = this.getUrls();

    // 如果没有提供 refreshToken，从配置中获取
    if (!refreshToken) {
      const config = this.getOAuthConfig();
      refreshToken = config?.refreshToken;
    }

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      console.log('[OAuthManager] Starting OAuth token refresh...');

      const requestBody = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CONSTANTS.CLIENT_ID,
        scope: OAUTH_CONSTANTS.SCOPES.join(' '),
      };

      const response = await this.httpClient.post(urls.token, requestBody, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status !== 200) {
        throw new Error(`Token refresh failed: ${response.statusText}`);
      }

      const data = response.data;
      const {
        access_token: accessToken,
        refresh_token: newRefreshToken = refreshToken, // 如果服务器没返回新的，使用旧的
        expires_in: expiresIn,
      } = data;

      const expiresAt = Date.now() + expiresIn * 1000;
      const scopes = this.parseScopes(data.scope);

      console.log('[OAuthManager] Token refresh successful');

      // 获取更新的用户信息
      const userInfo = await this.fetchUserInfo(accessToken);

      // 保存更新后的配置
      await this.saveOAuthConfig({
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
        scopes,
        ...userInfo,
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
        scopes,
        subscriptionType: userInfo.subscriptionType,
        rateLimitTier: userInfo.rateLimitTier,
      };
    } catch (error: any) {
      console.error('[OAuthManager] Token refresh failed:', error.message);

      // 注意：刷新失败不应清除整个 oauthAccount（包括 refreshToken）
      // 只清除已过期的 accessToken，保留 refreshToken 以便下次重试
      // 之前的实现（clearOAuthConfig）会把 refreshToken 也删掉，导致用户必须重新登录
      try {
        const currentConfig = this.getOAuthConfig();
        if (currentConfig?.refreshToken) {
          // 只清除 accessToken 和 expiresAt，保留其他信息（特别是 refreshToken）
          await this.saveOAuthConfig({
            accessToken: '',
            expiresAt: 0,
          });
          console.log('[OAuthManager] Cleared expired accessToken, keeping refreshToken for next refresh');
        } else {
          // 没有 refreshToken，彻底清除
          this.clearOAuthConfig();
        }
      } catch {
        // 保存失败，忽略
      }

      throw new Error(`OAuth token refresh failed: ${error.message}`);
    }
  }

  /**
   * 获取用户角色和订阅信息（基于官方实现）
   * @param accessToken - 访问令牌
   */
  private async fetchUserInfo(accessToken: string): Promise<SubscriptionInfo> {
    const urls = this.getUrls();

    try {
      const response = await this.httpClient.get(urls.roles, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch user roles: ${response.statusText}`);
      }

      const data = response.data;

      return {
        subscriptionType: data.subscription_type || 'free',
        rateLimitTier: data.rate_limit_tier || 'standard',
        organizationRole: data.organization_role,
        workspaceRole: data.workspace_role,
        organizationName: data.organization_name,
        displayName: data.display_name,
        hasExtraUsageEnabled: data.has_extra_usage_enabled,
      };
    } catch (error: any) {
      console.warn('[OAuthManager] Failed to get user info, using defaults:', error.message);

      // 返回默认值
      return {
        subscriptionType: 'free',
        rateLimitTier: 'standard',
      };
    }
  }

  /**
   * 检查 token 是否过期
   */
  isTokenExpired(): boolean {
    const config = this.getOAuthConfig();
    if (!config || !config.expiresAt) {
      return true;
    }

    // 提前 5 分钟认为 token 过期（留出刷新时间）
    const bufferTime = 5 * 60 * 1000;
    return Date.now() > (config.expiresAt - bufferTime);
  }

  /**
   * 获取有效的 access token（自动刷新）
   */
  async getValidAccessToken(): Promise<string | null> {
    const config = this.getOAuthConfig();

    if (!config) {
      return null;
    }

    // 如果 token 未过期，直接返回
    if (!this.isTokenExpired()) {
      return config.accessToken;
    }

    // token 已过期，尝试刷新
    try {
      const refreshed = await this.refreshToken(config.refreshToken);
      return refreshed.accessToken;
    } catch (error) {
      console.error('[OAuthManager] Failed to get valid token:', error);
      return null;
    }
  }

  /**
   * 获取 OAuth 配置
   */
  getOAuthConfig(): OAuthConfig | null {
    try {
      const config = configManager.getAll();

      // 检查是否有 OAuth 配置
      if (config.oauthAccount && typeof config.oauthAccount === 'object') {
        const oauthAccount = config.oauthAccount as any;
        return {
          accessToken: oauthAccount.accessToken,
          refreshToken: oauthAccount.refreshToken,
          expiresAt: oauthAccount.expiresAt,
          scopes: oauthAccount.scopes || [],
          subscriptionType: oauthAccount.subscriptionType,
          rateLimitTier: oauthAccount.rateLimitTier,
          organizationRole: oauthAccount.organizationRole,
          workspaceRole: oauthAccount.workspaceRole,
          organizationName: oauthAccount.organizationName,
          displayName: oauthAccount.displayName,
          hasExtraUsageEnabled: oauthAccount.hasExtraUsageEnabled,
          oauthApiKey: oauthAccount.oauthApiKey,
        };
      }

      return null;
    } catch (error) {
      console.error('[OAuthManager] Failed to get OAuth config:', error);
      return null;
    }
  }

  /**
   * 保存 OAuth 配置
   */
  async saveOAuthConfig(config: Partial<OAuthConfig>): Promise<void> {
    try {
      const currentConfig = configManager.getAll();
      const existingOAuthAccount = (currentConfig.oauthAccount || {}) as any;

      configManager.set('oauthAccount', {
        ...existingOAuthAccount,
        ...config,
      });

      console.log('[OAuthManager] OAuth config saved');
    } catch (error) {
      console.error('[OAuthManager] Failed to save OAuth config:', error);
      throw error;
    }
  }

  /**
   * 清除 OAuth 配置
   */
  clearOAuthConfig(): void {
    try {
      configManager.set('oauthAccount', undefined as any);
      console.log('[OAuthManager] OAuth config cleared');
    } catch (error) {
      console.error('[OAuthManager] Failed to clear OAuth config:', error);
    }
  }

  /**
   * 解析 scope 字符串
   */
  private parseScopes(scope: string | string[]): string[] {
    if (Array.isArray(scope)) {
      return scope;
    }
    if (typeof scope === 'string') {
      return scope.split(' ').filter(s => s.length > 0);
    }
    return [];
  }

  /**
   * 登出（清除所有认证信息）
   */
  logout(): void {
    this.clearOAuthConfig();
    console.log('[OAuthManager] User logged out');
  }
}

// 导出单例
export const oauthManager = new OAuthManager();
