import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenAIEmbeddingProvider,
  cosineSimilarity,
  embeddingCacheKey,
} from '../../src/memory/embedding-provider.js';

describe('embedding-provider', () => {
  describe('MODEL_DIMENSIONS mapping', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockFetchResponse(dimensions: number) {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(dimensions).fill(0.1), index: 0 }],
        }),
      });
    }

    it('should default to 1536 dimensions for text-embedding-3-small', () => {
      mockFetchResponse(1536);
      const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key' });
      expect(provider.dimensions).toBe(1536);
      expect(provider.model).toBe('text-embedding-3-small');
    });

    it('should use 768 dimensions for embeddinggemma:300m', () => {
      mockFetchResponse(768);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'embeddinggemma:300m',
      });
      expect(provider.dimensions).toBe(768);
    });

    it('should use 768 dimensions for nomic-embed-text', () => {
      mockFetchResponse(768);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'nomic-embed-text',
      });
      expect(provider.dimensions).toBe(768);
    });

    it('should use 384 dimensions for all-minilm', () => {
      mockFetchResponse(384);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'all-minilm',
      });
      expect(provider.dimensions).toBe(384);
    });

    it('should use 1024 dimensions for mxbai-embed-large', () => {
      mockFetchResponse(1024);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'mxbai-embed-large',
      });
      expect(provider.dimensions).toBe(1024);
    });

    it('should fall back to 1536 for unknown models', () => {
      mockFetchResponse(1536);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'some-unknown-model',
      });
      expect(provider.dimensions).toBe(1536);
    });

    it('should respect explicit dimensions override', () => {
      mockFetchResponse(512);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'embeddinggemma:300m',
        dimensions: 512,
      });
      expect(provider.dimensions).toBe(512);
    });

    it('should use custom baseUrl for Ollama endpoints', () => {
      mockFetchResponse(768);
      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        baseUrl: 'https://my-ollama.railway.app/v1',
        model: 'embeddinggemma:300m',
      });
      expect(provider.dimensions).toBe(768);
    });
  });

  describe('embedQuery', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should call /embeddings endpoint with correct payload', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        }),
      });

      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        baseUrl: 'https://example.com/v1',
        model: 'embeddinggemma:300m',
      });

      const result = await provider.embedQuery('hello');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
          },
          body: JSON.stringify({ model: 'embeddinggemma:300m', input: ['hello'] }),
        }),
      );

      // Should be normalized
      expect(result).toHaveLength(3);
      const magnitude = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should throw on non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'bad-key',
        model: 'embeddinggemma:300m',
      });

      await expect(provider.embedQuery('hello')).rejects.toThrow('Embedding API error 401');
    });
  });

  describe('embedBatch', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should handle batch of texts', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
          ],
        }),
      });

      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'embeddinggemma:300m',
      });

      const results = await provider.embedBatch(['hello', 'world']);
      expect(results).toHaveLength(2);
      // Each should be normalized
      for (const vec of results) {
        const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        expect(mag).toBeCloseTo(1.0, 5);
      }
    });

    it('should return results sorted by index', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.9, 0.1], index: 1 },
            { embedding: [0.1, 0.9], index: 0 },
          ],
        }),
      });

      const provider = createOpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'embeddinggemma:300m',
      });

      const results = await provider.embedBatch(['first', 'second']);
      // index 0 should come first: [0.1, 0.9] normalized
      expect(results[0][0]).toBeLessThan(results[0][1]); // 0.1 < 0.9
      expect(results[1][0]).toBeGreaterThan(results[1][1]); // 0.9 > 0.1
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it('should return -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it('should return 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it('should return 0 for different length vectors', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('should handle zero vectors', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe('embeddingCacheKey', () => {
    it('should generate deterministic hash', () => {
      const key1 = embeddingCacheKey('model-a', 'hello');
      const key2 = embeddingCacheKey('model-a', 'hello');
      expect(key1).toBe(key2);
    });

    it('should differ for different models', () => {
      const key1 = embeddingCacheKey('model-a', 'hello');
      const key2 = embeddingCacheKey('model-b', 'hello');
      expect(key1).not.toBe(key2);
    });

    it('should differ for different texts', () => {
      const key1 = embeddingCacheKey('model-a', 'hello');
      const key2 = embeddingCacheKey('model-a', 'world');
      expect(key1).not.toBe(key2);
    });
  });
});
