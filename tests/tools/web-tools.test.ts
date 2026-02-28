/**
 * Comprehensive Unit Tests for Web Tools (WebFetch, WebSearch)
 * Tests input validation, URL fetching, HTML to Markdown conversion,
 * redirect handling, caching, domain filtering, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebFetchTool, getWebCacheStats, clearWebCaches } from '../../src/tools/web.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('WebFetchTool', () => {
  let webFetchTool: WebFetchTool;

  beforeEach(() => {
    webFetchTool = new WebFetchTool();
    vi.clearAllMocks();
    clearWebCaches();
  });

  afterEach(() => {
    clearWebCaches();
  });

  describe('Input Schema Validation', () => {
    it('should have correct schema definition', () => {
      const schema = webFetchTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('url');
      expect(schema.properties).toHaveProperty('prompt');
      expect(schema.required).toEqual(['url', 'prompt']);
    });

    it('should require url format to be uri', () => {
      const schema = webFetchTool.getInputSchema();
      expect(schema.properties.url.format).toBe('uri');
      expect(schema.properties.url.type).toBe('string');
    });

    it('should require prompt to be a string', () => {
      const schema = webFetchTool.getInputSchema();
      expect(schema.properties.prompt.type).toBe('string');
    });
  });

  describe('URL Validation and Normalization', () => {
    it('should reject invalid URLs', async () => {
      const result = await webFetchTool.execute({
        url: 'not-a-valid-url',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should upgrade HTTP to HTTPS', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'http://example.com',
        prompt: 'Test'
      });

      // URL normalization may add trailing slash
      const calls = vi.mocked(axios.get).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCallUrl = calls[0][0] as string;
      expect(firstCallUrl).toMatch(/^https:\/\/example\.com\/?$/);
    });

    it('should not modify HTTPS URLs', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Object)
      );
    });

    it('should handle URLs with query parameters', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com?param=value&other=test',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com?param=value&other=test',
        expect.any(Object)
      );
    });
  });

  describe('HTML to Markdown Conversion', () => {
    it('should convert HTML to Markdown', async () => {
      const mockHtml = '<html><body><h1>Title</h1><p>Paragraph</p></body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Summarize this'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Title');
      expect(result.output).toContain('Paragraph');
    });

    it('should strip script tags', async () => {
      const mockHtml = '<html><script>alert("bad")</script><body>Content</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('alert');
      expect(result.output).toContain('Content');
    });

    it('should strip style tags', async () => {
      const mockHtml = '<html><style>body{color:red}</style><body>Text</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('color:red');
      expect(result.output).toContain('Text');
    });

    it('should handle JSON content', async () => {
      const mockJson = { message: 'Hello', data: [1, 2, 3] };
      vi.mocked(axios.get).mockResolvedValue({
        data: mockJson,
        headers: { 'content-type': 'application/json' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://api.example.com/data',
        prompt: 'Parse this JSON'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
      expect(result.output).toContain('"data"');
    });

    it('should handle plain text content', async () => {
      const mockText = 'Plain text content';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockText,
        headers: { 'content-type': 'text/plain' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com/file.txt',
        prompt: 'Read this'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Plain text content');
    });
  });

  describe('Redirect Handling', () => {
    it('should handle same-origin redirects automatically', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: { location: '/new-path' }
      };

      // First call returns redirect, second call returns content
      vi.mocked(axios.get)
        .mockRejectedValueOnce(redirectError)
        .mockResolvedValueOnce({
          data: '<html><body>Redirected Content</body></html>',
          headers: { 'content-type': 'text/html' },
          status: 200
        });

      const result = await webFetchTool.execute({
        url: 'https://example.com/old-path',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Redirected Content');
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should detect cross-origin redirects', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: { location: 'https://different-domain.com/new-path' }
      };

      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com/old-path',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('REDIRECT DETECTED');
      expect(result.error).toContain('different-domain.com');
    });

    it('should handle 302 redirects', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 302,
        headers: { location: 'https://other-domain.com' }
      };

      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('302');
    });

    it('should limit redirect count to 5', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: { location: '/redirect' }
      };

      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com/start',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many redirects');
    });
  });

  describe('Caching Mechanism (15 minutes)', () => {
    it('should cache successful fetches', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      // First fetch
      const result1 = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      // Second fetch - should use cache
      const result2 = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Different prompt'
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.output).toContain('Cached');
      expect(axios.get).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should cache different URLs separately', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: '<html><body>Content 1</body></html>',
          headers: { 'content-type': 'text/html' },
          status: 200
        })
        .mockResolvedValueOnce({
          data: '<html><body>Content 2</body></html>',
          headers: { 'content-type': 'text/html' },
          status: 200
        });

      await webFetchTool.execute({
        url: 'https://example.com/page1',
        prompt: 'Test'
      });

      await webFetchTool.execute({
        url: 'https://example.com/page2',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should update cache statistics', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      const stats = getWebCacheStats();
      expect(stats.fetch.itemCount).toBeGreaterThan(0);
    });

    it('should have correct cache configuration', () => {
      const stats = getWebCacheStats();
      expect(stats.fetch.maxSize).toBe(50 * 1024 * 1024); // 50MB
      expect(stats.fetch.ttl).toBe(15 * 60 * 1000); // 15 minutes
    });
  });

  describe('Content Truncation', () => {
    it('should truncate content exceeding 100,000 characters', async () => {
      const largeContent = 'x'.repeat(150000);
      vi.mocked(axios.get).mockResolvedValue({
        data: `<html><body>${largeContent}</body></html>`,
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      // Large content is persisted to disk via persistLargeOutputSync
      expect(result.output).toContain('Output saved to disk');
      expect(result.output!.length).toBeLessThan(150000);
    });

    it('should not truncate content under 100,000 characters', async () => {
      const normalContent = 'x'.repeat(50000);
      vi.mocked(axios.get).mockResolvedValue({
        data: `<html><body>${normalContent}</body></html>`,
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('[content truncated]');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle timeout errors', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('timeout of 30000ms exceeded'));

      // Timeout errors are retryable, so after retries exhausted they throw
      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow(/timeout/i);
    });

    it('should handle DNS resolution errors', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await webFetchTool.execute({
        url: 'https://nonexistent-domain-12345.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing redirect location', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: {} // No location header
      };

      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no location header');
    });
  });

  describe('Request Configuration', () => {
    it('should set proper User-Agent header', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('ClaudeCode')
          })
        })
      );
    });

    it('should set timeout to 30 seconds', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 30000
        })
      );
    });

    it('should disable automatic redirects', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRedirects: 0
        })
      );
    });
  });
});

// Note: WebSearchTool has been migrated to Anthropic API Server Tool
// and is no longer available as a client-side tool class

describe('Web Cache Management', () => {
  beforeEach(() => {
    clearWebCaches();
  });

  afterEach(() => {
    clearWebCaches();
  });

  describe('Cache Statistics', () => {
    it('should provide fetch cache statistics', () => {
      const stats = getWebCacheStats();

      expect(stats.fetch).toBeDefined();
      expect(stats.fetch.size).toBeDefined();
      expect(stats.fetch.calculatedSize).toBeDefined();
      expect(stats.fetch.maxSize).toBe(50 * 1024 * 1024);
      expect(stats.fetch.ttl).toBe(15 * 60 * 1000);
      expect(stats.fetch.itemCount).toBeDefined();
    });

    // Note: search cache statistics removed - WebSearch migrated to API Server Tool

    it('should track item counts correctly', async () => {
      const webFetch = new WebFetchTool();
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetch.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      const stats = getWebCacheStats();
      expect(stats.fetch.itemCount).toBeGreaterThan(0);
    });
  });

  describe('Cache Clearing', () => {
    it('should clear all caches', async () => {
      const webFetch = new WebFetchTool();

      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      // Add items to cache
      await webFetch.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      // Clear caches
      clearWebCaches();

      const stats = getWebCacheStats();
      expect(stats.fetch.itemCount).toBe(0);
    });
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    clearWebCaches();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearWebCaches();
  });

  it('should work with WebFetchTool independently', async () => {
    const fetchTool = new WebFetchTool();

    vi.mocked(axios.get).mockResolvedValue({
      data: '<html><body>Content</body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    });

    const fetchResult = await fetchTool.execute({
      url: 'https://example.com',
      prompt: 'Test'
    });

    expect(fetchResult.success).toBe(true);
  });

  it('should track fetch cache after execution', async () => {
    const fetchTool = new WebFetchTool();

    vi.mocked(axios.get).mockResolvedValue({
      data: 'content',
      headers: { 'content-type': 'text/html' },
      status: 200
    });

    await fetchTool.execute({
      url: 'https://example.com',
      prompt: 'Test'
    });

    const stats = getWebCacheStats();
    expect(stats.fetch.itemCount).toBeGreaterThan(0);
  });
});
