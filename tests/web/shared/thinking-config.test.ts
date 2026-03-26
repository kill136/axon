import { describe, expect, it } from 'vitest';

import {
  getResolvedWebThinkingConfig,
  getSupportedWebThinkingLevels,
  mapThinkingConfigToRuntimeOptions,
} from '../../../src/web/shared/thinking-config.js';

describe('web thinking config', () => {
  it('should default to the highest available thinking level per model capability', () => {
    expect(getResolvedWebThinkingConfig('openai-compatible-api', 'gpt-5.4')).toEqual({
      enabled: true,
      level: 'xhigh',
    });

    expect(getResolvedWebThinkingConfig('claude-subscription', 'sonnet')).toEqual({
      enabled: true,
      level: 'high',
    });
  });

  it('should map anthropic thinking levels to the expected budgets', () => {
    expect(
      mapThinkingConfigToRuntimeOptions('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'low',
      }),
    ).toEqual({
      enableThinking: true,
      thinkingBudget: 2000,
      reasoningEffort: 'low',
    });

    expect(
      mapThinkingConfigToRuntimeOptions('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'medium',
      }),
    ).toEqual({
      enableThinking: true,
      thinkingBudget: 10000,
      reasoningEffort: 'medium',
    });

    expect(
      mapThinkingConfigToRuntimeOptions('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enableThinking: true,
      thinkingBudget: 50000,
      reasoningEffort: 'high',
    });
  });

  it('should map codex thinking levels to reasoning effort without a budget', () => {
    expect(
      mapThinkingConfigToRuntimeOptions('codex-subscription', 'gpt-5-codex', {
        enabled: true,
        level: 'xhigh',
      }),
    ).toEqual({
      enableThinking: true,
      reasoningEffort: 'xhigh',
    });
  });

  it('should expose xhigh only for codex models that support it and clamp unsupported selections', () => {
    expect(getSupportedWebThinkingLevels('openai-compatible-api', 'gpt-5.4')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);

    expect(getSupportedWebThinkingLevels('claude-subscription', 'sonnet')).toEqual([
      'low',
      'medium',
      'high',
    ]);

    expect(
      getResolvedWebThinkingConfig('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'xhigh',
      }),
    ).toEqual({
      enabled: true,
      level: 'high',
    });
  });

  it('should force unsupported models to disable thinking', () => {
    expect(
      getResolvedWebThinkingConfig('openai-compatible-api', 'kimi-k2.5', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enabled: false,
      level: 'high',
    });

    expect(
      mapThinkingConfigToRuntimeOptions('openai-compatible-api', 'kimi-k2.5', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enableThinking: false,
      reasoningEffort: 'none',
    });

    expect(
      getResolvedWebThinkingConfig('claude-subscription', 'haiku', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enabled: false,
      level: 'high',
    });

    expect(
      getResolvedWebThinkingConfig('claude-subscription', 'claude-3-5-sonnet-20241022', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enabled: false,
      level: 'high',
    });
  });

  it('should keep anthropic thinking enabled for Claude 4 aliases and ids', () => {
    expect(
      getResolvedWebThinkingConfig('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'medium',
      }),
    ).toEqual({
      enabled: true,
      level: 'medium',
    });

    expect(
      getResolvedWebThinkingConfig('claude-subscription', 'claude-sonnet-4-20250514', {
        enabled: true,
        level: 'high',
      }),
    ).toEqual({
      enabled: true,
      level: 'high',
    });
  });
});
