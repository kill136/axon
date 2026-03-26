import { describe, expect, it } from 'vitest';

import { summarizeAuthStatus } from '../../../src/web/shared/auth-summary.js';

const labels = {
  claudeAi: 'Claude.ai',
  console: 'Console',
  apiKey: 'API Key',
  axonCloud: 'Axon Cloud',
  chatgpt: 'ChatGPT / Codex',
  userFallback: 'User',
};

describe('auth summary', () => {
  it('should summarize codex subscription separately from runtime backend', () => {
    expect(summarizeAuthStatus({
      authenticated: true,
      type: 'oauth',
      provider: 'codex',
      accountType: 'chatgpt',
      runtimeBackend: 'codex-subscription',
      email: 'dev@example.com',
    }, labels)).toEqual({
      avatar: '🧠',
      triggerLabel: 'dev@example.com',
      accountLabel: 'ChatGPT / Codex',
      accountDetail: 'dev@example.com',
      runtimeLabel: 'Codex Subscription',
    });
  });

  it('should summarize api key auth with independent runtime backend', () => {
    expect(summarizeAuthStatus({
      authenticated: true,
      type: 'api_key',
      provider: 'openai-compatible',
      runtimeBackend: 'openai-compatible-api',
    }, labels)).toEqual({
      avatar: '🔑',
      triggerLabel: 'API Key',
      accountLabel: 'API Key',
      accountDetail: 'openai-compatible',
      runtimeLabel: 'OpenAI-Compatible API',
    });
  });

  it('should keep codex-family api key auth as API Key instead of ChatGPT subscription', () => {
    expect(summarizeAuthStatus({
      authenticated: true,
      type: 'api_key',
      provider: 'codex',
      runtimeBackend: 'openai-compatible-api',
    }, labels)).toEqual({
      avatar: '🔑',
      triggerLabel: 'API Key',
      accountLabel: 'API Key',
      accountDetail: 'codex',
      runtimeLabel: 'OpenAI-Compatible API',
    });
  });

  it('should summarize axon cloud with account and runtime labels', () => {
    expect(summarizeAuthStatus({
      authenticated: true,
      type: 'api_key',
      accountType: 'axon-cloud',
      isAxonCloud: true,
      displayName: 'axon-user',
      runtimeBackend: 'axon-cloud',
    }, labels)).toEqual({
      avatar: '☁️',
      triggerLabel: 'axon-user',
      accountLabel: 'Axon Cloud',
      accountDetail: 'Axon Cloud',
      runtimeLabel: 'Axon Cloud',
    });
  });
});
