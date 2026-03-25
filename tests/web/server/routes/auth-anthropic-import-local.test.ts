import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigSet = vi.fn();
const mockSaveOAuthConfig = vi.fn();
const mockImportOfficialClaudeCodeAuth = vi.fn();

vi.mock('../../../../src/config/index.js', () => ({
  configManager: {
    set: (...args: any[]) => mockConfigSet(...args),
    get: vi.fn(),
    getAll: vi.fn(() => ({})),
    getConfigPaths: vi.fn(() => ({ userSettings: '/tmp/settings.json' })),
  },
}));

vi.mock('../../../../src/web/server/oauth-manager.js', () => ({
  oauthManager: {
    saveOAuthConfig: (...args: any[]) => mockSaveOAuthConfig(...args),
    getOAuthConfig: vi.fn(() => null),
  },
}));

vi.mock('../../../../src/web/server/codex-auth-manager.js', () => ({
  CODEX_OAUTH_CONFIG: { redirectUri: 'http://localhost:1455/auth/callback' },
  codexAuthManager: {
    generatePkcePair: vi.fn(),
    buildAuthorizationUrl: vi.fn(),
    getAuthConfig: vi.fn(),
    clearAuthConfig: vi.fn(),
  },
}));

vi.mock('../../../../src/web/server/web-auth.js', () => ({
  webAuth: {
    getStatus: vi.fn(() => ({ authenticated: false, type: 'none', provider: 'anthropic' })),
    getOAuthStatus: vi.fn(() => ({ authenticated: false })),
    getCodexStatus: vi.fn(() => ({ authenticated: false })),
    ensureValidToken: vi.fn(),
    isAxonCloudUser: vi.fn(() => false),
    activateCodexLogin: vi.fn(),
    clearAll: vi.fn(),
    validateApiKey: vi.fn(),
    saveApiKeyLogin: vi.fn(),
  },
}));

vi.mock('../../../../src/auth/index.js', () => ({
  OAUTH_ENDPOINTS: {
    'claude.ai': {
      clientId: 'test-client-id',
      authorizationEndpoint: 'https://claude.ai/oauth/authorize',
      tokenEndpoint: 'https://platform.claude.com/v1/oauth/token',
      redirectUri: 'https://platform.claude.com/oauth/code/callback',
      scope: ['user:profile', 'user:inference'],
    },
    console: {
      clientId: 'test-client-id',
      authorizationEndpoint: 'https://platform.claude.com/oauth/authorize',
      tokenEndpoint: 'https://platform.claude.com/v1/oauth/token',
      redirectUri: 'https://platform.claude.com/oauth/code/callback',
      scope: ['org:create_api_key', 'user:profile'],
    },
  },
  exchangeAuthorizationCode: vi.fn(),
  createOAuthApiKey: vi.fn(),
  importOfficialClaudeCodeAuth: (...args: any[]) => mockImportOfficialClaudeCodeAuth(...args),
}));

vi.mock('../../../../src/utils/env-check.js', () => ({
  isDemoMode: vi.fn(() => false),
}));

import express from 'express';

async function driveRoute(app: express.Express, method: 'post' | 'get', path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
      body: body || {},
      params: {} as Record<string, string>,
      headers: { 'content-type': 'application/json' },
    };

    const mockReq = Object.assign(
      new (require('stream').Readable)(),
      req,
      {
        read() { return null; },
      }
    ) as any;

    const mockRes = Object.assign(
      new (require('stream').Writable)(),
      {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        setHeader(name: string, value: string) { this._headers[name.toLowerCase()] = value; },
        getHeader(name: string) { return this._headers[name.toLowerCase()]; },
        writeHead(code: number, headers?: any) {
          this.statusCode = code;
          if (headers) Object.assign(this._headers, headers);
        },
        end(data?: string) {
          if (data) {
            try {
              resolve({ status: this.statusCode, body: JSON.parse(data) });
            } catch {
              resolve({ status: this.statusCode, body: data });
            }
          }
        },
        write() { return true; },
        status(code: number) { this.statusCode = code; return this; },
        json(data: any) { resolve({ status: this.statusCode, body: data }); },
      }
    ) as any;

    app.handle(mockReq, mockRes, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

describe('Anthropic import-local route', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockImportOfficialClaudeCodeAuth.mockReset();

    const authModule = await import('../../../../src/web/server/routes/auth.js');
    app = express();
    app.use(express.json());
    app.use('/api/auth/oauth', authModule.default);
  });

  it('imports local Claude Code auth and activates claude-subscription runtime', async () => {
    mockImportOfficialClaudeCodeAuth.mockReturnValueOnce({
      accountType: 'claude.ai',
      accessToken: 'claude-local-access',
      refreshToken: 'claude-local-refresh',
      expiresAt: 1_710_000_000_000,
      scopes: ['user:profile', 'user:inference', 'user:sessions:claude_code'],
      subscriptionType: 'pro',
      rateLimitTier: 'default_claude_max_5x',
      source: 'file',
      sourcePath: 'C:/Users/test/.claude/.credentials.json',
    });

    const result = await driveRoute(app, 'post', '/api/auth/oauth/import-local');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.auth).toEqual({
      accountType: 'pro',
      expiresAt: 1_710_000_000_000,
      scopes: ['user:profile', 'user:inference', 'user:sessions:claude_code'],
      source: 'file',
    });

    expect(mockSaveOAuthConfig).toHaveBeenCalledWith({
      accessToken: 'claude-local-access',
      refreshToken: 'claude-local-refresh',
      expiresAt: 1_710_000_000_000,
      scopes: ['user:profile', 'user:inference', 'user:sessions:claude_code'],
      subscriptionType: 'pro',
      rateLimitTier: 'default_claude_max_5x',
    });
    expect(mockConfigSet).toHaveBeenCalledWith('authPriority', 'oauth');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeBackend', 'claude-subscription');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeProvider', 'anthropic');
    expect(mockConfigSet).toHaveBeenCalledWith('apiProvider', 'anthropic');
  });
});
