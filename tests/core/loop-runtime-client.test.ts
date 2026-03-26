import { describe, expect, it } from 'vitest';
import { ConversationLoop } from '../../src/core/loop.js';
import { CodexConversationClient } from '../../src/web/server/runtime/codex-client.js';

describe('ConversationLoop runtime-aware client', () => {
  it('uses the provided runtime conversation client config for codex subagents', () => {
    const loop = new ConversationLoop({
      model: 'haiku',
      isSubAgent: true,
      workingDir: process.cwd(),
      conversationClientConfig: {
        provider: 'codex',
        model: 'gpt-5.4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect((loop as any).client).toBeInstanceOf(CodexConversationClient);
    expect(loop.getModel()).toBe('gpt-5.4');
  });
});
