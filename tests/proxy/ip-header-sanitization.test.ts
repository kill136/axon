import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxyServer, type AuthMode } from '../../src/proxy/server.js';

interface UpstreamHit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface StartedUpstream {
  hits: UpstreamHit[];
  targetBaseUrl: string;
  stop: () => Promise<void>;
}

interface StartedProxy {
  port: number;
  stop: () => Promise<void>;
}

const CLIENT_IP_HEADERS: Record<string, string> = {
  'x-forwarded-for': '203.0.113.10',
  'x-real-ip': '203.0.113.10',
  'cf-connecting-ip': '203.0.113.10',
  'forwarded': 'for=203.0.113.10;proto=https',
  'true-client-ip': '203.0.113.10',
};

async function startUpstream(): Promise<StartedUpstream> {
  const hits: UpstreamHit[] = [];

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    hits.push({
      method: req.method || 'GET',
      url: req.url || '/',
      headers: { ...req.headers },
      body: Buffer.concat(chunks).toString('utf8'),
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    hits,
    targetBaseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startProxy(authMode: AuthMode, targetBaseUrl: string): Promise<StartedProxy> {
  const proxy = await createProxyServer({
    port: 0,
    host: '127.0.0.1',
    proxyApiKey: authMode === 'oauth' ? 'proxy-oauth-key' : 'proxy-api-key',
    authMode,
    anthropicApiKey: authMode === 'api-key' ? 'real-anthropic-key' : undefined,
    oauthAccessToken: authMode === 'oauth' ? 'dummy-oauth-token' : undefined,
    oauthRefreshToken: authMode === 'oauth' ? '' : undefined,
    oauthExpiresAt: authMode === 'oauth' ? Date.now() + 60 * 60 * 1000 : undefined,
    oauthAccountUuid: authMode === 'oauth' ? 'test-account-uuid' : undefined,
    targetBaseUrl,
  });

  await proxy.start();
  const port = (proxy.server.address() as AddressInfo).port;

  return {
    port,
    stop: () => proxy.stop(),
  };
}

function expectNoClientIpHeaders(headers: http.IncomingHttpHeaders) {
  expect(headers['x-forwarded-for']).toBeUndefined();
  expect(headers['x-real-ip']).toBeUndefined();
  expect(headers['cf-connecting-ip']).toBeUndefined();
  expect(headers.forwarded).toBeUndefined();
  expect(headers['true-client-ip']).toBeUndefined();
}

describe('Proxy IP header sanitization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('API Key 模式不会透传客户端 IP 头', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy('api-key', upstream.targetBaseUrl);

    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'proxy-api-key',
          ...CLIENT_IP_HEADERS,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      expect(response.status).toBe(200);
      expect(upstream.hits).toHaveLength(1);
      expectNoClientIpHeaders(upstream.hits[0].headers);
      expect(upstream.hits[0].headers['x-api-key']).toBe('real-anthropic-key');
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it('OAuth 普通转发路径会剥离客户端 IP 头', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy('oauth', upstream.targetBaseUrl);

    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': 'proxy-oauth-key',
          ...CLIENT_IP_HEADERS,
        },
      });

      expect(response.status).toBe(200);
      expect(upstream.hits).toHaveLength(1);
      expectNoClientIpHeaders(upstream.hits[0].headers);
      expect(upstream.hits[0].headers.authorization).toBe('Bearer dummy-oauth-token');
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it('OAuth /v1/messages 转发路径会剥离客户端 IP 头', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy('oauth', upstream.targetBaseUrl);

    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'proxy-oauth-key',
          ...CLIENT_IP_HEADERS,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16,
          stream: false,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      expect(response.status).toBe(200);
      expect(upstream.hits).toHaveLength(1);
      expectNoClientIpHeaders(upstream.hits[0].headers);
      expect(upstream.hits[0].headers.authorization).toBe('Bearer dummy-oauth-token');
      expect(upstream.hits[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });
});
