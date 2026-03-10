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
  mcpServers?: Record<string, any>;
  [key: string]: any;
}

export class ConnectorManager {
  private settingsPath: string;
  private pendingStates = new Map<string, OAuthState>();
  private lastReadFailed = false; // 防止读取失败后 writeSettings 覆盖整个文件

  constructor() {
    this.settingsPath = path.join(os.homedir(), '.axon', 'settings.json');
  }

  /**
   * 读取 settings.json
   */
  private readSettings(): SettingsData {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        this.lastReadFailed = false;
        return {};
      }
      const content = fs.readFileSync(this.settingsPath, 'utf-8');
      const data = JSON.parse(content);
      this.lastReadFailed = false;
      return data;
    } catch (error) {
      console.error('[ConnectorManager] Failed to read settings:', error);
      this.lastReadFailed = true;
      return {};
    }
  }

  /**
   * 写入 settings.json
   */
  private writeSettings(data: SettingsData): void {
    // 安全检查：如果上次读取失败了，不写入，防止覆盖损坏的配置
    if (this.lastReadFailed) {
      console.error('[ConnectorManager] Refusing to write settings: last read failed, would overwrite file');
      throw new Error('Cannot write settings: settings file may be corrupted');
    }
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

      // 解析运行时 authType（双模式 provider 根据环境变量动态判断）
      const resolvedAuthType = this.resolveAuthType(provider);

      // 用 getClientConfig 方法，它会先检查环境变量再检查 settings.json
      const clientConfig = this.getClientConfig(provider.id);

      // 根据实际 authType 判断是否已配置
      let configured: boolean;
      if (resolvedAuthType === 'mcp-oauth') {
        configured = true; // mcp-remote 不需要配置
      } else if (resolvedAuthType === 'credentials') {
        // 凭据直连：有任意一个字段有值就算 configured
        configured = !!(clientConfig && Object.values(clientConfig).some(v => v && typeof v === 'string' && (v as string).trim()));
      } else {
        // OAuth：需要 clientId 和 clientSecret 都有
        configured = !!(clientConfig?.clientId && clientConfig?.clientSecret);
      }

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

      // 填充 MCP server name（如果配置了）
      if (provider.mcpServer) {
        status.mcpServerName = provider.mcpServer.serverName;
      }

      // 认证方式
      status.authType = resolvedAuthType;
      if (resolvedAuthType === 'credentials' && provider.credentials) {
        status.credentialFields = provider.credentials.fields.map(f => ({
          key: f.key, label: f.label, type: f.type,
        }));
      }

      return status;
    });
  }

  /**
   * 解析 provider 的运行时 authType
   * 双模式 provider（如 Slack 同时有 oauth 和 credentials）根据 settings.json 动态判断：
   *  - connectorClients 中有 OAuth clientId/clientSecret → 'oauth'
   *  - 否则 → 'credentials'（显示表单让用户填）
   */
  private resolveAuthType(provider: ConnectorProvider): 'oauth' | 'credentials' | 'mcp-oauth' {
    if (provider.mcpRemoteUrl) {
      return 'mcp-oauth';
    }
    // 双模式：同时有 oauth 和 credentials
    if (provider.oauth && provider.credentials) {
      const clientConfig = this.getClientConfig(provider.id);
      if (clientConfig?.clientId && clientConfig?.clientSecret) return 'oauth';
      return 'credentials';
    }
    if (provider.credentials) return 'credentials';
    return 'oauth';
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
   * 统一从 settings.json connectorClients 读取
   */
  getClientConfig(id: string): ConnectorClientConfig | null {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) return null;

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
   * 凭据直连（不走 OAuth 弹窗，如钉钉）
   * 保存凭据 → 创建 connector 记录 → 注册 MCP
   */
  directConnect(id: string, credentials: ConnectorClientConfig): string {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`Connector ${id} not found`);
    }
    if (!provider.credentials) {
      throw new Error(`Connector ${id} does not support direct connection`);
    }

    // 保存凭据到 settings.json
    this.setClientConfig(id, credentials);

    // 创建 connector token 记录（凭据直连没有真正的 access_token，存 clientId 作为标识）
    const displayName = credentials.clientId || Object.values(credentials).find(v => v) || id;
    const settings = this.readSettings();
    if (!settings.connectors) {
      settings.connectors = {};
    }
    settings.connectors[id] = {
      accessToken: String(displayName), // 占位，MCP 实际用的是环境变量
      scopes: [],
      connectedAt: Date.now(),
      userInfo: { name: `App: ${displayName}` },
    };
    this.writeSettings(settings);

    // 注册 MCP Server
    this.registerMcpInSettings(id);

    return id;
  }

  /**
   * MCP 远程 OAuth 连接（通过 mcp-remote 代理，如 Notion/Slack/Linear/Jira）
   * 无需凭据，直接注册 MCP Server。OAuth 由 mcp-remote 在首次连接时自动弹窗处理。
   */
  mcpOAuthConnect(id: string): string {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`Connector ${id} not found`);
    }
    if (!provider.mcpRemoteUrl) {
      throw new Error(`Connector ${id} does not support MCP remote OAuth`);
    }

    // 创建 connector 记录（标记为已连接，实际认证在 MCP 启动时由 mcp-remote 处理）
    const settings = this.readSettings();
    if (!settings.connectors) {
      settings.connectors = {};
    }
    settings.connectors[id] = {
      accessToken: 'mcp-remote', // 占位，实际 token 由 mcp-remote 管理
      scopes: [],
      connectedAt: Date.now(),
      userInfo: { name: provider.name },
    };
    this.writeSettings(settings);

    // 注册 MCP Server
    this.registerMcpInSettings(id);

    return id;
  }

  /**
   * 启动 OAuth 流程
   */
  startOAuth(id: string, redirectBase: string): { authUrl: string; state: string } {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);
    if (!provider) {
      throw new Error(`Connector ${id} not found`);
    }
    if (!provider.oauth) {
      throw new Error(`Connector ${id} does not support OAuth`);
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
    const params = new URLSearchParams();

    if (provider.category === 'feishu') {
      // 飞书用 app_id 参数名
      params.set('app_id', clientConfig.clientId);
      params.set('redirect_uri', redirectUri);
      params.set('state', state);
    } else if (provider.id === 'slack') {
      // Slack OAuth v2: scope 用逗号分隔，不需要 response_type
      params.set('client_id', clientConfig.clientId);
      params.set('redirect_uri', redirectUri);
      params.set('scope', provider.oauth.scopes.join(','));
      params.set('state', state);
    } else {
      params.set('client_id', clientConfig.clientId);
      params.set('redirect_uri', redirectUri);
      params.set('scope', provider.oauth.scopes.join(' '));
      params.set('state', state);
      params.set('response_type', provider.oauth.responseType || 'code');
    }

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
    const connectorData: ConnectorTokenData = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt,
      scopes: provider.oauth?.scopes || [],
      connectedAt: Date.now(),
      userInfo,
    };
    // Slack OAuth 额外存储 team_id 供 MCP 使用
    if (tokenData.teamId) {
      connectorData.teamId = tokenData.teamId;
    }
    settings.connectors[connectorId] = connectorData;
    this.writeSettings(settings);

    // Google 系列：预写 token 文件给 google-workspace-mcp 使用
    if (provider.category === 'google') {
      this.writeGoogleMcpTokenFile(connectorId);
    }

    // 注册 MCP Server 到 settings.json（如果 provider 配置了 mcpServer）
    this.registerMcpInSettings(connectorId);

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
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number; teamId?: string }> {
    const params: Record<string, string> = {
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: provider.oauth!.grantType || 'authorization_code',
    };

    let headers: Record<string, string> = {};
    let body: string;

    if (provider.id === 'github' || provider.category === 'feishu') {
      // GitHub 和飞书使用 JSON
      headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      body = JSON.stringify(params);
    } else {
      // Google / Slack 等使用 form-urlencoded
      headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      body = new URLSearchParams(params).toString();
    }

    const response = await fetch(provider.oauth!.tokenEndpoint, {
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
    console.log('[ConnectorManager] Token exchange response for', provider.id, ':', JSON.stringify(data).slice(0, 500));

    // Slack OAuth v2 返回 { ok: true, access_token, team: { id, name } }
    if (provider.id === 'slack') {
      if (!data.ok) {
        console.error('[ConnectorManager] Slack token exchange error:', data);
        throw new Error(`Slack token exchange failed: ${data.error || JSON.stringify(data)}`);
      }
      return {
        accessToken: data.access_token,
        // Slack bot token 不过期，无 refresh_token
        // 把 team_id 存到 metadata 中供 MCP 使用（通过 teamId 字段）
        teamId: data.team?.id,
      };
    }

    // 飞书 v2 OAuth (/authen/v2/oauth/token) 遵循 RFC 标准，返回扁平结构
    // 飞书 v1 API 才返回 { code: 0, data: { ... } } 嵌套结构
    // 这里智能检测：如果有 data.data.access_token 用嵌套，否则用扁平
    let tokenObj = data;
    if (provider.category === 'feishu') {
      if (data.code !== undefined && data.code !== 0) {
        console.error('[ConnectorManager] Feishu token exchange error:', data);
        throw new Error(`Feishu token exchange failed: ${data.msg || data.message || JSON.stringify(data)}`);
      }
      if (data.data?.access_token) {
        tokenObj = data.data;
      }
    }

    if (!tokenObj.access_token) {
      console.error('[ConnectorManager] No access_token in response:', data);
      throw new Error(`Token exchange failed: no access_token in response`);
    }

    const result: { accessToken: string; refreshToken?: string; expiresAt?: number } = {
      accessToken: tokenObj.access_token,
    };

    if (tokenObj.refresh_token) {
      result.refreshToken = tokenObj.refresh_token;
    }

    if (tokenObj.expires_in) {
      result.expiresAt = Date.now() + tokenObj.expires_in * 1000;
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
    } else if (provider.category === 'feishu') {
      userInfoUrl = 'https://open.feishu.cn/open-apis/authen/v2/user_info';
    } else if (provider.id === 'slack') {
      // Slack: 用 auth.test 获取 bot/team 信息
      userInfoUrl = 'https://slack.com/api/auth.test';
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

      const data = await response.json() as any;

      // 飞书的响应嵌套在 data 字段里
      if (provider.category === 'feishu') {
        return data.data || {};
      }

      // Slack auth.test 返回 { ok, team, team_id, user, user_id }
      if (provider.id === 'slack') {
        return {
          name: `${data.user} @ ${data.team}`,
          team: data.team,
          teamId: data.team_id,
        };
      }

      return data;
    } catch (error) {
      console.error('[ConnectorManager] Failed to fetch user info:', error);
      return {};
    }
  }

  /**
   * 断开连接
   */
  disconnect(id: string): void {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === id);

    const settings = this.readSettings();
    if (settings.connectors && settings.connectors[id]) {
      delete settings.connectors[id];
      this.writeSettings(settings);
    }

    // Google 系列：检查是否还有其他 Google connector 仍连接
    if (provider?.category === 'google') {
      const updatedSettings = this.readSettings();
      const hasOtherGoogle = BUILTIN_PROVIDERS.some(
        (p) => p.category === 'google' && p.id !== id && updatedSettings.connectors?.[p.id]
      );
      if (!hasOtherGoogle) {
        // 没有其他 Google connector 了，注销共享 MCP 并清理 token 文件
        this.unregisterMcpFromSettings(id);
        this.cleanGoogleMcpTokenFile();
      } else {
        // 还有其他 Google connector，更新 token 文件（移除本 connector 的 scope）
        const remaining = BUILTIN_PROVIDERS.find(
          (p) => p.category === 'google' && p.id !== id && updatedSettings.connectors?.[p.id]
        );
        if (remaining) {
          this.writeGoogleMcpTokenFile(remaining.id);
        }
      }
    } else {
      // 非 Google，直接注销 MCP
      this.unregisterMcpFromSettings(id);
    }
  }

  /**
   * 刷新 Token（如果需要）
   * GitHub OAuth token 无过期时间，直接返回 true
   * Google OAuth token 距过期 < 5 分钟时用 refreshToken 刷新
   */
  async refreshTokenIfNeeded(connectorId: string): Promise<boolean> {
    const settings = this.readSettings();
    const tokenData = settings.connectors?.[connectorId];
    if (!tokenData) return false;

    // GitHub token 无过期时间
    if (!tokenData.expiresAt) return true;

    // 检查是否需要刷新（距过期 < 5 分钟）
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (tokenData.expiresAt - now > fiveMinutes) {
      return true; // 不需要刷新
    }

    // 需要刷新
    if (!tokenData.refreshToken) {
      console.error(`[ConnectorManager] No refresh token for ${connectorId}`);
      return false;
    }

    const provider = BUILTIN_PROVIDERS.find((p) => p.id === connectorId);
    if (!provider) return false;

    const clientConfig = this.getClientConfig(connectorId);
    if (!clientConfig) return false;

    try {
      // 用 refreshToken 换取新 token
      const params: Record<string, string> = {
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: tokenData.refreshToken,
        grant_type: 'refresh_token',
      };

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      const body = new URLSearchParams(params).toString();

      const response = await fetch(provider.oauth!.tokenEndpoint, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        console.error(`[ConnectorManager] Token refresh failed for ${connectorId}:`, response.statusText);
        return false;
      }

      const data: any = await response.json();

      // 更新 token
      settings.connectors![connectorId] = {
        ...tokenData,
        accessToken: data.access_token,
        expiresAt: data.expires_in ? now + data.expires_in * 1000 : tokenData.expiresAt,
        refreshToken: data.refresh_token || tokenData.refreshToken,
      };
      this.writeSettings(settings);

      console.log(`[ConnectorManager] Token refreshed for ${connectorId}`);
      return true;
    } catch (error) {
      console.error(`[ConnectorManager] Token refresh error for ${connectorId}:`, error);
      return false;
    }
  }

  /**
   * 获取 MCP Server 配置（用于注册 MCP Server）
   */
  getMcpServerConfig(connectorId: string): { name: string; config: any } | null {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === connectorId);
    if (!provider || !provider.mcpServer) return null;

    const settings = this.readSettings();
    const tokenData = settings.connectors?.[connectorId];
    // mcp-remote 模式不需要 token（OAuth 由 mcp-remote 自己处理）
    if (!tokenData && !provider.mcpRemoteUrl) return null;

    // 构建环境变量
    const env: Record<string, string> = {};

    // 根据运行时 authType 决定环境变量来源
    const resolvedAuthType = this.resolveAuthType(provider);

    // OAuth 模式：envMapping 把 tokenData 的字段映射到环境变量
    if (resolvedAuthType === 'oauth' && tokenData) {
      for (const [envKey, tokenField] of Object.entries(provider.mcpServer.envMapping)) {
        const value = tokenData[tokenField];
        if (value) {
          env[envKey] = value;
        }
      }
      // Slack OAuth 额外传入 SLACK_TEAM_ID（从 token 交换响应中获取）
      if (provider.id === 'slack' && tokenData.teamId) {
        env['SLACK_TEAM_ID'] = tokenData.teamId;
      }
    }

    // Google 系列：传入 GOOGLE_CLIENT_ID/SECRET，token 通过文件传递
    if (provider.category === 'google') {
      const clientConfig = this.getClientConfig(connectorId);
      if (clientConfig) {
        env['GOOGLE_CLIENT_ID'] = clientConfig.clientId;
        env['GOOGLE_CLIENT_SECRET'] = clientConfig.clientSecret;
      }
    }

    // 飞书 MCP：通过命令行参数传入 app_id, app_secret, user_access_token
    let args = [...provider.mcpServer.args];
    if (provider.category === 'feishu') {
      const clientConfig = this.getClientConfig(connectorId);
      if (clientConfig) {
        args.push('-a', clientConfig.clientId, '-s', clientConfig.clientSecret);
      }
      if (tokenData.accessToken) {
        args.push('-u', tokenData.accessToken);
      }
    }

    // 凭据直连模式：通过 mcpEnvVar 字段通用映射环境变量
    if (provider.credentials) {
      const clientConfig = this.getClientConfig(connectorId);
      if (clientConfig) {
        for (const field of provider.credentials.fields) {
          if (field.mcpEnvVar) {
            const value = clientConfig[field.key] || '';
            if (value) {
              // Notion 特殊处理：OPENAPI_MCP_HEADERS 需要 JSON 格式的 Authorization header
              if (field.mcpEnvVar === 'OPENAPI_MCP_HEADERS') {
                env[field.mcpEnvVar] = JSON.stringify({
                  'Authorization': `Bearer ${value}`,
                  'Notion-Version': '2022-06-28',
                });
              } else {
                env[field.mcpEnvVar] = value;
              }
            }
          }
        }
      }
      // 钉钉默认激活所有服务
      if (provider.category === 'dingtalk' && !env['ACTIVE_PROFILES']) {
        env['ACTIVE_PROFILES'] = 'ALL';
      }
    }

    const config = {
      type: 'stdio' as const,
      command: provider.mcpServer.command,
      args,
      env,
    };

    return {
      name: provider.mcpServer.serverName,
      config,
    };
  }

  /**
   * 为 Google Workspace MCP 预写 token 文件
   * 路径: ~/.config/google-workspace-mcp/tokens.json
   * 这样 MCP 启动时直接用已有 token，不需要再次 OAuth
   */
  writeGoogleMcpTokenFile(connectorId: string): void {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === connectorId);
    if (!provider || provider.category !== 'google') return;

    const settings = this.readSettings();
    const tokenData = settings.connectors?.[connectorId];
    if (!tokenData) return;

    // 收集所有已连接 Google connector 的 scope
    const allScopes: string[] = [];
    for (const p of BUILTIN_PROVIDERS) {
      if (p.category === 'google') {
        const td = settings.connectors?.[p.id];
        if (td) {
          allScopes.push(...td.scopes);
        }
      }
    }

    const tokenFilePath = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'tokens.json');
    const tokenDir = path.dirname(tokenFilePath);

    // google-workspace-mcp 的 StoredCredentials 格式
    const storedCredentials = {
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken || undefined,
      expiry_date: tokenData.expiresAt || undefined,
      token_type: 'Bearer',
      scope: [...new Set(allScopes)].join(' '),
      created_at: new Date(tokenData.connectedAt).toISOString(),
    };

    try {
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true });
      }
      fs.writeFileSync(tokenFilePath, JSON.stringify(storedCredentials, null, 2), 'utf-8');
      console.log(`[ConnectorManager] Wrote Google MCP token file: ${tokenFilePath}`);
    } catch (error) {
      console.error('[ConnectorManager] Failed to write Google MCP token file:', error);
    }
  }

  /**
   * 清理 Google Workspace MCP token 文件
   */
  cleanGoogleMcpTokenFile(): void {
    const tokenFilePath = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'tokens.json');
    try {
      if (fs.existsSync(tokenFilePath)) {
        fs.unlinkSync(tokenFilePath);
        console.log(`[ConnectorManager] Removed Google MCP token file`);
      }
    } catch (error) {
      console.error('[ConnectorManager] Failed to remove Google MCP token file:', error);
    }
  }

  /**
   * 注册 MCP Server 到 settings.json
   * 在 handleCallback 成功后调用
   */
  registerMcpInSettings(connectorId: string): void {
    const mcpConfig = this.getMcpServerConfig(connectorId);
    if (!mcpConfig) return;

    const settings = this.readSettings();
    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }
    settings.mcpServers[mcpConfig.name] = mcpConfig.config;
    this.writeSettings(settings);

    console.log(`[ConnectorManager] Registered MCP Server: ${mcpConfig.name}`);
  }

  /**
   * 从 settings.json 中注销 MCP Server
   * 在 disconnect 时调用
   */
  unregisterMcpFromSettings(connectorId: string): void {
    const provider = BUILTIN_PROVIDERS.find((p) => p.id === connectorId);
    if (!provider || !provider.mcpServer) return;

    const settings = this.readSettings();
    if (settings.mcpServers && settings.mcpServers[provider.mcpServer.serverName]) {
      delete settings.mcpServers[provider.mcpServer.serverName];
      this.writeSettings(settings);
      console.log(`[ConnectorManager] Unregistered MCP Server: ${provider.mcpServer.serverName}`);
    }
  }
}

// 导出单例
export const connectorManager = new ConnectorManager();
