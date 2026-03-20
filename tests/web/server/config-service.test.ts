import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigGetAll = vi.fn();
const mockConfigSave = vi.fn();

const mockWebAuth = {
  getCredentials: vi.fn(),
  getMaskedApiKey: vi.fn(),
  getCustomModelName: vi.fn(),
  getRuntimeProvider: vi.fn(),
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCustomModelCatalogByBackend: vi.fn(),
  setApiKey: vi.fn(),
};

vi.mock('../../../src/config/index.js', () => ({
  configManager: {
    getAll: (...args: any[]) => mockConfigGetAll(...args),
    save: (...args: any[]) => mockConfigSave(...args),
  },
  ConfigManager: class {},
}));

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: mockWebAuth,
}));

describe('web config service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGetAll.mockReturnValue({
      model: 'opus',
      maxTokens: 8192,
      temperature: 0,
      apiProvider: 'anthropic',
      useBedrock: false,
      useVertex: false,
      maxRetries: 3,
      requestTimeout: 300000,
    });
    mockWebAuth.getCredentials.mockReturnValue({
      apiKey: 'sk-test',
      authToken: undefined,
      baseUrl: 'https://api.example.com',
    });
    mockWebAuth.getMaskedApiKey.mockReturnValue('sk-tes...1234');
    mockWebAuth.getCustomModelName.mockReturnValue('gpt-5.4');
    mockWebAuth.getRuntimeProvider.mockReturnValue('codex');
    mockWebAuth.getRuntimeBackend.mockReturnValue('openai-compatible-api');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'openai-compatible-api': 'gpt-5.4',
      'claude-subscription': 'sonnet',
    });
    mockWebAuth.getCustomModelCatalogByBackend.mockReturnValue({
      'openai-compatible-api': ['gpt-5.4', 'gpt-5.4-mini'],
    });
  });

  it('should expose runtime backend and per-backend model preferences', async () => {
    const { WebConfigService } = await import('../../../src/web/server/services/config-service.js');
    const service = new WebConfigService();

    const config = await service.getApiConfig();
    expect(config.runtimeBackend).toBe('openai-compatible-api');
    expect(config.runtimeProvider).toBe('codex');
    expect(config.defaultModelByBackend).toEqual({
      'openai-compatible-api': 'gpt-5.4',
      'claude-subscription': 'sonnet',
    });
    expect(config.customModelCatalogByBackend).toEqual({
      'openai-compatible-api': ['gpt-5.4', 'gpt-5.4-mini'],
    });
  });

  it('should persist runtime backend and mirror custom model into per-backend defaults', async () => {
    const { WebConfigService } = await import('../../../src/web/server/services/config-service.js');
    const service = new WebConfigService();

    const success = await service.updateApiConfig({
      authPriority: 'apiKey',
      apiProvider: 'openai-compatible',
      customModelName: 'gpt-5.1-codex',
    });

    expect(success).toBe(true);
    expect(mockConfigSave).toHaveBeenCalledWith(expect.objectContaining({
      authPriority: 'apiKey',
      apiProvider: 'openai-compatible',
      runtimeBackend: 'openai-compatible-api',
      runtimeProvider: 'codex',
      customModelName: 'gpt-5.1-codex',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.1-codex',
        'claude-subscription': 'sonnet',
      },
    }));
  });

  it('should preserve axon cloud runtime backend for managed api-key logins', async () => {
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'codex-subscription': 'gpt-5-codex',
    });

    const { WebConfigService } = await import('../../../src/web/server/services/config-service.js');
    const service = new WebConfigService();

    const success = await service.updateApiConfig({
      authPriority: 'apiKey',
      runtimeBackend: 'axon-cloud',
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
      customModelName: '',
    });

    expect(success).toBe(true);
    expect(mockWebAuth.setApiKey).toHaveBeenCalledWith('sk-axon');
    expect(mockConfigSave).toHaveBeenCalledWith(expect.objectContaining({
      authPriority: 'apiKey',
      runtimeBackend: 'axon-cloud',
      runtimeProvider: 'anthropic',
      apiBaseUrl: 'https://newapi.example.com',
      customModelName: '',
      defaultModelByBackend: {
        'codex-subscription': 'gpt-5-codex',
      },
    }));
  });
});
