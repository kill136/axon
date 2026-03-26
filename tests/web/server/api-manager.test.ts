import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCredentials = vi.fn();
const mockGetRuntimeProvider = vi.fn();
const mockGetRuntimeBackend = vi.fn();
const mockGetDefaultModelByBackend = vi.fn();
const mockGetCustomModelCatalogByBackend = vi.fn();
const mockGetCodexModelName = vi.fn();
const mockGetCustomModelName = vi.fn();
const mockGetTokenStatus = vi.fn();
const mockGetProvider = vi.fn();
const mockEnsureValidToken = vi.fn();
const mockGetAllModels = vi.fn();
const mockCreateConversationClient = vi.fn();

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: {
    getCredentials: (...args: any[]) => mockGetCredentials(...args),
    getRuntimeProvider: (...args: any[]) => mockGetRuntimeProvider(...args),
    getRuntimeBackend: (...args: any[]) => mockGetRuntimeBackend(...args),
    getDefaultModelByBackend: (...args: any[]) => mockGetDefaultModelByBackend(...args),
    getCustomModelCatalogByBackend: (...args: any[]) => mockGetCustomModelCatalogByBackend(...args),
    getCodexModelName: (...args: any[]) => mockGetCodexModelName(...args),
    getCustomModelName: (...args: any[]) => mockGetCustomModelName(...args),
    getTokenStatus: (...args: any[]) => mockGetTokenStatus(...args),
    getProvider: (...args: any[]) => mockGetProvider(...args),
    ensureValidToken: (...args: any[]) => mockEnsureValidToken(...args),
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

describe('ApiManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-axon',
      baseUrl: 'https://newapi.example.com/',
    });
    mockGetRuntimeProvider.mockReturnValue('anthropic');
    mockGetRuntimeBackend.mockReturnValue('axon-cloud');
    mockGetDefaultModelByBackend.mockReturnValue({});
    mockGetCustomModelCatalogByBackend.mockReturnValue({});
    mockGetCodexModelName.mockReturnValue(undefined);
    mockGetCustomModelName.mockReturnValue(undefined);
    mockGetTokenStatus.mockReturnValue({
      type: 'api_key',
      valid: true,
    });
    mockGetProvider.mockReturnValue('axon-cloud');
    mockEnsureValidToken.mockResolvedValue(true);
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

  it('should fetch OpenAI-compatible models from the normalized /models endpoint', async () => {
    mockGetRuntimeProvider.mockReturnValue('codex');
    mockGetRuntimeBackend.mockReturnValue('openai-compatible-api');
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4.1-mini' },
          { id: 'deepseek-v3' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual([
      'gpt-4.1-mini',
      'deepseek-v3',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('should fall back to the backend default test model when the Axon Cloud catalog endpoint fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual(['gpt-5.4']);
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

  it('should fall back to the configured Axon Cloud gpt model when the dynamic catalog is unavailable', async () => {
    mockGetRuntimeProvider.mockReturnValue('codex');
    mockGetRuntimeBackend.mockReturnValue('axon-cloud');
    mockGetCustomModelName.mockReturnValue('gpt-5.4');
    mockGetCodexModelName.mockReturnValue('gpt-5.4');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual(['gpt-5.4']);
  });

  it('should fall back to the stored runtime model catalog when no default model is configured', async () => {
    mockGetRuntimeBackend.mockReturnValue('openai-compatible-api');
    mockGetDefaultModelByBackend.mockReturnValue({});
    mockGetCustomModelCatalogByBackend.mockReturnValue({
      'openai-compatible-api': ['deepseek-v3', 'qwen-max'],
    });
    mockGetCustomModelName.mockReturnValue(undefined);
    mockGetCodexModelName.mockReturnValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getAvailableModels()).resolves.toEqual(['deepseek-v3']);
    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'deepseek-v3',
    }));
  });

  it('should preserve the runtime backend endpoint in API status fallback for openai-compatible runtimes', async () => {
    mockGetRuntimeBackend.mockReturnValue('openai-compatible-api');
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-openai',
    });
    mockGetProvider.mockReturnValue('openai-compatible');
    mockGetCustomModelName.mockReturnValue('deepseek-v3');
    mockGetCodexModelName.mockReturnValue(undefined);
    mockEnsureValidToken.mockRejectedValue(new Error('network down'));

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    await expect(manager.getStatus()).resolves.toEqual({
      connected: false,
      provider: 'codex',
      runtimeBackend: 'openai-compatible-api',
      runtimeModel: 'deepseek-v3',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
      tokenStatus: {
        type: 'none',
        valid: false,
      },
    });
  });

  it('should surface runtime backend metadata in provider info for model-routed backends', async () => {
    mockGetRuntimeBackend.mockReturnValue('axon-cloud');
    mockGetCredentials.mockReturnValue({
      apiKey: 'sk-axon',
    });
    mockGetProvider.mockReturnValue('axon-cloud');
    mockGetDefaultModelByBackend.mockReturnValue({
      'axon-cloud': 'opus',
    });

    const { ApiManager } = await import('../../../src/web/server/api-manager.js');
    const manager = new ApiManager();

    expect(manager.getProviderInfo()).toEqual({
      type: 'anthropic',
      name: 'Axon Cloud',
      runtimeBackend: 'axon-cloud',
      runtimeModel: 'opus',
      endpoint: 'https://api.openai.com/v1',
      available: true,
    });
  });
});
