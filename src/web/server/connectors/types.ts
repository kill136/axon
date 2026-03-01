/**
 * OAuth Connector 系统类型定义
 */

// ConnectorProvider: 预定义连接器模板
export interface ConnectorProvider {
  id: string;              // 'github', 'gmail', 'google-calendar', 'google-drive'
  name: string;            // 显示名
  category: 'web' | 'google' | 'microsoft' | 'custom';
  description: string;     // 连接后能做什么
  icon: string;            // 图标标识符（前端用于匹配 SVG）
  oauth: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    scopes: string[];
    responseType?: string;  // 默认 'code'
    grantType?: string;     // 默认 'authorization_code'
  };
}

// ConnectorTokenData: 存储在 settings.json 中的 token 数据
export interface ConnectorTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  connectedAt: number;
  userInfo?: Record<string, any>;
}

// ConnectorClientConfig: 用户在设置中配置的 OAuth 凭证
export interface ConnectorClientConfig {
  clientId: string;
  clientSecret: string;
}

// ConnectorStatus: API 返回给前端的连接器状态
export interface ConnectorStatus {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: 'connected' | 'not_connected';
  configured: boolean;     // 是否已配置 clientId/clientSecret
  configureHint?: string;  // 未配置时的引导文案
  connectedAt?: number;
  userInfo?: Record<string, any>;
}

// OAuthState: 临时存储的 OAuth 状态（防 CSRF）
export interface OAuthState {
  connectorId: string;
  state: string;
  codeVerifier?: string;   // PKCE
  createdAt: number;
}
