import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AxonMdParser browser safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not throw when process is unavailable during module initialization', async () => {
    vi.resetModules();
    vi.stubGlobal('process', undefined);

    const mod = await import('../../src/config/axon-md-parser.js');

    expect(mod.axonMdParser).toBeDefined();

    const parser = new mod.AxonMdParser();
    const info = parser.parse();
    expect(info).toEqual(expect.objectContaining({
      exists: expect.any(Boolean),
      path: expect.any(String),
    }));
  });
});
