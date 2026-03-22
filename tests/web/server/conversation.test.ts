import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSystemPromptBuild = vi.fn();
const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCustomModelCatalogByBackend: vi.fn(),
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
    mockWebAuth.getCustomModelCatalogByBackend.mockReturnValue({});
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

  it('injects ImageGen guidance for attachment edit strength preferences', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    const guidance = manager.buildWebuiToolGuidance();

    expect(guidance).toContain('ImageGen tool usage');
    expect(guidance).toContain('edit_strength');
    expect(guidance).toContain('image attachment edit preferences');
  });

  it('maps assistant thinking blocks into Web chat history', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    const history = manager.convertMessagesToChatHistory([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先核对模型配置，再决定是否调用工具。' },
          { type: 'text', text: '我先检查一下。' },
        ],
      },
    ], 'codex-subscription');

    expect(history).toHaveLength(1);
    expect(history[0].content).toEqual([
      { type: 'thinking', text: '先核对模型配置，再决定是否调用工具。' },
      { type: 'text', text: '我先检查一下。' },
    ]);
  });
});
