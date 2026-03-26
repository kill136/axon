import { describe, expect, it } from 'vitest';

import {
  allowsArbitraryModelIdsForBackend,
  getDefaultAssistantDisplayNameForRuntimeBackend,
  getDefaultBaseUrlForRuntimeBackend,
  getDefaultTestModelForRuntimeBackend,
  getRuntimeBackendCapabilities,
  getRuntimeOAuthRefreshStrategy,
  getRuntimeProviderRouting,
  shouldPreferAnthropicUtilityModelForBackend,
  supportsDynamicModelCatalogForBackend,
} from '../../../src/web/shared/runtime-capabilities.js';

describe('web runtime capabilities', () => {
  it('should expose backend routing and dynamic catalog capabilities from a single registry', () => {
    expect(getRuntimeBackendCapabilities('claude-compatible-api')).toMatchObject({
      providerRouting: 'anthropic',
      defaultProvider: 'anthropic',
      supportsDynamicModelCatalog: false,
      allowsArbitraryModelIds: false,
    });
    expect(getRuntimeProviderRouting('axon-cloud')).toBe('model-routed');
    expect(supportsDynamicModelCatalogForBackend('axon-cloud')).toBe(true);
    expect(supportsDynamicModelCatalogForBackend('codex-subscription')).toBe(false);
    expect(allowsArbitraryModelIdsForBackend('axon-cloud')).toBe(true);
    expect(allowsArbitraryModelIdsForBackend('openai-compatible-api')).toBe(true);
    expect(allowsArbitraryModelIdsForBackend('codex-subscription')).toBe(false);
  });

  it('should resolve backend default base urls without scattering provider checks', () => {
    expect(getDefaultBaseUrlForRuntimeBackend('claude-compatible-api')).toBe('https://api.anthropic.com');
    expect(getDefaultBaseUrlForRuntimeBackend('openai-compatible-api')).toBe('https://api.openai.com/v1');
    expect(getDefaultBaseUrlForRuntimeBackend('codex-subscription')).toBe('https://chatgpt.com/backend-api/codex');
    expect(
      getDefaultBaseUrlForRuntimeBackend('codex-subscription', { useApiKey: true }),
    ).toBe('https://api.openai.com/v1');
  });

  it('should expose default test models and assistant labels by runtime backend', () => {
    expect(getDefaultTestModelForRuntimeBackend('claude-subscription')).toBe('haiku');
    expect(getDefaultTestModelForRuntimeBackend('openai-compatible-api')).toBe('gpt-5.4');
    expect(getDefaultAssistantDisplayNameForRuntimeBackend('axon-cloud')).toBe('Axon');
    expect(getDefaultAssistantDisplayNameForRuntimeBackend('codex-subscription')).toBe('Codex');
  });

  it('should describe oauth refresh and utility model strategies by backend', () => {
    expect(getRuntimeOAuthRefreshStrategy('claude-subscription', { authPriority: 'oauth' })).toBe('anthropic');
    expect(getRuntimeOAuthRefreshStrategy('claude-compatible-api', { authPriority: 'apiKey' })).toBe('none');
    expect(getRuntimeOAuthRefreshStrategy('claude-compatible-api', { authPriority: 'oauth' })).toBe('anthropic');
    expect(getRuntimeOAuthRefreshStrategy('codex-subscription', { authPriority: 'oauth' })).toBe('codex');
    expect(shouldPreferAnthropicUtilityModelForBackend('claude-compatible-api')).toBe(true);
    expect(shouldPreferAnthropicUtilityModelForBackend('openai-compatible-api')).toBe(false);
  });
});
