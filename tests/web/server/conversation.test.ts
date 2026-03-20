import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCodexModelName: vi.fn(),
  getCustomModelName: vi.fn(),
};

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: mockWebAuth,
}));

describe('ConversationManager startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({});
    mockWebAuth.getCodexModelName.mockReturnValue(undefined);
    mockWebAuth.getCustomModelName.mockReturnValue('sonnet');
  });

  it('constructs without recursive runtime resolution on codex backends', async () => {
    const { ConversationManager } = await import('../../../src/web/server/conversation.js');

    expect(() => new ConversationManager('F:/claude-code-open', 'opus')).not.toThrow();
  }, 30000);
});
