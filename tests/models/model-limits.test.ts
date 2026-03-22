import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigGet = vi.fn();

vi.mock('../../src/config/index.js', () => ({
  configManager: {
    get: (...args: any[]) => mockConfigGet(...args),
  },
}));

describe('model-limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGet.mockReturnValue(undefined);
  });

  it('returns official context windows for known gpt/codex models', async () => {
    const { getResolvedModelContextWindow } = await import('../../src/models/model-limits.js');

    expect(getResolvedModelContextWindow('gpt-5.4')).toBe(1000000);
    expect(getResolvedModelContextWindow('gpt-5.4-mini')).toBe(400000);
    expect(getResolvedModelContextWindow('gpt-5.3-codex')).toBe(400000);
    expect(getResolvedModelContextWindow('gpt-5.1-codex-max')).toBe(400000);
  });

  it('prefers configured per-model overrides over official defaults', async () => {
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'modelContextWindowById') {
        return {
          'GPT-5.4': 777777,
          'custom-model': 123456,
        };
      }
      return undefined;
    });

    const { getResolvedModelContextWindow } = await import('../../src/models/model-limits.js');

    expect(getResolvedModelContextWindow('gpt-5.4')).toBe(777777);
    expect(getResolvedModelContextWindow('custom-model')).toBe(123456);
  });

  it('returns official output token limits for known gpt/codex models', async () => {
    const { getResolvedModelOutputTokenLimits } = await import('../../src/models/model-limits.js');

    expect(getResolvedModelOutputTokenLimits('gpt-5.4')).toEqual({
      default: 128000,
      upperLimit: 128000,
    });
    expect(getResolvedModelOutputTokenLimits('gpt-5-codex')).toEqual({
      default: 128000,
      upperLimit: 128000,
    });
  });
});
