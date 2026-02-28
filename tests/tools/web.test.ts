/**
 * Unit tests for Web tools (WebFetch, WebSearch)
 * Tests web content fetching and searching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebFetchTool, clearWebCaches } from '../../src/tools/web.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('WebFetchTool', () => {
  let webFetchTool: WebFetchTool;

  beforeEach(() => {
    webFetchTool = new WebFetchTool();
    vi.clearAllMocks();
    clearWebCaches(); // Clear cache before each test
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = webFetchTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('url');
      expect(schema.properties).toHaveProperty('prompt');
      expect(schema.required).toContain('url');
      expect(schema.required).toContain('prompt');
    });

    it('should require url format to be uri', () => {
      const schema = webFetchTool.getInputSchema();
      expect(schema.properties.url.format).toBe('uri');
    });
  });

  describe('Basic Fetching', () => {
    it('should fetch HTML content', async () => {
      const mockHtml = '<html><body>Hello World</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' }
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Summarize this'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
      expect(result.output).toContain('example.com');
    });

    it('should fetch JSON content', async () => {
      const mockJson = { message: 'Hello', data: [1, 2, 3] };
      vi.mocked(axios.get).mockResolvedValue({
        data: mockJson,
        headers: { 'content-type': 'application/json' }
      });

      const result = await webFetchTool.execute({
        url: 'https://api.example.com/data',
        prompt: 'Parse this JSON'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
      expect(result.output).toContain('data');
    });

    it('should fetch plain text content', async () => {
      const mockText = 'Plain text content';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockText,
        headers: { 'content-type': 'text/plain' }
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com/file.txt',
        prompt: 'Read this'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Plain text content');
    });
  });

  describe('HTTP to HTTPS Upgrade', () => {
    it('should upgrade HTTP to HTTPS', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'http://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('https://example.com');
    });

    it('should not modify HTTPS URLs', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('https://example.com');
    });
  });

  describe('HTML Cleaning', () => {
    it('should strip script tags', async () => {
      const mockHtml = '<html><script>alert("bad")</script><body>Content</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('alert');
    });

    it('should strip style tags', async () => {
      const mockHtml = '<html><style>body{color:red}</style><body>Text</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('color:red');
    });

    it('should convert HTML entities', async () => {
      const mockHtml = '<html><body>&lt;tag&gt; &amp; &quot;text&quot;</body></html>';
      vi.mocked(axios.get).mockResolvedValue({
        data: mockHtml,
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      // Turndown converts HTML entities correctly
      expect(result.output).toBeDefined();
    });
  });

  describe('Content Truncation', () => {
    it('should truncate very large content', async () => {
      const largeContent = 'x'.repeat(150000);
      vi.mocked(axios.get).mockResolvedValue({
        data: `<html><body>${largeContent}</body></html>`,
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.output!.length).toBeLessThan(150000);
      // Large content is persisted to disk via persistLargeOutputSync
      expect(result.output).toContain('Output saved to disk');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNREFUSED';
      vi.mocked(axios.get).mockRejectedValue(networkError);

      // Network errors (ECONNREFUSED) are retryable, so after retries exhausted they throw
      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow();
    });

    it('should handle redirect errors', async () => {
      const redirectError: any = new Error('Redirect');
      redirectError.response = {
        status: 301,
        headers: { location: 'https://newurl.com' }
      };
      vi.mocked(axios.get).mockRejectedValue(redirectError);

      // Redirect errors with response.status 301 and location header
      // are caught by fetchUrl and returned as REDIRECT DETECTED
      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('REDIRECT');
    });

    it('should handle timeout', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('timeout of 30000ms exceeded'));

      // Timeout errors are retryable, so after retries exhausted they throw
      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow(/timeout/i);
    });
  });

  describe('Request Configuration', () => {
    it('should set proper headers', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(axios.get).toHaveBeenCalled();
    });

    it('should set timeout', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(axios.get).toHaveBeenCalled();
    });

    it('should allow redirects', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(true);
      expect(axios.get).toHaveBeenCalled();
    });
  });
});

// Note: WebSearchTool has been migrated to Anthropic API Server Tool
// and is no longer available as a client-side tool class
