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

vi.mock('../../../src/context/session-memory.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/context/session-memory.js')>('../../../src/context/session-memory.js');
  return {
    ...actual,
    isSessionMemoryEnabled: vi.fn(() => false),
  };
});

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

  it('uses normalized anthropic aliases for third-party claude-compatible-api backends', async () => {
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'api_key',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });
    mockWebAuth.getCredentials.mockReturnValue({
      apiKey: 'sk-test',
      baseUrl: 'https://newapi.example.com/v1',
    });

    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    expect(manager.buildClientConfig('claude-sonnet-4-5-20250929', 'claude-compatible-api')).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'sonnet',
      }),
    );
  });

  it('uses full Anthropic model ids for official claude-compatible-api endpoints', async () => {
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

    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    expect(manager.buildClientConfig('claude-sonnet-4-5-20250929', 'claude-compatible-api')).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      }),
    );
  });

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

  it('requires an explicit continuation marker instead of inferring from trailing tool_result', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    manager.sessions.set('session-with-cancelled-tool-result', {
      session: {},
      client: {},
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'sleep 10' } }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'Error: Operation cancelled by user',
            is_error: true,
          }],
        },
      ],
      model: 'sonnet',
      runtimeBackend: 'codex-subscription',
      cancelled: false,
      chatHistory: [],
      userInteractionHandler: {},
      taskManager: {},
      permissionHandler: {},
      rewindManager: {},
      toolFilterConfig: { mode: 'all' },
      systemPromptConfig: { useDefault: true },
      isProcessing: false,
      processingGeneration: 0,
      lastActualInputTokens: 0,
      messagesLenAtLastApiCall: 0,
      pendingContinuationAfterRestore: false,
      latestImageAttachments: [],
      lastPersistedMessageCount: 2,
    });

    expect(manager.needsContinuation('session-with-cancelled-tool-result')).toBe(false);

    manager.sessions.get('session-with-cancelled-tool-result').pendingContinuationAfterRestore = true;

    expect(manager.needsContinuation('session-with-cancelled-tool-result')).toBe(true);
  });

  it('does not resume streaming on reconnect for sessions already marked cancelled', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'opus') as any;

    manager.sessions.set('cancelling-session', {
      session: {},
      client: {},
      messages: [],
      model: 'sonnet',
      runtimeBackend: 'codex-subscription',
      cancelled: true,
      chatHistory: [],
      userInteractionHandler: {},
      taskManager: {},
      permissionHandler: {},
      rewindManager: {},
      toolFilterConfig: { mode: 'all' },
      systemPromptConfig: { useDefault: true },
      isProcessing: true,
      processingGeneration: 0,
      lastActualInputTokens: 0,
      messagesLenAtLastApiCall: 0,
      pendingContinuationAfterRestore: false,
      latestImageAttachments: [],
      lastPersistedMessageCount: 0,
    });

    expect(manager.shouldResumeStreamingOnReconnect('cancelling-session')).toBe(false);
  });

  it('requests streaming transport for manual conversation compaction summaries', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'gpt-5.4') as any;
    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '<summary>compact result</summary>' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'gpt-5.4',
    });

    manager.sessions.set('compact-session', {
      session: { cwd: 'F:/claude-code-open', sessionId: 'compact-session' },
      client: {
        createMessage,
      },
      messages: [
        { role: 'user', content: [{ type: 'text', text: '请总结前面的对话' }] },
        { role: 'assistant', content: [{ type: 'text', text: '好的，我来处理。' }] },
        { role: 'user', content: [{ type: 'text', text: '继续' }] },
      ],
      model: 'gpt-5.4',
      runtimeBackend: 'codex-subscription',
      cancelled: false,
      chatHistory: [],
      userInteractionHandler: {},
      taskManager: {},
      permissionHandler: {},
      rewindManager: {},
      toolFilterConfig: { mode: 'all' },
      systemPromptConfig: { useDefault: true },
      isProcessing: false,
      processingGeneration: 0,
      lastActualInputTokens: 0,
      messagesLenAtLastApiCall: 0,
      pendingContinuationAfterRestore: false,
      latestImageAttachments: [],
      lastPersistedMessageCount: 0,
    });

    const result = await manager.compactSession('compact-session');

    expect(result.success).toBe(true);
    expect(createMessage).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      'You are a helpful AI assistant tasked with summarizing conversations concisely while preserving all critical technical details.',
      { preferStreamingTransport: true },
    );
  });

  it('returns the upstream compact error instead of a generic not performed message', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');
    const manager = new ConversationManager('F:/claude-code-open', 'gpt-5.4') as any;

    manager.sessions.set('compact-error-session', {
      session: { cwd: 'F:/claude-code-open', sessionId: 'compact-error-session' },
      client: {
        createMessage: vi.fn().mockRejectedValue(new Error('OpenAI-compatible request failed (HTTP 503): Service Unavailable')),
      },
      messages: [
        { role: 'user', content: [{ type: 'text', text: '请总结前面的对话' }] },
        { role: 'assistant', content: [{ type: 'text', text: '好的，我来处理。' }] },
        { role: 'user', content: [{ type: 'text', text: '继续' }] },
      ],
      model: 'gpt-5.4',
      runtimeBackend: 'codex-subscription',
      cancelled: false,
      chatHistory: [],
      userInteractionHandler: {},
      taskManager: {},
      permissionHandler: {},
      rewindManager: {},
      toolFilterConfig: { mode: 'all' },
      systemPromptConfig: { useDefault: true },
      isProcessing: false,
      processingGeneration: 0,
      lastActualInputTokens: 0,
      messagesLenAtLastApiCall: 0,
      pendingContinuationAfterRestore: false,
      latestImageAttachments: [],
      lastPersistedMessageCount: 0,
    });

    await expect(manager.compactSession('compact-error-session')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: 'Compaction failed: OpenAI-compatible request failed (HTTP 503): Service Unavailable',
      }),
    );
  });
});
