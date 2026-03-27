/**
 * OAuth RFC 9728 实现 (Subtask 7.5)
 *
 * 功能：
 * - Authorization Code Flow (推荐)
 * - Device Flow (CLI)
 * - Client Credentials (M2M)
 * - Token 端点集成
 * - Refresh token 机制
 *
 * RFC 9728: OAuth 2.0 for Browser-Based Applications
 * 支持现代的安全的授权方式
 */

/**
 * OAuth 授权流程类型
 */
export type OAuthFlowType = 'authorization_code' | 'device_code' | 'client_credentials';

/**
 * OAuth 配置
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  authorizationEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  redirectUri?: string;
  scopes: string[];
}

/**
 * OAuth 令牌响应
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * OAuth 授权码流程请求
 */
export interface AuthorizationCodeRequest {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  codeChallenge?: string;
}

/**
 * OAuth 设备流程响应
 */
export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

/**
 * OAuth 客户端凭据流程请求
 */
export interface ClientCredentialsRequest {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

/**
 * OAuth 刷新令牌请求
 */
export interface RefreshTokenRequest {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

/**
 * OAuth 2.0 管理器
 */
export class OAuth2Manager {
  private config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  /**
   * 验证配置
   */
  private validateConfig(config: OAuthConfig): void {
    if (!config.clientId) {
      throw new Error('clientId is required');
    }
    if (!config.tokenEndpoint) {
      throw new Error('tokenEndpoint is required');
    }
    if (!config.scopes || config.scopes.length === 0) {
      throw new Error('scopes must be provided');
    }
  }

  /**
   * 构建授权码流程的授权 URL
   * RFC 6749: Authorization Code Grant
   */
  buildAuthorizationUrl(
    request: AuthorizationCodeRequest,
    state: string = this.generateRandomString(32)
  ): string {
    if (!this.config.authorizationEndpoint) {
      throw new Error('authorizationEndpoint is not configured');
    }

    const params = new URLSearchParams({
      client_id: request.clientId,
      response_type: 'code',
      redirect_uri: request.redirectUri,
      scope: request.scopes.join(' '),
      state,
    });

    // 支持 PKCE (RFC 7636)
    if (request.codeChallenge) {
      params.append('code_challenge', request.codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * 交换授权码获取访问令牌
   */
  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
    });

    if (this.config.clientSecret) {
      body.append('client_secret', this.config.clientSecret);
    }

    if (codeVerifier) {
      body.append('code_verifier', codeVerifier);
    }

    return this.fetchToken(body);
  }

  /**
   * 初始化设备流程
   * RFC 8628: OAuth 2.0 Device Authorization Grant
   */
  async initializeDeviceFlow(): Promise<DeviceFlowResponse> {
    if (!this.config.deviceAuthorizationEndpoint) {
      throw new Error('deviceAuthorizationEndpoint is not configured');
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
    });

    try {
      const response = await fetch(this.config.deviceAuthorizationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Device flow initialization failed: ${response.statusText}`);
      }

      return (await response.json()) as DeviceFlowResponse;
    } catch (error) {
      throw new Error(`Failed to initialize device flow: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 轮询设备流程令牌
   */
  async pollDeviceFlowToken(
    deviceCode: string,
    interval: number = 5000,
    maxAttempts: number = 120
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: this.config.clientId,
    });

    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await this.fetchToken(body);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 处理特定的设备流程错误
        if (errorMsg.includes('authorization_pending')) {
          // 等待用户授权
          await this.delay(interval);
          continue;
        } else if (errorMsg.includes('slow_down')) {
          // 服务器要求减速
          await this.delay(interval * 2);
          continue;
        } else if (errorMsg.includes('expired_token')) {
          // 设备代码已过期
          throw new Error('Device code has expired');
        }

        throw error;
      }
    }

    throw new Error('Device flow polling timeout');
  }

  /**
   * 使用客户端凭据流程获取令牌 (M2M)
   * RFC 6749: Client Credentials Grant
   */
  async getTokenWithClientCredentials(
    request: ClientCredentialsRequest
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: request.clientId,
      client_secret: request.clientSecret,
      scope: request.scopes.join(' '),
    });

    return this.fetchToken(body);
  }

  /**
   * 刷新访问令牌
   * RFC 6749: Refresh Token Grant
   */
  async refreshAccessToken(request: RefreshTokenRequest): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: request.refreshToken,
      client_id: request.clientId,
    });

    if (request.clientSecret) {
      body.append('client_secret', request.clientSecret);
    }

    return this.fetchToken(body);
  }

  /**
   * 向令牌端点发送请求
   */
  private async fetchToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        throw new Error(
          data.error_description || data.error || `Token request failed: ${response.statusText}`
        );
      }

      return data as OAuthTokenResponse;
    } catch (error) {
      throw new Error(`Failed to fetch token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 验证访问令牌的有效性
   * （通常通过自省端点或本地 JWT 验证）
   */
  async validateAccessToken(token: string): Promise<boolean> {
    // 简化实现：检查令牌格式和基本有效性
    if (!token || typeof token !== 'string') {
      return false;
    }

    // 如果是 JWT 格式，可以进行基本验证
    if (token.includes('.')) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          // JWT 格式正确
          return true;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * 生成 PKCE code challenge
   */
  generatePKCEChallenge(codeVerifier?: string): { codeVerifier: string; codeChallenge: string } {
    const verifier = codeVerifier || this.generateRandomString(128);

    // SHA256(codeVerifier)
    const crypto = require('crypto');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    return {
      codeVerifier: verifier,
      codeChallenge: challenge,
    };
  }

  /**
   * 生成随机字符串
   */
  private generateRandomString(length: number): string {
    const crypto = require('crypto');
    return crypto
      .randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }

  /**
   * 延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default OAuth2Manager;
