import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSystemPromptBuild = vi.fn();
const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCodexModelName: vi.fn(),
  getCustomModelName: vi.fn(),
  getStatus: vi.fn(),
  getCredentials: vi.fn(),
};

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: mockWebAuth,
}));

vi.mock('../../../src/prompt/index.js', () => ({
  systemPromptBuilder: {
    build: (...args: any[]) => mockSystemPromptBuild(...args),
  },
}));

describe('ConversationManager startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({});
    mockWebAuth.getCodexModelName.mockReturnValue(undefined);
    mockWebAuth.getCustomModelName.mockReturnValue('sonnet');
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'api_key',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });
    mockWebAuth.getCredentials.mockReturnValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
    });
    mockSystemPromptBuild.mockResolvedValue({
      content: 'mock prompt',
      blocks: [],
      buildTimeMs: 0,
      hashInfo: { estimatedTokens: 0 },
    });
  });

  it('constructs without recursive runtime resolution on codex backends', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');

    expect(() => new ConversationManager('F:/claude-code-open', 'opus')).not.toThrow();
  }, 30000);

  it('uses agent identity for console oauth on claude-compatible-api backends', async () => {
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'oauth',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });

    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    expect(manager.buildClientConfig('opus', 'claude-compatible-api')).toEqual(
      expect.objectContaining({
        identityVariant: 'agent',
      }),
    );
  });

  it('builds prompt context with non-official auth for console oauth backends', async () => {
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'oauth',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });

    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    await manager.buildSystemPrompt({
      model: 'opus',
      runtimeBackend: 'claude-compatible-api',
      systemPromptConfig: {
        useDefault: true,
        customPrompt: '',
      },
      session: {
        cwd: 'F:/claude-code-open',
      },
    });

    expect(mockSystemPromptBuild).toHaveBeenCalledWith(expect.objectContaining({
      isOfficialAuth: false,
      coreIdentityVariant: 'agent',
    }));
  });
});
