import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/models/config.js', () => {
  throw new Error('web/shared/thinking-config must not import src/models/config.js');
});

describe('web/shared thinking config browser boundary', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('does not depend on the server-side model config module', async () => {
    const mod = await import('../../../src/web/shared/thinking-config.js');

    expect(
      mod.getResolvedWebThinkingConfig('claude-subscription', 'sonnet', {
        enabled: true,
        level: 'medium',
      }),
    ).toEqual({
      enabled: true,
      level: 'medium',
    });
  });
});
