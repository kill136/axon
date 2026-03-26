import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigSet = vi.fn();
const mockConfigSave = vi.fn();
const mockConfigGetAll = vi.fn();
const mockImportOfficialAuthFile = vi.fn();
const mockImportOfficialConfigFile = vi.fn();
const mockActivateCodexLogin = vi.fn();
const mockImportOfficialClaudeCodeAuth = vi.fn();

vi.mock('../../../../src/config/index.js', () => ({
  configManager: {
    set: (...args: any[]) => mockConfigSet(...args),
    save: (...args: any[]) => mockConfigSave(...args),
    get: vi.fn(),
    getAll: (...args: any[]) => mockConfigGetAll(...args),
    getConfigPaths: vi.fn(() => ({ userSettings: '/tmp/settings.json' })),
  },
}));

vi.mock('../../../../src/web/server/oauth-manager.js', () => ({
  oauthManager: {
    saveOAuthConfig: vi.fn(),
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
    importOfficialAuthFile: (...args: any[]) => mockImportOfficialAuthFile(...args),
    importOfficialConfigFile: (...args: any[]) => mockImportOfficialConfigFile(...args),
  },
}));

vi.mock('../../../../src/web/server/web-auth.js', () => ({
  webAuth: {
    getStatus: vi.fn(() => ({ authenticated: false, type: 'none', provider: 'anthropic' })),
    getOAuthStatus: vi.fn(() => ({ authenticated: false })),
    getCodexStatus: vi.fn(() => ({ authenticated: false })),
    ensureValidToken: vi.fn(),
    isAxonCloudUser: vi.fn(() => false),
    activateCodexLogin: (...args: any[]) => mockActivateCodexLogin(...args),
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

describe('Codex import-local route', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockImportOfficialClaudeCodeAuth.mockReset();

    mockConfigGetAll.mockReturnValue({
      defaultModelByBackend: {
        'claude-subscription': 'sonnet',
      },
    });

    const authModule = await import('../../../../src/web/server/routes/auth.js');
    app = express();
    app.use(express.json());
    app.use('/api/auth/oauth', authModule.default);
  });

  it('should import auth.json and config.toml together', async () => {
    mockImportOfficialAuthFile.mockResolvedValueOnce({
      apiKey: 'sk-codex-local',
      authMethod: 'api_key',
      accountId: 'acct_local',
    });
    mockImportOfficialConfigFile.mockReturnValueOnce({
      apiBaseUrl: 'https://proxy.example.com/v1',
      customModelName: 'gpt-5.4',
      defaultModelByBackend: {
        'codex-subscription': 'gpt-5.4',
      },
      modelProvider: 'yuncode',
      wireApi: 'responses',
    });

    const result = await driveRoute(app, 'post', '/api/auth/oauth/codex/import-local');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(mockImportOfficialAuthFile).toHaveBeenCalledTimes(1);
    expect(mockImportOfficialConfigFile).toHaveBeenCalledTimes(1);
    expect(mockActivateCodexLogin).toHaveBeenCalledWith({
      apiKey: 'sk-codex-local',
      authMethod: 'api_key',
      accountId: 'acct_local',
    });
    expect(mockConfigSave).toHaveBeenCalledWith({
      apiProvider: 'openai-compatible',
      apiBaseUrl: 'https://proxy.example.com/v1',
      customModelName: 'gpt-5.4',
      defaultModelByBackend: {
        'claude-subscription': 'sonnet',
        'codex-subscription': 'gpt-5.4',
      },
    });
    expect(result.body.importedConfig).toEqual({
      apiBaseUrl: 'https://proxy.example.com/v1',
      customModelName: 'gpt-5.4',
      modelProvider: 'yuncode',
      wireApi: 'responses',
    });
  });
});
