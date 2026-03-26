import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProxyAgent, getProxyInfo } from '../../src/network/proxy.js';

const ORIGINAL_ENV = { ...process.env };

describe('network proxy priority', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers explicit config over system proxy env', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:15236';

    const info = getProxyInfo('https://example.com', {
      https: 'http://127.0.0.1:7897',
      useSystemProxy: true,
    });

    expect(info.enabled).toBe(true);
    expect(info.proxyUrl).toBe('http://127.0.0.1:7897');
    expect(info.bypassed).toBe(false);
  });

  it('falls back to system proxy env when explicit config is absent', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:15236';

    const info = getProxyInfo('https://example.com', {
      useSystemProxy: true,
    });

    expect(info.enabled).toBe(true);
    expect(info.proxyUrl).toBe('http://127.0.0.1:15236');
  });

  it('createProxyAgent returns an agent for explicit config even if env proxy exists', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:15236';

    const agent = createProxyAgent('https://example.com', {
      https: 'http://127.0.0.1:7897',
      useSystemProxy: true,
    });

    expect(agent).toBeDefined();
  });
});
