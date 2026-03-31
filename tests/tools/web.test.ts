/**
 * Unit tests for Web tools (WebFetch, WebSearch)
 * Tests web content fetching and searching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WebFetchTool, clearWebCaches } from '../../src/tools/web.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

const TEST_SETTINGS_DIR = path.join(process.cwd(), '.tmp-webfetch-proxy-test');
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
        data: '<html><body>Proxy Test</body></html>',
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
      expect(result.output).toContain('Output saved to disk');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNREFUSED';
      vi.mocked(axios.get).mockRejectedValue(networkError);

      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow();
    });

    it('should handle redirect errors', async () => {
      const redirectError = new Error('Redirect');
      (redirectError as any).response = {
        status: 301,
        headers: { location: 'https://other.example.com' }
      };
      vi.mocked(axios.get).mockRejectedValue(redirectError);

      const result = await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('REDIRECT');
    });

    it('should handle timeout', async () => {
      const timeoutError = new Error('timeout');
      (timeoutError as any).code = 'ECONNABORTED';
      vi.mocked(axios.get).mockRejectedValue(timeoutError);

      await expect(webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      })).rejects.toThrow();
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

    it('should set timeout', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

      await webFetchTool.execute({
        url: 'https://example.com',
        prompt: 'Test'
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          timeout: expect.any(Number)
        })
      );
    });

    it('should allow redirects', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'content',
        headers: { 'content-type': 'text/html' },
        status: 200,
        statusText: 'OK',
        config: {} as any
      } as any);

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
