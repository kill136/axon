/**
 * OAuth Connector Manager
 * 管理 OAuth 连接器的配置、认证和状态
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type {
  ConnectorProvider,
  ConnectorTokenData,
  ConnectorClientConfig,
  ConnectorStatus,
  OAuthState,
} from './types.js';
import { BUILTIN_PROVIDERS } from './providers.js';

interface SettingsData {
  connectors?: Record<string, ConnectorTokenData>;
  connectorClients?: Record<string, ConnectorClientConfig>;
  [key: string]: any;
}

export class ConnectorManager {
  private settingsPath: string;
  private pendingStates = new Map<string, OAuthState>();

  constructor() {
    this.settingsPath = path.join(os.homedir(), '.axon', 'settings.json');
  }

  /**
   * 读取 settings.json
   */
  private readSettings(): SettingsData {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        return {};
      }
      const content = fs.readFileSync(this.settingsPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[ConnectorManager] Failed to read settings:', error);
      return {};
    }
  }

  /**
   * 写入 settings.json
   */
  private writeSettings(data: SettingsData): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[ConnectorManager] Failed to write settings:', error);
      throw new Error('Failed to save connector configuration');
    }
  }

  /**
   * 清理过期的 OAuth state（超过 5 分钟）
   */
  private cleanExpiredStates(): void {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 分钟
    for (const [state, data] of this.pendingStates.entries()) {
      if (now - data.createdAt > expireTime) {
        this.pendingStates.delete(state);
      }
    }
  }

  /**
   * 列出所有连接器状态
   */
  listConnectors(): ConnectorStatus[] {
    const settings = this.readSettings();
    const connectors = settings.connectors || {};
    const clients = settings.connectorClients || {};

    return BUILTIN_PROVIDERS.map((provider) => {
      const tokenData = connectors[provider.id];
      const clientConfig = clients[provider.id];
      const configured = !!(clientConfig?.clientId && clientConfig?.clientSecret);

      const status: ConnectorStatus = {
        id: provider.id,
        name: provider.name,
        category: provider.category,
        description: provider.description,
        icon: provider.icon,
        status: tokenData ? 'connected' : 'not_connected',
        configured,
      };

      if (!configured) {
        status.configureHint = `Configure OAuth credentials to connect to ${provider.name}`;
      }

      if (tokenData) {
        status.connectedAt = tokenData.connectedAt;
        status.userInfo = tokenData.userInfo;
      }

      return status;
    });
  }

  /**
   * 获取单个连接器状态
   */
  getConnector(id: string): ConnectorStatus | null {
    const connectors = this.listConnectors();
    return connectors.find((c) => c.id === id) || null;
  }

  /**
   * 获取客户端配置
   */
  getClientConfig(id: string): ConnectorClientConfig | null {
    const settings = this.readSettings();
    const clients = settings.connectorClients || {};
    return clients[id] || null;
  }

  /**
   * 保存客户端配置
   */
  setClientConfig(id: string, config: ConnectorClientConfig): void {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`Connector ${id} not found`);
    }

    const settings = this.readSettings();
    if (!settings.connectorClients) {
      settings.connectorClients = {};
    }
    settings.connectorClients[id] = config;
    this.writeSettings(settings);
  }

  /**
   * 启动 OAuth 流程
   */
  startOAuth(id: string, redirectBase: string): { authUrl: string; state: string } {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`Connector ${id} not found`);
    }

    const clientConfig = this.getClientConfig(id);
    if (!clientConfig) {
      throw new Error(`OAuth credentials not configured for ${id}`);
    }

    // 清理过期 state
    this.cleanExpiredStates();

    // 生成随机 state
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${redirectBase}/api/connectors/callback`;

    // 存储 state
    this.pendingStates.set(state, {
      connectorId: id,
      state,
      createdAt: Date.now(),
    });

    // 构造授权 URL
    const params = new URLSearchParams({
      client_id: clientConfig.clientId,
      redirect_uri: redirectUri,
      scope: provider.oauth.scopes.join(' '),
      state,
      response_type: provider.oauth.responseType || 'code',
    });

    // Google OAuth 需要 access_type=offline 来获取 refresh token
    if (provider.category === 'google') {
      params.append('access_type', 'offline');
      params.append('prompt', 'consent');
    }

    const authUrl = `${provider.oauth.authorizationEndpoint}?${params.toString()}`;

    return { authUrl, state };
  }

  /**
   * 处理 OAuth 回调
   */
  async handleCallback(code: string, state: string, redirectBase: string): Promise<string> {
    // 验证 state
    const oauthState = this.pendingStates.get(state);
    if (!oauthState) {
      throw new Error('Invalid or expired OAuth state');
    }

    const connectorId = oauthState.connectorId;
    this.pendingStates.delete(state);

    const provider = BUILTIN_PROVIDERS.find((p) => p.id === connectorId);
    if (!provider) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    const clientConfig = this.getClientConfig(connectorId);
    if (!clientConfig) {
      throw new Error(`OAuth credentials not configured for ${connectorId}`);
    }

    const redirectUri = `${redirectBase}/api/connectors/callback`;

    // 用 code 换取 token
    const tokenData = await this.exchangeCodeForToken(provider, clientConfig, code, redirectUri);

    // 获取用户信息
    const userInfo = await this.fetchUserInfo(provider, tokenData.accessToken);

    // 保存 token 数据
    const settings = this.readSettings();
    if (!settings.connectors) {
      settings.connectors = {};
    }
    settings.connectors[connectorId] = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
      scopes: provider.oauth.scopes,
      connectedAt: Date.now(),
      userInfo,
    };
    this.writeSettings(settings);

    return connectorId;
  }

  /**
   * 用 code 换取 access token
   */
  private async exchangeCodeForToken(
    provider: ConnectorProvider,
    clientConfig: ConnectorClientConfig,
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
    const params: Record<string, string> = {
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: provider.oauth.grantType || 'authorization_code',
    };

    let headers: Record<string, string> = {};
    let body: string;

    if (provider.id === 'github') {
      // GitHub 使用 JSON
      headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      body = JSON.stringify(params);
    } else {
      // Google 使用 form-urlencoded
      headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      body = new URLSearchParams(params).toString();
    }

    const response = await fetch(provider.oauth.tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ConnectorManager] Token exchange failed:', error);
      throw new Error(`Failed to exchange code for token: ${response.statusText}`);
    }

    const data: any = await response.json();

    const result: { accessToken: string; refreshToken?: string; expiresAt?: number } = {
      accessToken: data.access_token,
    };

    if (data.refresh_token) {
      result.refreshToken = data.refresh_token;
    }

    if (data.expires_in) {
      result.expiresAt = Date.now() + data.expires_in * 1000;
    }

    return result;
  }

  /**
   * 获取用户信息
   */
  private async fetchUserInfo(
    provider: ConnectorProvider,
    accessToken: string
  ): Promise<Record<string, any>> {
    let userInfoUrl: string;

    if (provider.id === 'github') {
      userInfoUrl = 'https://api.github.com/user';
    } else if (provider.category === 'google') {
      userInfoUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';
    } else {
      return {};
    }

    try {
      const response = await fetch(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.error('[ConnectorManager] Failed to fetch user info:', response.statusText);
        return {};
      }

      return await response.json();
    } catch (error) {
      console.error('[ConnectorManager] Failed to fetch user info:', error);
      return {};
    }
  }

  /**
   * 断开连接
   */
  disconnect(id: string): void {
    const settings = this.readSettings();
    if (settings.connectors && settings.connectors[id]) {
      delete settings.connectors[id];
      this.writeSettings(settings);
    }
  }
}

// 导出单例
export const connectorManager = new ConnectorManager();
