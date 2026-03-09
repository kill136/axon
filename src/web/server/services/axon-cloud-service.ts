/**
 * Axon Cloud 服务
 * 封装与 NewAPI (https://api.chatbi.site/) 的交互
 * 提供注册、登录、token管理等功能
 */

export interface RegisterRequest {
  username: string;
  password: string;
  email: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface UserInfo {
  username: string;
  email?: string;
  quota: number;
  usedQuota: number;
  requestCount?: number;
}

export interface TokenInfo {
  key: string;
  name: string;
  status: number;
  unlimited_quota: boolean;
  remain_quota: number;
}

export interface AxonCloudAuthResult {
  success: boolean;
  username: string;
  quota: number;
  apiKey: string;
  apiBaseUrl: string;
  error?: string;
}

export class AxonCloudService {
  private readonly NEWAPI_BASE = 'https://api.chatbi.site';
  private readonly API_BASE_URL = 'https://api.chatbi.site/v1'; // OpenAI 兼容端点

  /**
   * 用户注册
   * POST /api/user/register
   * 注册成功后自动登录并创建 token
   */
  async register(data: RegisterRequest): Promise<AxonCloudAuthResult> {
    try {
      // 1. 调用注册接口
      const registerResponse = await fetch(`${this.NEWAPI_BASE}/api/user/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          email: data.email,
        }),
      });

      if (!registerResponse.ok) {
        const errorData = await registerResponse.json().catch(() => ({})) as any;
        throw new Error(errorData.message || `Registration failed: ${registerResponse.statusText}`);
      }

      const registerResult = await registerResponse.json() as any;
      if (!registerResult.success) {
        throw new Error(registerResult.message || 'Registration failed');
      }

      console.log('[AxonCloud] Registration successful, auto-login...');

      // 2. 注册成功后自动登录
      return await this.login({
        username: data.username,
        password: data.password,
      });
    } catch (error) {
      console.error('[AxonCloud] Register error:', error);
      return {
        success: false,
        username: '',
        quota: 0,
        apiKey: '',
        apiBaseUrl: this.API_BASE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 用户登录
   * POST /api/user/login
   * 登录成功后获取或创建 token
   */
  async login(data: LoginRequest): Promise<AxonCloudAuthResult> {
    try {
      // 1. 调用登录接口（获取 session cookie）
      const loginResponse = await fetch(`${this.NEWAPI_BASE}/api/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: data.username,
          password: data.password,
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json().catch(() => ({})) as any;
        throw new Error(errorData.message || `Login failed: ${loginResponse.statusText}`);
      }

      const loginResult = await loginResponse.json() as any;
      if (!loginResult.success) {
        throw new Error(loginResult.message || 'Login failed');
      }

      // 2. 从 Set-Cookie 头提取 session
      const setCookieHeader = loginResponse.headers.get('set-cookie');
      if (!setCookieHeader) {
        throw new Error('No session cookie received');
      }

      const sessionCookie = this.extractSessionCookie(setCookieHeader);
      console.log('[AxonCloud] Login successful, session obtained');

      // 3. 获取用户信息（余额等）
      const userInfo = await this.getUserInfo(sessionCookie);

      // 4. 确保有可用的 token（获取已有或创建新的）
      const apiKey = await this.ensureToken(sessionCookie);

      return {
        success: true,
        username: userInfo.username,
        quota: userInfo.quota - userInfo.usedQuota,
        apiKey,
        apiBaseUrl: this.API_BASE_URL,
      };
    } catch (error) {
      console.error('[AxonCloud] Login error:', error);
      return {
        success: false,
        username: '',
        quota: 0,
        apiKey: '',
        apiBaseUrl: this.API_BASE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取用户信息
   * GET /api/user/self
   */
  async getUserInfo(sessionCookie: string): Promise<UserInfo> {
    const response = await fetch(`${this.NEWAPI_BASE}/api/user/self`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    const result = await response.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to get user info');
    }

    return {
      username: result.data.username,
      email: result.data.email,
      quota: result.data.quota || 0,
      usedQuota: result.data.used_quota || 0,
      requestCount: result.data.request_count,
    };
  }

  /**
   * 获取 token 列表
   * GET /api/token/
   */
  async getTokenList(sessionCookie: string): Promise<TokenInfo[]> {
    const response = await fetch(`${this.NEWAPI_BASE}/api/token/`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get token list: ${response.statusText}`);
    }

    const result = await response.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to get token list');
    }

    return result.data || [];
  }

  /**
   * 创建新 token
   * POST /api/token/
   */
  async createToken(sessionCookie: string, name: string = 'Axon'): Promise<string> {
    const response = await fetch(`${this.NEWAPI_BASE}/api/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        name,
        unlimited_quota: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create token: ${response.statusText}`);
    }

    const result = await response.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to create token');
    }

    return result.data.key || result.data.token || '';
  }

  /**
   * 确保有可用的 token（获取已有或创建新的）
   * 优先使用已有的 token，如果没有则创建一个新的
   */
  async ensureToken(sessionCookie: string): Promise<string> {
    // 1. 先获取已有的 token 列表
    const tokens = await this.getTokenList(sessionCookie);

    // 2. 查找状态正常（status === 1）的 token
    const activeToken = tokens.find((t) => t.status === 1);
    if (activeToken && activeToken.key) {
      console.log('[AxonCloud] Using existing token');
      return activeToken.key;
    }

    // 3. 如果没有可用 token，创建一个新的
    console.log('[AxonCloud] Creating new token...');
    const newToken = await this.createToken(sessionCookie, `Axon-${Date.now()}`);
    return newToken;
  }

  /**
   * 从 Set-Cookie 头提取 session cookie
   * NewAPI 返回格式: "session=xxx; Path=/; HttpOnly; SameSite=Lax"
   */
  private extractSessionCookie(setCookieHeader: string): string {
    // Set-Cookie 可能包含多个 cookie，用逗号分隔
    const cookies = setCookieHeader.split(',');
    for (const cookie of cookies) {
      const parts = cookie.trim().split(';');
      const sessionPart = parts.find((p) => p.trim().startsWith('session='));
      if (sessionPart) {
        return sessionPart.trim();
      }
    }
    throw new Error('Session cookie not found in Set-Cookie header');
  }

  /**
   * 获取余额信息（供前端查询用）
   */
  async getBalance(sessionCookie: string): Promise<{ quota: number; used: number }> {
    const userInfo = await this.getUserInfo(sessionCookie);
    return {
      quota: userInfo.quota,
      used: userInfo.usedQuota,
    };
  }
}

// 单例导出
export const axonCloudService = new AxonCloudService();
