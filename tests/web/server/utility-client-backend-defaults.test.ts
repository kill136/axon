import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCodexModelName: vi.fn(),
  getCustomModelName: vi.fn(),
  getCredentials: vi.fn(),
  ensureValidToken: vi.fn(),
};

const mockCreateConversationClient = vi.fn();

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: mockWebAuth,
}));

vi.mock('../../../src/web/server/runtime/factory.js', () => ({
  createConversationClient: (...args: any[]) => mockCreateConversationClient(...args),
}));

describe('utility client backend defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebAuth.getRuntimeBackend.mockReturnValue('openai-compatible-api');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'openai-compatible-api': 'gpt-5.4',
    });
    mockWebAuth.getCodexModelName.mockReturnValue(undefined);
    mockWebAuth.getCustomModelName.mockReturnValue('sonnet');
    mockWebAuth.getCredentials.mockReturnValue({
      apiKey: 'sk-test',
      authToken: undefined,
      baseUrl: 'https://api.example.com',
      accountId: undefined,
    });
    mockWebAuth.ensureValidToken.mockResolvedValue(true);
    mockCreateConversationClient.mockReturnValue({ createMessage: vi.fn() });
  });

  it('uses backend default model instead of stale sonnet fallback', async () => {
    const { createUtilityClient, getUtilityModel } = await import('../../../src/web/server/runtime/utility-client.js');

    expect(getUtilityModel('haiku')).toBe('gpt-5.4');
    createUtilityClient('haiku');

    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4',
      customModelName: 'gpt-5.4',
    }));
  });
});
