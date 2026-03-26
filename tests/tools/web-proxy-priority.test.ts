import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { WebFetchTool, clearWebCaches } from '../../src/tools/web.js';

vi.mock('axios');

const TEST_DIR = path.join(process.cwd(), '.tmp-webfetch-proxy-priority');
const SETTINGS_PATH = path.join(TEST_DIR, 'settings.json');

describe('WebFetch proxy priority', () => {
  let tool: WebFetchTool;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tool = new WebFetchTool();
    clearWebCaches();
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env = { ...originalEnv };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    process.env.AXON_WEBFETCH_SETTINGS_PATH = SETTINGS_PATH;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    clearWebCaches();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('prefers settings.json proxy over environment proxy', async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify({ proxy: { https: 'http://127.0.0.1:7897' } }),
      'utf8'
    );

    process.env.HTTPS_PROXY = 'http://127.0.0.1:15236';

    vi.mocked(axios.get).mockResolvedValue({
      data: '<html><body>ok</body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200,
      statusText: 'OK',
      config: {} as any,
    } as any);

    const result = await tool.execute({
      url: 'https://example.com',
      prompt: 'test',
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(axios.get).mock.calls[0]?.[1]).toMatchObject({
      proxy: {
        host: '127.0.0.1',
        port: 7897,
        protocol: 'http',
      },
    });
  });
});
