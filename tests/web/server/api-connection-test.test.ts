import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateConversationClient = vi.fn();
const mockFetchRuntimeModelCatalog = vi.fn();

vi.mock('../../../src/web/server/runtime/factory.js', () => ({
  createConversationClient: (...args: any[]) => mockCreateConversationClient(...args),
}));

vi.mock('../../../src/web/server/runtime/runtime-model-catalog.js', () => ({
  fetchRuntimeModelCatalog: (...args: any[]) => mockFetchRuntimeModelCatalog(...args),
}));

describe('testRuntimeApiConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRuntimeModelCatalog.mockResolvedValue(null);
    mockCreateConversationClient.mockReturnValue({
      createMessage: vi.fn().mockResolvedValue({
        content: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
        },
        model: 'haiku',
      }),
    });
  });

  it('should route openai-compatible tests through the codex runtime with discovered models', async () => {
    mockFetchRuntimeModelCatalog.mockResolvedValue(['deepseek-v3', 'qwen-max']);
    mockCreateConversationClient.mockReturnValue({
      createMessage: vi.fn().mockResolvedValue({
        content: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
        },
        model: 'deepseek-v3',
      }),
    });

    const { testRuntimeApiConnection } = await import('../../../src/web/server/runtime/api-connection-test.js');
    const result = await testRuntimeApiConnection({
      apiKey: 'sk-openrouter',
      apiBaseUrl: 'https://openrouter.ai/api/v1/',
      runtimeBackend: 'openai-compatible-api',
    });

    expect(mockFetchRuntimeModelCatalog).toHaveBeenCalledWith(expect.objectContaining({
      runtimeBackend: 'openai-compatible-api',
      apiKey: 'sk-openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    }));
    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'deepseek-v3',
      customModelName: 'deepseek-v3',
      baseUrl: 'https://openrouter.ai/api/v1',
    }));
    expect(result).toEqual({
      model: 'deepseek-v3',
      provider: 'codex',
      baseUrl: 'https://openrouter.ai/api/v1',
      availableModels: ['deepseek-v3', 'qwen-max'],
    });
  });

  it('should default anthropic tests to Claude-compatible runtime with haiku', async () => {
    const { testRuntimeApiConnection } = await import('../../../src/web/server/runtime/api-connection-test.js');
    const result = await testRuntimeApiConnection({
      apiKey: 'sk-anthropic',
    });

    expect(mockFetchRuntimeModelCatalog).not.toHaveBeenCalled();
    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'haiku',
      baseUrl: 'https://api.anthropic.com',
    }));
    expect(result).toEqual({
      model: 'haiku',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      availableModels: undefined,
    });
  });
});
