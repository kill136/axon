import { describe, expect, it } from 'vitest';

import { resolveRuntimeSelection } from '../../../src/web/server/runtime/runtime-selection.js';

describe('runtime selection backend defaults', () => {
  it('prefers backend model preferences over legacy custom model fields', () => {
    const selection = resolveRuntimeSelection({
      runtimeBackend: 'openai-compatible-api',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.4',
      },
      codexModelName: undefined,
      customModelName: 'sonnet',
    });

    expect(selection.customModelName).toBe('gpt-5.4');
    expect(selection.provider).toBe('codex');
    expect(selection.normalizedModel).toBe('gpt-5.4');
  });
});
