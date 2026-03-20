import { describe, expect, it } from 'vitest';

import {
  resolveBackendDefaultModel,
  upsertBackendDefaultModel,
} from '../../../src/web/shared/model-preferences.js';

describe('model preferences helpers', () => {
  it('should resolve backend defaults with provider-aware normalization', () => {
    expect(resolveBackendDefaultModel('claude-subscription', {
      'claude-subscription': 'claude-sonnet-4-5-20250929',
    })).toBe('sonnet');

    expect(resolveBackendDefaultModel('codex-subscription', {
      'codex-subscription': 'gpt-5.4',
    })).toBe('gpt-5.4');

    expect(resolveBackendDefaultModel('openai-compatible-api', {
      'openai-compatible-api': 'opus',
    })).toBe('gpt-5.4');
  });

  it('should upsert backend defaults without mutating other backends', () => {
    expect(upsertBackendDefaultModel({
      'claude-subscription': 'sonnet',
    }, 'openai-compatible-api', 'gpt-5.1-codex')).toEqual({
      'claude-subscription': 'sonnet',
      'openai-compatible-api': 'gpt-5.1-codex',
    });
  });
});
