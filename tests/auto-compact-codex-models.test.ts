import { describe, expect, it } from 'vitest';

import { getContextWindowSize } from '../src/core/loop.js';

describe('auto compact codex models', () => {
  it('uses official context windows for gpt/codex models', () => {
    expect(getContextWindowSize('gpt-5.4')).toBe(280000);
    expect(getContextWindowSize('gpt-5.4-mini')).toBe(400000);
    expect(getContextWindowSize('gpt-5-codex')).toBe(400000);
    expect(getContextWindowSize('gpt-5.3-codex')).toBe(400000);
  });
});
