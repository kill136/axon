/**
 * OAuth submit-code route test
 * Verifies that Console / Claude.ai OAuth login correctly sets
 * authPriority, runtimeBackend, and runtimeProvider in settings.
 *
 * Uses mock express req/res to avoid supertest dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Track configManager.set calls
const mockConfigSet = vi.fn();

const mockSaveOAuthConfig = vi.fn();
const mockExchangeAuthorizationCode = vi.fn();
const mockCreateOAuthApiKey = vi.fn();
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
  exchangeAuthorizationCode: (...args: any[]) => mockExchangeAuthorizationCode(...args),
  createOAuthApiKey: (...args: any[]) => mockCreateOAuthApiKey(...args),
  importOfficialClaudeCodeAuth: (...args: any[]) => mockImportOfficialClaudeCodeAuth(...args),
}));

vi.mock('../../../../src/utils/env-check.js', () => ({
  isDemoMode: vi.fn(() => false),
}));

// Helper: create express-like mock req/res and drive a route handler
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

    // Extract route params (e.g. /status/:authId)
    // Simple implementation for our test paths
    const pathParts = path.split('/');

    let statusCode = 200;
    let responseBody: any = {};

    const res = {
      status(code: number) { statusCode = code; return this; },
      json(data: any) { responseBody = data; resolve({ status: statusCode, body: responseBody }); },
    };

    // Use express app directly
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

describe('OAuth submit-code sets authPriority and runtimeBackend', () => {
  let app: express.Express;

  beforeEach(async () => {
    mockConfigSet.mockClear();
    mockSaveOAuthConfig.mockClear();
    mockExchangeAuthorizationCode.mockReset();
    mockCreateOAuthApiKey.mockReset();
    mockImportOfficialClaudeCodeAuth.mockReset();

    vi.resetModules();

    const authModule = await import('../../../../src/web/server/routes/auth.js');
    app = express();
    app.use(express.json());
    app.use('/api/auth/oauth', authModule.default);
  });

  it('sets runtimeBackend=claude-subscription after Claude.ai OAuth login', async () => {
    // Step 1: Start OAuth to create a session in memory
    const startRes = await driveRoute(app, 'post', '/api/auth/oauth/start', { accountType: 'claude.ai' });
    expect(startRes.status).toBe(200);
    const { authId } = startRes.body;
    expect(authId).toBeTruthy();

    // Step 2: Mock token exchange
    mockExchangeAuthorizationCode.mockResolvedValueOnce({
      access_token: 'claude-ai-token',
      refresh_token: 'claude-ai-refresh',
      expires_in: 3600,
      scope: 'user:profile user:inference',
    });

    // Step 3: Submit code
    const submitRes = await driveRoute(app, 'post', '/api/auth/oauth/submit-code', {
      authId,
      code: 'test-auth-code',
    });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.success).toBe(true);

    // Core assertion: configManager.set must be called to activate OAuth
    expect(mockConfigSet).toHaveBeenCalledWith('authPriority', 'oauth');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeBackend', 'claude-subscription');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeProvider', 'anthropic');

    // oauthManager.saveOAuthConfig must have the correct subscriptionType
    expect(mockSaveOAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'claude-ai-token',
        subscriptionType: 'claude.ai',
      })
    );
  });

  it('sets runtimeBackend=claude-compatible-api after Console OAuth login and calls createOAuthApiKey', async () => {
    const startRes = await driveRoute(app, 'post', '/api/auth/oauth/start', { accountType: 'console' });
    expect(startRes.status).toBe(200);
    const { authId } = startRes.body;

    // Console token: no user:inference scope
    mockExchangeAuthorizationCode.mockResolvedValueOnce({
      access_token: 'console-token',
      refresh_token: 'console-refresh',
      expires_in: 3600,
      scope: 'org:create_api_key user:profile',
    });
    mockCreateOAuthApiKey.mockResolvedValueOnce('sk-ant-oauthkey-test');

    const submitRes = await driveRoute(app, 'post', '/api/auth/oauth/submit-code', {
      authId,
      code: 'console-code',
    });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.success).toBe(true);

    // createOAuthApiKey should have been called for console (no user:inference)
    expect(mockCreateOAuthApiKey).toHaveBeenCalledWith('console-token');

    // oauthManager should save with oauthApiKey
    expect(mockSaveOAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'console-token',
        subscriptionType: 'console',
        oauthApiKey: 'sk-ant-oauthkey-test',
      })
    );

    // Must activate OAuth login in config
    expect(mockConfigSet).toHaveBeenCalledWith('authPriority', 'oauth');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeBackend', 'claude-compatible-api');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeProvider', 'anthropic');
    expect(mockConfigSet).toHaveBeenCalledWith('apiProvider', 'anthropic');
  });

  it('still activates OAuth login even if createOAuthApiKey returns null', async () => {
    const startRes = await driveRoute(app, 'post', '/api/auth/oauth/start', { accountType: 'console' });
    const { authId } = startRes.body;

    mockExchangeAuthorizationCode.mockResolvedValueOnce({
      access_token: 'console-token',
      refresh_token: 'console-refresh',
      expires_in: 3600,
      scope: 'org:create_api_key user:profile',
    });
    // API key creation fails
    mockCreateOAuthApiKey.mockResolvedValueOnce(null);

    const submitRes = await driveRoute(app, 'post', '/api/auth/oauth/submit-code', {
      authId,
      code: 'console-code',
    });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.success).toBe(true);

    // OAuth login should still be activated even with failed API key creation
    expect(mockConfigSet).toHaveBeenCalledWith('authPriority', 'oauth');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeBackend', 'claude-compatible-api');
  });
});
