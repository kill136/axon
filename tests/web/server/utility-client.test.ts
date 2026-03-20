import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWebAuth = {
  getRuntimeProvider: vi.fn(),
  getRuntimeBackend: vi.fn(),
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

describe('utility client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getCredentials.mockReturnValue({
      apiKey: 'sk-test',
      authToken: undefined,
      baseUrl: 'https://api.example.com',
      accountId: undefined,
    });
    mockWebAuth.ensureValidToken.mockResolvedValue(true);
  });

  it('should create codex utility client with normalized Codex model', async () => {
    mockWebAuth.getRuntimeProvider.mockReturnValue('codex');
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getCodexModelName.mockReturnValue('gpt-5.4');
    mockWebAuth.getCustomModelName.mockReturnValue(undefined);
    mockCreateConversationClient.mockReturnValue({ createMessage: vi.fn() });

    const { createUtilityClient, getUtilityModel } = await import('../../../src/web/server/runtime/utility-client.js');

    expect(getUtilityModel('haiku')).toBe('gpt-5.4');
    createUtilityClient('haiku');

    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4',
      customModelName: 'gpt-5.4',
      baseUrl: 'https://api.example.com',
    }));
  });

  it('should create anthropic utility client with preferred lightweight model', async () => {
    mockWebAuth.getRuntimeProvider.mockReturnValue('anthropic');
    mockWebAuth.getRuntimeBackend.mockReturnValue('claude-compatible-api');
    mockWebAuth.getCodexModelName.mockReturnValue(undefined);
    mockWebAuth.getCustomModelName.mockReturnValue('claude-sonnet-4-5-20250929');
    mockCreateConversationClient.mockReturnValue({ createMessage: vi.fn() });

    const { createUtilityClient, getUtilityModel } = await import('../../../src/web/server/runtime/utility-client.js');

    expect(getUtilityModel('haiku')).toBe('haiku');
    createUtilityClient('haiku');

    expect(mockCreateConversationClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'haiku',
      customModelName: 'claude-sonnet-4-5-20250929',
    }));
  });

  it('should request utility text through the shared runtime client', async () => {
    mockWebAuth.getRuntimeProvider.mockReturnValue('codex');
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getCodexModelName.mockReturnValue('gpt-5-codex');
    mockWebAuth.getCustomModelName.mockReturnValue(undefined);
    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hello from codex' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'gpt-5-codex',
    });
    mockCreateConversationClient.mockReturnValue({ createMessage });

    const { requestUtilityText } = await import('../../../src/web/server/runtime/utility-client.js');
    const text = await requestUtilityText('say hi', 'haiku');

    expect(mockWebAuth.ensureValidToken).toHaveBeenCalled();
    expect(text).toBe('hello from codex');
    expect(createMessage).toHaveBeenCalledWith(
      [{ role: 'user', content: [{ type: 'text', text: 'say hi' }] }],
      undefined,
      undefined,
      { enableThinking: false },
    );
  });

  it('should route Axon Cloud gpt models through the codex runtime', async () => {
    mockWebAuth.getRuntimeProvider.mockReturnValue('anthropic');
    mockWebAuth.getRuntimeBackend.mockReturnValue('axon-cloud');
    mockWebAuth.getCodexModelName.mockReturnValue('gpt-5.4');
    mockWebAuth.getCustomModelName.mockReturnValue('gpt-5.4');
    mockCreateConversationClient.mockReturnValue({ createMessage: vi.fn() });

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
