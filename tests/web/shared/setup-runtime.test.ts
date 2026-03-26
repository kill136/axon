import { describe, expect, it } from 'vitest';

import {
  buildRuntimeBackendConfigPayload,
  getGroupedSetupRuntimeOptions,
  getRuntimeBackendAuthSpec,
  getSetupRuntimeOptions,
  normalizeRuntimeConfigShape,
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
      testConnection: true,
    });
  });

  it('should group setup runtime options by managed vs api backends', () => {
    expect(getGroupedSetupRuntimeOptions()).toEqual([
      {
        id: 'managed',
        items: [
          { backend: 'axon-cloud', icon: '☁️', recommended: true },
          { backend: 'claude-subscription', icon: '🔐' },
          { backend: 'codex-subscription', icon: '🧠' },
        ],
      },
      {
        id: 'api',
        items: [
          { backend: 'claude-compatible-api', icon: '🔑' },
          { backend: 'openai-compatible-api', icon: '🌐' },
        ],
      },
    ]);
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

  it('should normalize codex api-key updates onto the api backend family', () => {
    expect(normalizeRuntimeConfigShape({
      current: {
        runtimeBackend: 'codex-subscription',
        runtimeProvider: 'codex',
        apiProvider: 'openai-compatible',
        authPriority: 'oauth',
      },
      updates: {
        authPriority: 'apiKey',
      },
    })).toEqual({
      runtimeBackend: 'openai-compatible-api',
      runtimeProvider: 'codex',
      apiProvider: 'openai-compatible',
      authPriority: 'apiKey',
    });
  });

  it('should normalize oauth updates onto the current runtime family', () => {
    expect(normalizeRuntimeConfigShape({
      current: {
        runtimeBackend: 'openai-compatible-api',
        runtimeProvider: 'codex',
        apiProvider: 'openai-compatible',
        authPriority: 'apiKey',
      },
      updates: {
        authPriority: 'oauth',
      },
    })).toEqual({
      runtimeBackend: 'codex-subscription',
      runtimeProvider: 'codex',
      apiProvider: 'openai-compatible',
      authPriority: 'oauth',
    });
  });

  it('should preserve claude-compatible provider variants during normalization', () => {
    expect(normalizeRuntimeConfigShape({
      current: {
        runtimeBackend: 'claude-compatible-api',
        runtimeProvider: 'anthropic',
        apiProvider: 'bedrock',
        authPriority: 'apiKey',
      },
      updates: {
        runtimeBackend: 'claude-compatible-api',
      },
    })).toEqual({
      runtimeBackend: 'claude-compatible-api',
      runtimeProvider: 'anthropic',
      apiProvider: 'bedrock',
      authPriority: 'apiKey',
    });
  });
});
