import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockUpdateApiConfig = vi.fn();
const mockIsAxonCloudUser = vi.fn();
const mockGetCredentials = vi.fn();

vi.mock('../../../src/web/server/services/axon-cloud-service.js', () => ({
  axonCloudService: {
    login: (...args: any[]) => mockLogin(...args),
    register: (...args: any[]) => mockRegister(...args),
    getBalance: vi.fn(),
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
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function loadRouteHandler(path: '/login' | '/register', method: 'post' | 'get' = 'post') {
  vi.resetModules();
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as any);
  const module = await import('../../../src/web/server/routes/axon-cloud.js');
  const layer = (module.default as any).stack.find((entry: any) =>
    entry.route?.path === path && entry.route?.methods?.[method]
  );

  expect(layer, `${method.toUpperCase()} ${path} route should exist`).toBeTruthy();
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
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
        refreshToken: 'refresh-token',
        userId: 'user-1',
      },
    });

    const handler = await loadRouteHandler('/login');
    const res = createResponseRecorder();

    await handler({
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
});
