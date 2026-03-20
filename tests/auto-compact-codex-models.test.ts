import { describe, expect, it } from 'vitest';

import { getContextWindowSize } from '../src/core/loop.js';

describe('auto compact codex models', () => {
  it('treats gpt/codex models as standard 200k contexts unless marked 1m', () => {
    expect(getContextWindowSize('gpt-5.4')).toBe(200000);
    expect(getContextWindowSize('gpt-5-codex')).toBe(200000);
  });
});
