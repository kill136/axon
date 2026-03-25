import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockGetBalance = vi.fn();
const mockSendVerificationCode = vi.fn();
const mockGetTopupInfo = vi.fn();
const mockCreateCreemCheckout = vi.fn();
const mockCreateEpayCheckout = vi.fn();
const mockUpdateApiConfig = vi.fn();
const mockIsAxonCloudUser = vi.fn();
const mockGetCredentials = vi.fn();

vi.mock('../../../src/web/server/services/axon-cloud-service.js', () => ({
  axonCloudService: {
    login: (...args: any[]) => mockLogin(...args),
    register: (...args: any[]) => mockRegister(...args),
    getBalance: (...args: any[]) => mockGetBalance(...args),
    sendVerificationCode: (...args: any[]) => mockSendVerificationCode(...args),
    getTopupInfo: (...args: any[]) => mockGetTopupInfo(...args),
    createCreemCheckout: (...args: any[]) => mockCreateCreemCheckout(...args),
    createEpayCheckout: (...args: any[]) => mockCreateEpayCheckout(...args),
  },
}));

vi.mock('../../../src/web/server/services/config-service.js', () => ({
  webConfigService: {
    updateApiConfig: (...args: any[]) => mockUpdateApiConfig(...args),
  },
}));

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: {
    isAxonCloudUser: (...args: any[]) => mockIsAxonCloudUser(...args),
    getCredentials: (...args: any[]) => mockGetCredentials(...args),
  },
}));

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    redirectedTo: undefined as string | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      if (typeof statusOrUrl === 'number') {
        this.statusCode = statusOrUrl;
        this.redirectedTo = maybeUrl;
      } else {
        this.statusCode = 302;
        this.redirectedTo = statusOrUrl;
      }
      return this;
    },
  };
}

type RouteHandler = (req: any, res: any) => Promise<void>;

async function loadRouteHandlers() {
  vi.resetModules();
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as any);

  const module = await import('../../../src/web/server/routes/axon-cloud.js');
  const router = module.default as any;

  const getHandler = (path: string, method: 'post' | 'get'): RouteHandler => {
    const layer = router.stack.find((entry: any) =>
      entry.route?.path === path && entry.route?.methods?.[method]
    );

    expect(layer, `${method.toUpperCase()} ${path} route should exist`).toBeTruthy();
    return layer.route.stack[0].handle as RouteHandler;
  };

  return {
    login: getHandler('/login', 'post'),
    register: getHandler('/register', 'post'),
    verification: getHandler('/verification', 'get'),
    topupInfo: getHandler('/topup/info', 'get'),
    topupPage: getHandler('/topup', 'get'),
    topupCheckout: getHandler('/topup/checkout', 'post'),
  };
}

async function loginAxonCloud(loginHandler: RouteHandler) {
  const res = createResponseRecorder();

  await loginHandler({
    body: {
      username: 'cloud-user',
      password: 'secret',
    },
  }, res);

  expect(res.statusCode).toBe(200);
  return res;
}

describe('axon cloud routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateApiConfig.mockResolvedValue(true);
    mockIsAxonCloudUser.mockReturnValue(true);
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-axon',
      baseUrl: 'https://newapi.example.com',
    });
    mockCreateEpayCheckout.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should switch runtime backend to axon-cloud after login succeeds', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });

    const { login } = await loadRouteHandlers();
    const res = createResponseRecorder();

    await login({
      body: {
        username: 'cloud-user',
        password: 'secret',
      },
    }, res);

    expect(mockUpdateApiConfig).toHaveBeenCalledWith({
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      authPriority: 'apiKey',
      runtimeBackend: 'axon-cloud',
      customModelName: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      username: 'cloud-user',
      quota: 12,
    });
  });

  it('should return requiresLogin when registration succeeds without auto login session', async () => {
    mockRegister.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 0,
      apiKey: '',
      apiBaseUrl: 'https://newapi.example.com',
      requiresLogin: true,
      message: 'Registration successful, please login',
    });

    const { register } = await loadRouteHandlers();
    const res = createResponseRecorder();

    await register({
      body: {
        username: 'cloud-user',
        password: 'secret',
        email: 'user@example.com',
        verificationCode: '123456',
      },
    }, res);

    expect(mockRegister).toHaveBeenCalledWith({
      username: 'cloud-user',
      password: 'secret',
      email: 'user@example.com',
      verificationCode: '123456',
    });
    expect(mockUpdateApiConfig).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      username: 'cloud-user',
      quota: 0,
      requiresLogin: true,
      message: 'Registration successful, please login',
      apiKey: undefined,
    });
  });

  it('should send an axon cloud email verification code', async () => {
    mockSendVerificationCode.mockResolvedValue(undefined);

    const routes = await loadRouteHandlers();
    const res = createResponseRecorder();

    await routes.verification({
      query: {
        email: 'user@example.com',
      },
    }, res);

    expect(mockSendVerificationCode).toHaveBeenCalledWith('user@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('should expose Creem top-up info for the current Axon Cloud session', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockGetTopupInfo.mockResolvedValue({
      enableCreemTopup: true,
      creemProducts: [
        {
          productId: 'creem-pro-10',
          name: 'Starter Pack',
          price: 10,
          currency: 'USD',
        },
      ],
      enableOnlineTopup: true,
      payMethods: [
        { type: 'alipay', name: '支付宝', minTopup: 10 },
        { type: 'wxpay', name: '微信支付', minTopup: 10 },
      ],
      minTopup: 10,
      amountOptions: [10, 20, 50],
    });

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupInfo({ query: {} }, res);

    expect(mockGetTopupInfo).toHaveBeenCalledWith('session-token', 'user-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      enableCreemTopup: true,
      creemProducts: [
        {
          productId: 'creem-pro-10',
          name: 'Starter Pack',
          price: 10,
          currency: 'USD',
        },
      ],
      enableOnlineTopup: true,
      payMethods: [
        { type: 'alipay', name: '支付宝', minTopup: 10 },
        { type: 'wxpay', name: '微信支付', minTopup: 10 },
      ],
      minTopup: 10,
      amountOptions: [10, 20, 50],
    });
  });

  it('should reuse the latest session when the configured API key is stale', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockGetCredentials.mockReturnValue({
      apiKey: 'stale-key',
      baseUrl: 'https://newapi.example.com',
    });
    mockGetTopupInfo.mockResolvedValue({
      enableCreemTopup: true,
      creemProducts: [],
      enableOnlineTopup: true,
      payMethods: [
        { type: 'alipay', name: '支付宝', minTopup: 10 },
      ],
      minTopup: 10,
      amountOptions: [10, 20],
    });

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupPage({ query: {} }, res);

    expect(mockGetTopupInfo).toHaveBeenCalledWith('session-token', 'user-1');
    expect(res.statusCode).toBe(200);
  });

  it('should render a browser top-up bridge page for the current Axon Cloud session', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockGetTopupInfo.mockResolvedValue({
      enableCreemTopup: true,
      creemProducts: [
        {
          productId: 'creem-pro-10',
          name: 'Starter Pack',
          price: 10,
          currency: 'USD',
          bonus: 2,
        },
      ],
      enableOnlineTopup: true,
      payMethods: [
        { type: 'alipay', name: '支付宝', minTopup: 10 },
      ],
      minTopup: 10,
      amountOptions: [10, 20, 50],
    });

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupPage({ query: {} }, res);

    expect(mockGetTopupInfo).toHaveBeenCalledWith('session-token', 'user-1');
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('/api/axon-cloud/topup/checkout');
    expect(String(res.body)).toContain('Starter Pack');
    expect(String(res.body)).toContain('creem-pro-10');
    expect(String(res.body)).toContain('支付宝');
    expect(String(res.body)).toContain('paymentMethod');
    expect(String(res.body)).toContain('amount');
    expect(String(res.body)).toContain('data-amount-preset="10"');
    expect(String(res.body)).toContain('querySelector(\'input[name="amount"]\')');
  });

  it('should redirect top-up checkout requests to the returned Creem checkout URL', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockCreateCreemCheckout.mockResolvedValue('https://creem.io/checkout/session-1');

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupCheckout({
      body: {
        productId: 'creem-pro-10',
      },
    }, res);

    expect(mockCreateCreemCheckout).toHaveBeenCalledWith('session-token', 'user-1', 'creem-pro-10');
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('https://creem.io/checkout/session-1');
  });

  it('should accept array-form amount values from browser form posts', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockCreateEpayCheckout.mockResolvedValue('https://pay.example.com/order/2');

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupCheckout({
      body: {
        provider: 'epay',
        paymentMethod: 'alipay',
        amount: ['', '20'],
      },
    }, res);

    expect(mockCreateEpayCheckout).toHaveBeenCalledWith('session-token', 'user-1', 20, 'alipay');
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('https://pay.example.com/order/2');
  });

  it('should redirect epay top-up checkout requests to the returned payment URL', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      username: 'cloud-user',
      quota: 12,
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      session: {
        accessToken: 'session-token',
        userId: 'user-1',
      },
    });
    mockCreateEpayCheckout.mockResolvedValue('https://pay.example.com/order/1');

    const routes = await loadRouteHandlers();
    await loginAxonCloud(routes.login);

    const res = createResponseRecorder();
    await routes.topupCheckout({
      body: {
        provider: 'epay',
        paymentMethod: 'alipay',
        amount: '20',
      },
    }, res);

    expect(mockCreateEpayCheckout).toHaveBeenCalledWith('session-token', 'user-1', 20, 'alipay');
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('https://pay.example.com/order/1');
  });
});
