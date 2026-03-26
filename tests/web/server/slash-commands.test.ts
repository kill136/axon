import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const mockWebAuth = {
  getRuntimeBackend: vi.fn(),
  getDefaultModelByBackend: vi.fn(),
  getCustomModelCatalogByBackend: vi.fn(),
  getCodexModelName: vi.fn(),
  getCustomModelName: vi.fn(),
  getStatus: vi.fn(),
  getMaskedApiKey: vi.fn(),
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
    mockWebAuth.getCustomModelCatalogByBackend.mockReturnValue({});
    mockWebAuth.getCodexModelName.mockReturnValue('gpt-5.4');
    mockWebAuth.getCustomModelName.mockReturnValue(undefined);
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'oauth',
      provider: 'codex',
      runtimeBackend: 'codex-subscription',
    });
    mockWebAuth.getMaskedApiKey.mockReturnValue(undefined);
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

  it('should allow arbitrary runtime catalog model ids for openai-compatible backends', async () => {
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'openai-compatible-api': 'deepseek-v3',
    });
    mockWebAuth.getCustomModelCatalogByBackend.mockReturnValue({
      'openai-compatible-api': ['deepseek-v3', 'qwen-max'],
    });

    const ctx = createContext('deepseek-v3', 'openai-compatible-api');
    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/model qwen-max', ctx);

    expect(result.success).toBe(true);
    expect(ctx.conversationManager.setModel).toHaveBeenCalledWith('session-1', 'qwen-max');
    expect(result.message).toContain('OpenAI-Compatible API');
    expect(result.message).toContain('qwen-max');
  });

  it('should use axon-cloud runtime cost summary instead of anthropic pricing tables', async () => {
    mockWebAuth.getDefaultModelByBackend.mockReturnValue({
      'axon-cloud': 'gpt-5.4',
    });
    const ctx = {
      ...createContext('gpt-5.4', 'axon-cloud'),
      conversationManager: {
        clearHistory: vi.fn(),
        getHistory: vi.fn(() => [
          { usage: { inputTokens: 1234, outputTokens: 567 } },
        ]),
        setModel: vi.fn(),
        getSessionRuntimeBackend: vi.fn(() => 'axon-cloud'),
      },
    };

    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/cost', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Axon Cloud');
    expect(result.message).toContain('gpt-5.4');
    expect(result.message).toContain('quota or billing views');
    expect(result.message).not.toContain('Claude Opus 4.6');
  });

  it('should report runtime auth status instead of only environment api keys', async () => {
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'oauth',
      provider: 'codex',
      runtimeBackend: 'codex-subscription',
    });

    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/status', createContext('gpt-5.4'));

    expect(result.success).toBe(true);
    expect(result.message).toContain('Backend: Codex Subscription');
    expect(result.message).toContain('Provider: codex');
    expect(result.message).toContain('Status: ✓ Connected');
    expect(result.message).toContain('Auth Type: OAuth');
  });

  it('should show runtime-backed auth details in /config', async () => {
    mockWebAuth.getStatus.mockReturnValue({
      authenticated: true,
      type: 'api_key',
      provider: 'openai-compatible',
      runtimeBackend: 'openai-compatible-api',
    });

    const { executeSlashCommand } = await import('../../../src/web/server/slash-commands.js');
    const result = await executeSlashCommand('/config', createContext('deepseek-v3', 'openai-compatible-api'));

    expect(result.success).toBe(true);
    expect(result.message).toContain('Runtime Backend: OpenAI-Compatible API');
    expect(result.message).toContain('Runtime Provider: openai-compatible');
    expect(result.message).toContain('Status: ✓ Authenticated');
    expect(result.message).toContain('Type: API Key');
  });
});
