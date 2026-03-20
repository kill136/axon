import { describe, expect, it } from 'vitest';
import { ClaudeClient } from '../../../src/core/client.js';
import { CodexConversationClient } from '../../../src/web/server/runtime/codex-client.js';
import { createConversationClient } from '../../../src/web/server/runtime/factory.js';

describe('createConversationClient', () => {
  it('should create a Codex client for codex provider', () => {
    const client = createConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      authToken: 'chatgpt-token',
      accountId: 'acct_123',
    });

    expect(client).toBeInstanceOf(CodexConversationClient);
  });

  it('should keep Anthropic provider on ClaudeClient', () => {
    const client = createConversationClient({
      provider: 'anthropic',
      model: 'sonnet',
      apiKey: 'sk-ant-test',
    });

    expect(client).toBeInstanceOf(ClaudeClient);
  });
});
