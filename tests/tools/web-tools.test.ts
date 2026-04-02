/**
 * Comprehensive Unit Tests for Web Tools (WebFetch, WebSearch)
 * Tests input validation, URL fetching, HTML to Markdown conversion,
 * redirect handling, caching, domain filtering, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WebFetchTool, getWebCacheStats, clearWebCaches } from '../../src/tools/web.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

const TEST_SETTINGS_DIR = path.join(process.cwd(), '.tmp-webfetch-proxy-test-tools');
const TEST_SETTINGS_PATH = path.join(TEST_SETTINGS_DIR, 'settings.json');

describe('WebFetchTool', () => {
  let webFetchTool: WebFetchTool;

  beforeEach(() => {
    webFetchTool = new WebFetchTool();
    vi.clearAllMocks();
    clearWebCaches();
    process.env = { ...process.env };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    process.env.AXON_WEBFETCH_SETTINGS_PATH = TEST_SETTINGS_PATH;
    fs.rmSync(TEST_SETTINGS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    clearWebCaches();
    delete process.env.AXON_WEBFETCH_SETTINGS_PATH;
    fs.rmSync(TEST_SETTINGS_DIR, { recursive: true, force: true });
  });

  describe('Proxy Resolution', () => {
    it('should prefer settings.json proxy over environment proxy', async () => {
      fs.mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
      fs.writeFileSync(
        TEST_SETTINGS_PATH,
        JSON.stringify({ proxy: { https: 'http://127.0.0.1:7897' } }),
        'utf8'
      );

      process.env.HTTPS_PROXY = 'http://127.0.0.1:15236';
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200,
      } as any);

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(vi.mocked(axios.get).mock.calls[0]?.[1]).toMatchObject({
        proxy: {
          host: '127.0.0.1',
          port: 7897,
          protocol: 'http',
        },
      });
    });
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

      vi.mocked(axios.get)
        .mockRejectedValueOnce(redirectError)
        .mockResolvedValueOnce({
          data: '<html><body>Redirected Content</body></html>',
          headers: { 'content-type': 'text/html' },
          status: 200
        });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Redirected Content');
    });

    it('should detect cross-origin redirects', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 302,
        headers: { location: 'https://other-domain.com/page' }
      };
      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('REDIRECT');
      expect(result.error).toContain('other-domain.com');
    });

    it('should handle 302 redirects', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 302,
        headers: { location: '/temporary' }
      };

      vi.mocked(axios.get)
        .mockRejectedValueOnce(redirectError)
        .mockResolvedValueOnce({
          data: '<html><body>Temporary Redirect</body></html>',
          headers: { 'content-type': 'text/html' },
          status: 200
        });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Temporary Redirect');
    });

    it('should limit redirect count to 5', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: { location: '/redirect' }
      };

      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many redirects');
    });
  });

  describe('Caching Mechanism (15 minutes)', () => {
    it('should cache successful fetches', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Cached Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'First fetch'
      });

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Second fetch'
      });

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should cache different URLs separately', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Content</body></html>',
        headers: { 'content-type': 'text/html' },
        status: 200
      });

      await webFetchTool.execute({
        url: 'https://example1.com',
        prompt: 'Test'
      });

      await webFetchTool.execute({
        url: 'https://example2.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should update cache statistics', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body>Cached</body></html>',
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
      expect(stats.fetch.maxSize).toBe(50 * 1024 * 1024);
      expect(stats.fetch.ttl).toBe(15 * 60 * 1000);
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
      expect(result.output).toContain('Output saved to disk');
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
      expect(result.output).not.toContain('Output saved to disk');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNRESET';
      vi.mocked(axios.get).mockRejectedValue(networkError);

      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout');
      (timeoutError as any).code = 'ECONNABORTED';
      vi.mocked(axios.get).mockRejectedValue(timeoutError);

      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow();
    });

    it('should handle DNS resolution errors', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND');
      (dnsError as any).code = 'ENOTFOUND';
      vi.mocked(axios.get).mockRejectedValue(dnsError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOTFOUND');
    });

    it('should handle missing redirect location', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: {}
      };
      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Redirect detected but no location header provided');
    });
  });

  describe('Request Configuration', () => {
    it('should set proper User-Agent header', async () => {
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
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('ClaudeCode')
          })
        })
      );
    });

    it('should set timeout to 30 seconds', async () => {
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
        expect.objectContaining({
          timeout: 30000
        })
      );
    });

    it('should disable automatic redirects', async () => {
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
        expect.objectContaining({
          maxRedirects: 0
        })
      );
    });
  });
});
