import { describe, expect, it } from 'vitest';

import {
  buildRuntimeBackendConfigPayload,
  getRuntimeBackendAuthSpec,
  getSetupRuntimeOptions,
} from '../../../src/web/shared/setup-runtime.js';

describe('setup runtime helpers', () => {
  it('should expose runtime options in onboarding order', () => {
    expect(getSetupRuntimeOptions().map(option => option.backend)).toEqual([
      'axon-cloud',
      'claude-subscription',
      'codex-subscription',
      'claude-compatible-api',
      'openai-compatible-api',
    ]);
    expect(getSetupRuntimeOptions()[0]?.recommended).toBe(true);
  });

  it('should describe auth specs for each runtime backend', () => {
    expect(getRuntimeBackendAuthSpec('claude-subscription')).toMatchObject({
      authMode: 'oauth',
      runtimeProvider: 'anthropic',
      apiProvider: 'anthropic',
    });
    expect(getRuntimeBackendAuthSpec('codex-subscription')).toMatchObject({
      authMode: 'oauth',
      runtimeProvider: 'codex',
      apiProvider: 'openai-compatible',
    });
    expect(getRuntimeBackendAuthSpec('claude-compatible-api')).toMatchObject({
      authMode: 'api-key',
      runtimeProvider: 'anthropic',
      testConnection: true,
    });
    expect(getRuntimeBackendAuthSpec('openai-compatible-api')).toMatchObject({
      authMode: 'api-key',
      runtimeProvider: 'codex',
      testConnection: false,
    });
  });

  it('should build configuration payloads from runtime backends', () => {
    expect(buildRuntimeBackendConfigPayload('claude-subscription')).toEqual({
      runtimeBackend: 'claude-subscription',
      runtimeProvider: 'anthropic',
      apiProvider: 'anthropic',
      authPriority: 'oauth',
    });

    expect(buildRuntimeBackendConfigPayload('openai-compatible-api', {
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    })).toEqual({
      runtimeBackend: 'openai-compatible-api',
      runtimeProvider: 'codex',
      apiProvider: 'openai-compatible',
      authPriority: 'apiKey',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
  });
});
