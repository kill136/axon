import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClaudeClientCtor = vi.fn();

vi.mock('../../../src/core/client.js', () => ({
  ClaudeClient: class MockClaudeClient {
    constructor(config: unknown) {
      mockClaudeClientCtor(config);
    }
  },
}));

vi.mock('../../../src/web/server/runtime/codex-client.js', () => ({
  CodexConversationClient: class MockCodexConversationClient {},
}));

describe('createConversationClient identity forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass identityVariant through to ClaudeClient', async () => {
    const { createConversationClient } = await import('../../../src/web/server/runtime/factory.js');

    createConversationClient({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'sk-ant-test',
      identityVariant: 'agent',
    });

    expect(mockClaudeClientCtor).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-ant-test',
      identityVariant: 'agent',
    }));
  });
});
