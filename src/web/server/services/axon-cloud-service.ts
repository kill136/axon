/**
 * Axon Cloud 服务
 * 封装与 NewAPI (https://api.chatbi.site/) 的交互
 *
 * 认证流程（参考 https://docs.newapi.pro/zh/docs/api/management/auth）：
 * 1. POST /api/user/login → session cookie + userId
 * 2. GET /api/user/token  (+ Cookie + New-Api-User) → access token
 * 3. 后续请求用 Authorization: Bearer {accessToken} + New-Api-User: {userId}
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
  id: number;
  key: string;
  name: string;
  status: number;
  unlimited_quota: boolean;
  remain_quota: number;
}

export interface AxonCloudTopupProduct {
  productId: string;
  name?: string;
  description?: string;
  price?: number;
  amount?: number;
  currency?: string;
  bonus?: number;
}

export interface AxonCloudTopupInfo {
  enableCreemTopup: boolean;
  creemProducts: AxonCloudTopupProduct[];
}

export interface AxonCloudSession {
  accessToken: string;
  userId: string;
}

export interface AxonCloudAuthResult {
  success: boolean;
  username: string;
  quota: number;
  apiKey: string;
  apiBaseUrl: string;
  session?: AxonCloudSession;
  error?: string;
}

export class AxonCloudService {
  private readonly NEWAPI_BASE = 'https://api.chatbi.site';
  // Anthropic SDK 会自动在 baseURL 后拼 /v1/messages，所以 baseURL 不能带 /v1
  private readonly API_BASE_URL = 'https://api.chatbi.site';

  /**
   * 用户注册，注册成功后自动登录
   */
  async register(data: RegisterRequest): Promise<AxonCloudAuthResult> {
    try {
      const res = await fetch(`${this.NEWAPI_BASE}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          email: data.email,
        }),
      });

      const result = await res.json() as any;
      if (!result.success) {
        throw new Error(result.message || 'Registration failed');
      }

      console.log('[AxonCloud] Registration successful, auto-login...');
      return await this.login({ username: data.username, password: data.password });
    } catch (error) {
      console.error('[AxonCloud] Register error:', error);
      return {
        success: false, username: '', quota: 0,
        apiKey: '', apiBaseUrl: this.API_BASE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 用户登录
   * 1. POST /api/user/login → session cookie + userId
   * 2. GET /api/user/token → access token
   * 3. 用 access token 获取用户信息、确保有 API token
   */
  async login(data: LoginRequest): Promise<AxonCloudAuthResult> {
    try {
      // 1. 登录
      const loginRes = await fetch(`${this.NEWAPI_BASE}/api/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: data.username, password: data.password }),
      });

      const loginResult = await loginRes.json() as any;
      if (!loginResult.success) {
        throw new Error(loginResult.message || 'Login failed');
      }

      const userId = String(loginResult.data.id);
      const sessionCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
      if (!sessionCookie) {
        throw new Error('No session cookie received');
      }
      console.log('[AxonCloud] Login successful, generating access token...');

      // 2. 用 session cookie 生成 access token
      const tokenRes = await fetch(`${this.NEWAPI_BASE}/api/user/token`, {
        headers: {
          'Cookie': sessionCookie,
          'New-Api-User': userId,
        },
      });
      const tokenResult = await tokenRes.json() as any;
      if (!tokenResult.success) {
        throw new Error(tokenResult.message || 'Failed to generate access token');
      }
      const accessToken = tokenResult.data as string;
      console.log('[AxonCloud] Access token obtained');

      // 3. 用 access token 获取用户信息
      const userInfo = await this.getUserInfo(accessToken, userId);

      // 4. 确保有可用的 API token
      const apiKey = await this.ensureToken(accessToken, userId);

      return {
        success: true,
        username: userInfo.username,
        quota: userInfo.quota - userInfo.usedQuota,
        apiKey,
        apiBaseUrl: this.API_BASE_URL,
        session: { accessToken, userId },
      };
    } catch (error) {
      console.error('[AxonCloud] Login error:', error);
      return {
        success: false, username: '', quota: 0,
        apiKey: '', apiBaseUrl: this.API_BASE_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 构造认证 headers
   */
  private authHeaders(accessToken: string, userId: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'New-Api-User': userId,
    };
  }

  private getResultMessage(result: any, fallback: string): string {
    if (typeof result?.message === 'string' && result.message.trim()) {
      return result.message;
    }
    if (typeof result?.error === 'string' && result.error.trim()) {
      return result.error;
    }
    return fallback;
  }

  private normalizeOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private normalizeTopupProducts(value: unknown): any[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string, userId: string): Promise<UserInfo> {
    const res = await fetch(`${this.NEWAPI_BASE}/api/user/self`, {
      headers: this.authHeaders(accessToken, userId),
    });

    const result = await res.json() as any;
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
   */
  async getTokenList(accessToken: string, userId: string): Promise<TokenInfo[]> {
    const res = await fetch(`${this.NEWAPI_BASE}/api/token/`, {
      headers: this.authHeaders(accessToken, userId),
    });

    const result = await res.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to get token list');
    }

    // NewAPI 返回分页格式: { data: { items: [...], page, total } }
    const data = result.data;
    return Array.isArray(data) ? data : (data?.items || []);
  }

  /**
   * 获取 token 的完整 key（列表里的 key 是脱敏的）
   * POST /api/token/{id}/key
   */
  async getTokenFullKey(accessToken: string, userId: string, tokenId: number): Promise<string> {
    const res = await fetch(`${this.NEWAPI_BASE}/api/token/${tokenId}/key`, {
      method: 'POST',
      headers: this.authHeaders(accessToken, userId),
    });

    const result = await res.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to get token key');
    }

    return result.data?.key || '';
  }

  /**
   * 创建新 API token，返回完整 key
   */
  async createToken(accessToken: string, userId: string, name: string = 'Axon'): Promise<string> {
    // 1. 创建 token（NewAPI 不返回 key）
    const res = await fetch(`${this.NEWAPI_BASE}/api/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(accessToken, userId),
      },
      body: JSON.stringify({ name, unlimited_quota: true }),
    });

    const result = await res.json() as any;
    if (!result.success) {
      throw new Error(result.message || 'Failed to create token');
    }

    // 2. 从列表找到刚创建的 token id
    const tokens = await this.getTokenList(accessToken, userId);
    const created = tokens.find((t: any) => t.name === name && t.status === 1);
    if (!created) {
      throw new Error('Token created but not found in list');
    }

    // 3. 用 POST /api/token/{id}/key 获取完整 key
    return await this.getTokenFullKey(accessToken, userId, created.id);
  }

  /**
   * 确保有可用的 API token（复用已有或创建新的）
   */
  async ensureToken(accessToken: string, userId: string): Promise<string> {
    const tokens = await this.getTokenList(accessToken, userId);

    // 复用已有的活跃 token（通过 id 获取完整 key）
    const activeToken = tokens.find((t: any) => t.status === 1);
    if (activeToken) {
      console.log('[AxonCloud] Retrieving existing API token key');
      return await this.getTokenFullKey(accessToken, userId, activeToken.id);
    }

    console.log('[AxonCloud] Creating new API token...');
    return await this.createToken(accessToken, userId, `Axon-${Date.now()}`);
  }

  /**
   * 获取余额
   */
  async getBalance(accessToken: string, userId: string): Promise<{ quota: number; used: number }> {
    const userInfo = await this.getUserInfo(accessToken, userId);
    return { quota: userInfo.quota, used: userInfo.usedQuota };
  }

  /**
   * 获取充值信息和可用的 Creem 套餐
   */
  async getTopupInfo(accessToken: string, userId: string): Promise<AxonCloudTopupInfo> {
    const res = await fetch(`${this.NEWAPI_BASE}/api/user/topup/info`, {
      headers: this.authHeaders(accessToken, userId),
    });

    const result = await res.json() as any;
    if (!result.success) {
      throw new Error(this.getResultMessage(result, 'Failed to get top-up info'));
    }

    const data = result.data || {};
    const rawProducts = this.normalizeTopupProducts(data.creem_products ?? data.creemProducts);

    return {
      enableCreemTopup: Boolean(data.enable_creem_topup ?? data.enableCreemTopup),
      creemProducts: rawProducts
        .map((product: any) => ({
          productId: String(product?.product_id ?? product?.productId ?? product?.id ?? '').trim(),
          name: typeof product?.name === 'string' ? product.name : undefined,
          description: typeof product?.description === 'string' ? product.description : undefined,
          price: this.normalizeOptionalNumber(product?.price),
          amount: this.normalizeOptionalNumber(product?.amount),
          currency: typeof product?.currency === 'string' ? product.currency : undefined,
          bonus: this.normalizeOptionalNumber(product?.bonus ?? product?.gift_amount ?? product?.giftAmount),
        }))
        .filter((product: AxonCloudTopupProduct) => !!product.productId),
    };
  }

  /**
   * 创建 Creem Checkout，会返回最终支付页 URL
   */
  async createCreemCheckout(accessToken: string, userId: string, productId: string): Promise<string> {
    const res = await fetch(`${this.NEWAPI_BASE}/api/user/creem/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(accessToken, userId),
      },
      body: JSON.stringify({
        product_id: productId,
        payment_method: 'creem',
      }),
    });

    const result = await res.json() as any;
    if (!result.success) {
      throw new Error(this.getResultMessage(result, 'Failed to create Creem checkout'));
    }

    const checkoutUrl = result.data?.checkout_url || result.data?.checkoutUrl;
    if (!checkoutUrl || typeof checkoutUrl !== 'string') {
      throw new Error('Creem checkout URL missing from response');
    }

    return checkoutUrl;
  }
}

export const axonCloudService = new AxonCloudService();
