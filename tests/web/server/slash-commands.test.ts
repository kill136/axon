import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCodexModelName: vi.fn(),
  getCustomModelName: vi.fn(),
};

vi.mock('../../../src/web/server/web-auth.js', () => ({
  webAuth: mockWebAuth,
}));

describe('web slash commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebAuth.getRuntimeBackend.mockReturnValue('codex-subscription');
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'codex-subscription': 'gpt-5.4',
      'openai-compatible-api': 'gpt-5.4',
      'claude-subscription': 'sonnet',
    });
    mockWebAuth.getCodexModelName.mockReturnValue('gpt-5.4');
    mockWebAuth.getCustomModelName.mockReturnValue(undefined);
  });

  function createContext(model: string, runtimeBackend: string = 'codex-subscription') {
    return {
      conversationManager: {
        clearHistory: vi.fn(),
        getHistory: vi.fn(() => []),
        setModel: vi.fn(),
        getSessionRuntimeBackend: vi.fn(() => runtimeBackend),
      },
      ws: {} as WebSocket,
      sessionId: 'session-1',
      cwd: 'f:/claude-code-open',
      model,
    };
  }

  it('should describe Codex backend models for /model', async () => {
    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/model', createContext('gpt-5-codex'));

    expect(result.success).toBe(true);
    expect(result.message).toContain('Current runtime backend: Codex Subscription');
    expect(result.message).toContain('gpt-5-codex');
    expect(result.message).toContain('gpt-5.4');
  });

  it('should switch to arbitrary Codex-compatible model ids', async () => {
    const ctx = createContext('gpt-5-codex');
    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/model gpt-5.1-codex', ctx);

    expect(result.success).toBe(true);
    expect(ctx.conversationManager.setModel).toHaveBeenCalledWith('session-1', 'gpt-5.1-codex');
    expect(result.message).toContain('Codex Subscription');
    expect(result.message).toContain('gpt-5.1-codex');
  });

  it('should reject invalid Codex model ids', async () => {
    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/model sonnet', createContext('gpt-5-codex'));

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid Codex model');
  });

  it('should use session runtime backend before global backend', async () => {
    mockWebAuth.getRuntimeBackend.mockReturnValue('claude-subscription');
    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/model', createContext('gpt-5.4', 'openai-compatible-api'));

    expect(result.success).toBe(true);
    expect(result.message).toContain('Current runtime backend: OpenAI-Compatible API');
    expect(result.message).toContain('gpt-5.4');
  });
});
