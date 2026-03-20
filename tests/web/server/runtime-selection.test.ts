import { describe, expect, it } from 'vitest';

import {
  getConfiguredRuntimeModelName,
  resolveRuntimeSelection,
} from '../../../src/web/server/runtime/runtime-selection.js';

describe('runtime selection', () => {
  it('falls back to the default Codex model without reusing anthropic custom models', () => {
    const selection = resolveRuntimeSelection({
      runtimeBackend: 'codex-subscription',
      model: 'opus',
      defaultModelByBackend: {},
      codexModelName: undefined,
      customModelName: 'sonnet',
    });

    expect(selection.customModelName).toBeUndefined();
    expect(selection.provider).toBe('codex');
    expect(selection.normalizedModel).toBe('gpt-5-codex');
  });

  it('routes Axon Cloud through codex when the stored backend model is a GPT model', () => {
    const selection = resolveRuntimeSelection({
      runtimeBackend: 'axon-cloud',
      defaultModelByBackend: {
        'axon-cloud': 'gpt-5.4',
      },
      codexModelName: undefined,
      customModelName: 'sonnet',
    });

    expect(selection.customModelName).toBe('gpt-5.4');
    expect(selection.provider).toBe('codex');
    expect(selection.normalizedModel).toBe('gpt-5.4');
  });

  it('keeps anthropic defaults for Claude-compatible backends', () => {
    expect(
      getConfiguredRuntimeModelName(
        'claude-compatible-api',
        {},
        'gpt-5.4',
        ' claude-sonnet-4-5-20250929 ',
      ),
    ).toBe('claude-sonnet-4-5-20250929');

    const selection = resolveRuntimeSelection({
      runtimeBackend: 'claude-compatible-api',
      model: 'sonnet',
      defaultModelByBackend: {},
      codexModelName: 'gpt-5.4',
      customModelName: 'claude-sonnet-4-5-20250929',
    });

    expect(selection.provider).toBe('anthropic');
    expect(selection.customModelName).toBe('claude-sonnet-4-5-20250929');
    expect(selection.normalizedModel).toBe('sonnet');
  });
});
