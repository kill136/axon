import http from 'node:http';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type HttpResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

async function startServer() {
  const { default: router } = await import('../../../src/web/server/routes/download-proxy.js');
  const app = express();
  app.use(router);

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function request(pathname: string, headers: http.OutgoingHttpHeaders = {}): Promise<HttpResponse> {
  const { server, baseUrl } = await startServer();

  try {
    return await new Promise<HttpResponse>((resolve, reject) => {
      const req = http.request(`${baseUrl}${pathname}`, {
        method: 'GET',
        headers,
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });

      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe('download-proxy route', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_TOKEN;
    delete process.env.DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL;
    delete process.env.DOWNLOAD_MIRROR_CN_BASE_URL;
    delete process.env.DOWNLOAD_MIRROR_AXON_SETUP_EXE_URL;
    delete process.env.DOWNLOAD_MIRROR_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('redirects China traffic to the configured file mirror before hitting GitHub', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL = 'https://mirror.example.com/Axon-Setup.exe';

    const response = await request('/download/Axon-Setup.exe?region=cn');

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://mirror.example.com/Axon-Setup.exe');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('detects zh-CN traffic and falls back to the China base mirror', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.DOWNLOAD_MIRROR_CN_BASE_URL = 'https://mirror-cn.example.com/releases/';

    const response = await request('/download/Axon-Setup.exe', {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://mirror-cn.example.com/releases/Axon-Setup.exe');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns mirror-only metadata when GitHub token is missing but mirrors are configured', async () => {
    process.env.DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL = 'https://mirror.example.com/Axon-Setup.exe';

    const response = await request('/api/download/latest?region=cn');
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.preferred_region).toBe('cn');
    expect(body.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Axon-Setup.exe',
        url: '/download/Axon-Setup.exe?region=cn',
        direct_url: 'https://mirror.example.com/Axon-Setup.exe',
        source: 'DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL',
      }),
    ]));
  });

  it('falls back to GitHub release redirects when no mirror is configured', async () => {
    process.env.GITHUB_TOKEN = 'gh-token';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: 'v2.6.0',
          name: 'v2.6.0',
          published_at: '2026-03-22T00:00:00.000Z',
          assets: [
            {
              name: 'Axon-Setup.exe',
              url: 'https://api.github.com/assets/1',
              size: 1,
              download_count: 0,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        headers: new Headers({
          location: 'https://release-assets.githubusercontent.com/Axon-Setup.exe',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request('/download/Axon-Setup.exe?region=cn');

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://release-assets.githubusercontent.com/Axon-Setup.exe');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
