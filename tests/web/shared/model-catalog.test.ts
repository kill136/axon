import { describe, expect, it } from 'vitest';

import {
  getWebModelLabel,
  getWebModelOptions,
  getWebModelOptionsForBackend,
  getRuntimeBackendOptions,
  getRuntimeBackendLabel,
  getProviderForRuntimeBackend,
  getAssistantDisplayName,
  inferWebRuntimeProvider,
  resolveWebRuntimeProvider,
  normalizeWebRuntimeModelForBackend,
  normalizeWebRuntimeModel,
} from '../../../src/web/shared/model-catalog.js';

describe('web model catalog', () => {
  it('should keep anthropic aliases and normalize full anthropic ids', () => {
    expect(normalizeWebRuntimeModel('anthropic', 'opus')).toBe('opus');
    expect(normalizeWebRuntimeModel('anthropic', 'claude-sonnet-4-5-20250929')).toBe('sonnet');
    expect(normalizeWebRuntimeModel('anthropic', 'claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('should fall back to default codex model for stale claude values', () => {
    expect(normalizeWebRuntimeModel('codex', 'opus')).toBe('gpt-5-codex');
    expect(normalizeWebRuntimeModel('codex', 'sonnet', 'gpt-5.4')).toBe('gpt-5.4');
  });

  it('should infer codex provider from gpt and codex model ids', () => {
    expect(inferWebRuntimeProvider('gpt-5-codex')).toBe('codex');
    expect(inferWebRuntimeProvider('gpt-5.4')).toBe('codex');
    expect(inferWebRuntimeProvider('opus')).toBe('anthropic');
  });

  it('should include current codex model and default codex option without duplicates', () => {
    const options = getWebModelOptions('codex', 'gpt-5.4', 'gpt-5.4');
    expect(options.map(option => option.value).slice(0, 2)).toEqual(['gpt-5.4', 'gpt-5-codex']);
    expect(new Set(options.map(option => option.value)).size).toBe(options.length);
  });

  it('should render readable labels for codex models', () => {
    expect(getWebModelLabel('gpt-5-codex', 'codex')).toBe('GPT 5 Codex');
    expect(getWebModelLabel('gpt-5.1-codex-max', 'codex')).toBe('GPT 5.1 Codex Max');
  });

  it('should map runtime backends to provider families', () => {
    expect(getProviderForRuntimeBackend('claude-subscription')).toBe('anthropic');
    expect(getProviderForRuntimeBackend('claude-compatible-api')).toBe('anthropic');
    expect(getProviderForRuntimeBackend('codex-subscription')).toBe('codex');
    expect(getProviderForRuntimeBackend('openai-compatible-api')).toBe('codex');
    expect(getProviderForRuntimeBackend('axon-cloud', 'opus')).toBe('anthropic');
    expect(getProviderForRuntimeBackend('axon-cloud', 'claude-sonnet-4-5-20250929')).toBe('anthropic');
    expect(getProviderForRuntimeBackend('axon-cloud', 'gpt-5.4')).toBe('codex');
    expect(getProviderForRuntimeBackend('axon-cloud', 'kimi-k2.5')).toBe('codex');
  });

  it('should resolve display provider and assistant labels from runtime backend first', () => {
    expect(resolveWebRuntimeProvider('opus', 'codex-subscription')).toBe('codex');
    expect(resolveWebRuntimeProvider('gpt-5.4', 'claude-compatible-api')).toBe('anthropic');
    expect(resolveWebRuntimeProvider('gpt-5.4', 'axon-cloud')).toBe('codex');
    expect(getAssistantDisplayName('gpt-5.4', 'openai-compatible-api')).toBe('OpenAI');
    expect(getAssistantDisplayName('opus', 'claude-subscription')).toBe('Claude');
  });

  it('should normalize models using backend defaults', () => {
    expect(normalizeWebRuntimeModelForBackend('codex-subscription', 'sonnet')).toBe('gpt-5-codex');
    expect(normalizeWebRuntimeModelForBackend('openai-compatible-api', undefined, 'gpt-5.4-mini')).toBe('gpt-5.4-mini');
    expect(normalizeWebRuntimeModelForBackend('openai-compatible-api', 'kimi-k2.5')).toBe('kimi-k2.5');
    expect(normalizeWebRuntimeModelForBackend('claude-compatible-api', 'claude-sonnet-4-5-20250929')).toBe('sonnet');
  });

  it('should prefer dynamic Axon Cloud models over stale static aliases', () => {
    expect(
      normalizeWebRuntimeModelForBackend('axon-cloud', 'opus', undefined, ['gpt-4o', 'claude-3-7-sonnet']),
    ).toBe('gpt-4o');
    expect(
      normalizeWebRuntimeModelForBackend('axon-cloud', 'deepseek-r1', undefined, ['gpt-4o']),
    ).toBe('deepseek-r1');
  });

  it('should provide readable labels and recommended options for runtime backends', () => {
    expect(getRuntimeBackendLabel('claude-compatible-api')).toBe('Claude-Compatible API');
    expect(getRuntimeBackendLabel('codex-subscription')).toBe('Codex Subscription');

    const openaiOptions = getWebModelOptionsForBackend('openai-compatible-api', 'gpt-5.1', 'gpt-5.4');
    expect(openaiOptions.map(option => option.value)).toContain('gpt-5.4');
    expect(openaiOptions.map(option => option.value)).toContain('gpt-5.1');
  });

  it('should expose backend-specific model pickers for chat entry surfaces', () => {
    const codexOptions = getWebModelOptionsForBackend('codex-subscription', 'gpt-5.3-codex', 'gpt-5.4');
    expect(codexOptions.map(option => option.value)).toContain('gpt-5-codex');
    expect(codexOptions.map(option => option.value)).not.toContain('gpt-5.2');

    const claudeOptions = getWebModelOptionsForBackend('claude-compatible-api', 'claude-sonnet-4-5-20250929');
    expect(claudeOptions.map(option => option.value)).toEqual(['opus', 'sonnet', 'haiku']);

    const axonOptions = getWebModelOptionsForBackend(
      'axon-cloud',
      'gpt-4o',
      undefined,
      ['gpt-4o', 'claude-sonnet-4-5-20250929'],
    );
    expect(axonOptions.map(option => option.value)).toEqual(['gpt-4o', 'claude-sonnet-4-5-20250929']);
    expect(axonOptions.map(option => option.label)).toEqual(['GPT 4o', 'claude-sonnet-4-5-20250929']);
  });

  it('should expose all runtime backend options for auth and settings flows', () => {
    const options = getRuntimeBackendOptions();
    expect(options.map(option => option.value)).toEqual([
      'axon-cloud',
      'claude-subscription',
      'claude-compatible-api',
      'codex-subscription',
      'openai-compatible-api',
    ]);
    expect(options.find(option => option.value === 'openai-compatible-api')?.provider).toBe('codex');
    expect(options.find(option => option.value === 'claude-compatible-api')?.provider).toBe('anthropic');
  });
});
