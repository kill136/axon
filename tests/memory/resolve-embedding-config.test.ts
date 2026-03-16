import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEmbeddingConfig, type EmbeddingConfig } from '../../src/memory/memory-search.js';

describe('resolveEmbeddingConfig', () => {
  const originalEnv = process.env.AXON_DISABLE_BUILTIN_EMBEDDING;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AXON_DISABLE_BUILTIN_EMBEDDING;
    } else {
      process.env.AXON_DISABLE_BUILTIN_EMBEDDING = originalEnv;
    }
  });

  it('should return user config when apiKey is provided', () => {
    const userConfig: EmbeddingConfig = {
      provider: 'openai',
      apiKey: 'sk-user-custom-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };

    const result = resolveEmbeddingConfig(userConfig);
    expect(result.apiKey).toBe('sk-user-custom-key');
    expect(result.baseUrl).toBe('https://api.openai.com/v1');
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.dimensions).toBe(1536);
  });

  it('should return builtin config when no user config', () => {
    const result = resolveEmbeddingConfig(undefined);
    expect(result.apiKey).toContain('axon-emb-');
    expect(result.baseUrl).toContain('railway.app');
    expect(result.model).toBe('embeddinggemma:300m');
    expect(result.dimensions).toBe(768);
  });

  it('should return builtin config when user config has no apiKey', () => {
    const result = resolveEmbeddingConfig({ provider: 'openai' } as any);
    expect(result.apiKey).toContain('axon-emb-');
    expect(result.model).toBe('embeddinggemma:300m');
  });

  it('should return builtin config when user config apiKey is empty string', () => {
    const result = resolveEmbeddingConfig({ provider: 'openai', apiKey: '' } as any);
    expect(result.apiKey).toContain('axon-emb-');
  });

  it('should disable builtin when AXON_DISABLE_BUILTIN_EMBEDDING=1', () => {
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    const result = resolveEmbeddingConfig(undefined);
    expect(result).toBeUndefined();
  });

  it('should still use user config even when AXON_DISABLE_BUILTIN_EMBEDDING=1', () => {
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    const userConfig: EmbeddingConfig = {
      provider: 'openai',
      apiKey: 'sk-my-key',
      model: 'text-embedding-3-small',
    };
    const result = resolveEmbeddingConfig(userConfig);
    expect(result.apiKey).toBe('sk-my-key');
  });

  it('user config takes priority over builtin', () => {
    const userConfig: EmbeddingConfig = {
      provider: 'openai',
      apiKey: 'sk-my-key',
      baseUrl: 'https://my-server.com/v1',
      model: 'custom-model',
      dimensions: 512,
    };
    const result = resolveEmbeddingConfig(userConfig);
    expect(result).toBe(userConfig); // same reference, not builtin
    expect(result.baseUrl).toBe('https://my-server.com/v1');
  });
});
