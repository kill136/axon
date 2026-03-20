import { describe, expect, it } from 'vitest';
import { generateCacheKey } from '../../src/prompt/cache.js';

describe('generateCacheKey', () => {
  it('should separate official and agent identity prompt caches', () => {
    const officialKey = generateCacheKey({
      workingDir: 'F:/claude-code-open',
      model: 'claude-opus-4-6',
      isOfficialAuth: true,
      coreIdentityVariant: 'main',
    });

    const agentKey = generateCacheKey({
      workingDir: 'F:/claude-code-open',
      model: 'claude-opus-4-6',
      isOfficialAuth: false,
      coreIdentityVariant: 'agent',
    });

    expect(officialKey).not.toBe(agentKey);
  });
});
