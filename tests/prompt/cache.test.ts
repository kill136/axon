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

  it('should invalidate cache keys when notebook summary changes', () => {
    const baseContext = {
      workingDir: 'F:/claude-code-open',
      model: 'claude-opus-4-6',
      notebookSummary: '<notebook>old</notebook>',
    };

    const before = generateCacheKey(baseContext);
    const after = generateCacheKey({
      ...baseContext,
      notebookSummary: '<notebook>new</notebook>',
    });

    expect(before).not.toBe(after);
  });

  it('should normalize set order for stable cache keys', () => {
    const first = generateCacheKey({
      workingDir: 'F:/claude-code-open',
      toolNames: new Set(['Read', 'Write', 'Edit']),
    });

    const second = generateCacheKey({
      workingDir: 'F:/claude-code-open',
      toolNames: new Set(['Edit', 'Read', 'Write']),
    });

    expect(first).toBe(second);
  });
});
