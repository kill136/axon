import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCredentials = vi.fn();
const mockGetRuntimeProvider = vi.fn();
const mockGetRuntimeBackend = vi.fn();
const mockGetCodexModelName = vi.fn();
const mockGetCustomModelName = vi.fn();
const mockGetTokenStatus = vi.fn();
const mockGetProvider = vi.fn();
const mockGetAllModels = vi.fn();
const mockCreateConversationClient = vi.fn();

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: {
    getCredentials: (...args: any[]) => mockGetCredentials(...args),
    getRuntimeProvider: (...args: any[]) => mockGetRuntimeProvider(...args),
    getRuntimeBackend: (...args: any[]) => mockGetRuntimeBackend(...args),
    getCodexModelName: (...args: any[]) => mockGetCodexModelName(...args),
    getCustomModelName: (...args: any[]) => mockGetCustomModelName(...args),
    getTokenStatus: (...args: any[]) => mockGetTokenStatus(...args),
    getProvider: (...args: any[]) => mockGetProvider(...args),
  },
}));

vi.mock('../../../src/models/index.js', () => ({
  modelConfig: {
    getAllModels: (...args: any[]) => mockGetAllModels(...args),
  },
}));

vi.mock('../../../src/web/server/runtime/factory.js', () => ({
  createConversationClient: (...args: any[]) => mockCreateConversationClient(...args),
}));

describe('ApiManager getAvailableModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-axon',
      baseUrl: 'https://newapi.example.com/',
    });
    mockGetRuntimeProvider.mockReturnValue('anthropic');
    mockGetRuntimeBackend.mockReturnValue('axon-cloud');
    mockGetCodexModelName.mockReturnValue(undefined);
    mockGetCustomModelName.mockReturnValue(undefined);
    mockGetTokenStatus.mockReturnValue({
      type: 'api_key',
      valid: true,
    });
    mockGetProvider.mockReturnValue('axon-cloud');
    mockGetAllModels.mockReturnValue([
      { id: 'opus' },
      { id: 'sonnet' },
    ]);
    mockCreateConversationClient.mockReturnValue({
      createMessage: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should fetch Axon Cloud models from the NewAPI model catalog endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o' },
          { id: 'claude-3-7-sonnet' },
          { id: 'gpt-4o' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual([
      'gpt-4o',
      'claude-3-7-sonnet',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://newapi.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-axon',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('should fall back to the static anthropic catalog when the NewAPI model endpoint fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual(['opus', 'sonnet']);
  });

  it('should initialize Axon Cloud gpt models with the codex runtime provider', async () => {
    mockGetRuntimeProvider.mockReturnValue('anthropic');
    mockGetRuntimeBackend.mockReturnValue('axon-cloud');
    mockGetCustomModelName.mockReturnValue('gpt-5.4');
    mockGetCodexModelName.mockReturnValue('gpt-5.4');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    new ApiManager();

    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4',
      customModelName: 'gpt-5.4',
    }));
  });
});
