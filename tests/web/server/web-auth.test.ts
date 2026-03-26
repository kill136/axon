import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetConfigPaths = vi.fn();
const mockConfigGet = vi.fn();
const mockConfigSet = vi.fn();
const mockGetOAuthConfig = vi.fn();
const mockIsOAuthExpired = vi.fn();
const mockRefreshOAuthToken = vi.fn();
const mockClearOAuthConfig = vi.fn();
const mockGetCodexAuthConfig = vi.fn();
const mockIsCodexExpired = vi.fn();
const mockRefreshCodexToken = vi.fn();
const mockSaveCodexAuthConfig = vi.fn();
const mockClearCodexAuthConfig = vi.fn();

vi.mock('../../../src/config/index.js', () => ({
  configManager: {
    getConfigPaths: (...args: any[]) => mockGetConfigPaths(...args),
    get: (...args: any[]) => mockConfigGet(...args),
    set: (...args: any[]) => mockConfigSet(...args),
  },
}));

vi.mock('../../../src/web/server/oauth-manager.js', () => ({
  oauthManager: {
    getOAuthConfig: (...args: any[]) => mockGetOAuthConfig(...args),
    isTokenExpired: (...args: any[]) => mockIsOAuthExpired(...args),
    refreshToken: (...args: any[]) => mockRefreshOAuthToken(...args),
    clearOAuthConfig: (...args: any[]) => mockClearOAuthConfig(...args),
  },
}));

vi.mock('../../../src/web/server/codex-auth-manager.js', () => ({
  codexAuthManager: {
    getAuthConfig: (...args: any[]) => mockGetCodexAuthConfig(...args),
    isTokenExpired: (...args: any[]) => mockIsCodexExpired(...args),
    refreshToken: (...args: any[]) => mockRefreshCodexToken(...args),
    saveAuthConfig: (...args: any[]) => mockSaveCodexAuthConfig(...args),
    clearAuthConfig: (...args: any[]) => mockClearCodexAuthConfig(...args),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      create: vi.fn(),
    };
  },
}));

describe('webAuth Codex credentials', () => {
  const tempDir = path.join(os.tmpdir(), `claude-web-auth-${process.pid}`);
  const settingsPath = path.join(tempDir, 'settings.json');
  const originalCodexBaseUrl = process.env.OPENAI_CODEX_BASE_URL;

  beforeEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    mockGetConfigPaths.mockReturnValue({ userSettings: settingsPath });
    mockConfigGet.mockReturnValue(undefined);
    mockGetOAuthConfig.mockReturnValue(null);
    mockIsOAuthExpired.mockReturnValue(false);
    mockGetCodexAuthConfig.mockReset();
    mockIsCodexExpired.mockReturnValue(false);

    delete process.env.OPENAI_CODEX_BASE_URL;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();

    if (originalCodexBaseUrl) {
      process.env.OPENAI_CODEX_BASE_URL = originalCodexBaseUrl;
    } else {
      delete process.env.OPENAI_CODEX_BASE_URL;
    }
  });

  it('should ignore stale Anthropic baseUrl when runtime provider is codex', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
      apiBaseUrl: 'https://api.xiaomimimo.com/anthropic',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      accessToken: 'chatgpt-token',
      accountId: 'acct_123',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCredentials()).toEqual({
      authToken: 'chatgpt-token',
      accountId: 'acct_123',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: undefined,
    });
  });

  it('should prefer OPENAI_CODEX_BASE_URL when provided', async () => {
    process.env.OPENAI_CODEX_BASE_URL = 'https://proxy.example.com/backend-api/codex/';
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      accessToken: 'chatgpt-token',
      accountId: 'acct_456',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCredentials().baseUrl).toBe('https://proxy.example.com/backend-api/codex');
    expect(webAuth.getCodexBaseUrl()).toBe('https://proxy.example.com/backend-api/codex');
  });

  it('should use OpenAI v1 baseUrl and apiKey for Codex API key auth', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      apiKey: 'sk-codex-local',
      authMethod: 'api_key',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCredentials()).toEqual({
      apiKey: 'sk-codex-local',
      authToken: undefined,
      accountId: undefined,
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(webAuth.getCodexBaseUrl()).toBe('https://api.openai.com/v1');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'oauth',
      provider: 'codex',
      runtimeBackend: 'codex-subscription',
    });
    expect(webAuth.getTokenStatus()).toEqual({
      type: 'api_key',
      valid: true,
    });
    expect(webAuth.getCodexStatus()).toEqual({
      authenticated: true,
      displayName: 'API Key',
      email: undefined,
      accountId: undefined,
      expiresAt: undefined,
    });
  });

  it('should allow OpenAI-compatible /v1 baseUrl overrides for Codex API key auth', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
      apiBaseUrl: 'https://proxy.example.com/v1/',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      apiKey: 'sk-codex-local',
      authMethod: 'api_key',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCodexBaseUrl()).toBe('https://proxy.example.com/v1');
  });

  it('should ignore stale customModelName values that are not Codex-compatible', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
      customModelName: 'mimo-v2-pro',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      accessToken: 'chatgpt-token',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCodexModelName()).toBeUndefined();
  });

  it('should fall back to official Codex baseUrl for hostname-only codex URLs', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
      apiBaseUrl: 'https://codex.mydomain.com',
    }), 'utf-8');

    mockGetCodexAuthConfig.mockReturnValue({
      accessToken: 'chatgpt-token',
      accountId: 'acct_custom',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getCodexBaseUrl()).toBe('https://chatgpt.com/backend-api/codex');
  });

  it('should activate Codex login and report oauth status without apiKey', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'anthropic',
      authPriority: 'auto',
    }), 'utf-8');
    mockConfigSet.mockImplementation((key: string, value: unknown) => {
      const current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      current[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(current), 'utf-8');
    });

    mockGetCodexAuthConfig.mockReturnValue({
      accessToken: 'chatgpt-token',
      accountId: 'acct_oauth',
      email: 'codex@example.com',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    await webAuth.activateCodexLogin({
      accessToken: 'chatgpt-token',
      accountId: 'acct_oauth',
    });

    expect(mockSaveCodexAuthConfig).toHaveBeenCalledWith({
      accessToken: 'chatgpt-token',
      accountId: 'acct_oauth',
    });
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeProvider', 'codex');
    expect(mockConfigSet).toHaveBeenCalledWith('runtimeBackend', 'codex-subscription');
    expect(mockConfigSet).toHaveBeenCalledWith('authPriority', 'oauth');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'oauth',
      provider: 'codex',
      runtimeBackend: 'codex-subscription',
    });
  });

  it('should infer claude-subscription backend from legacy oauth settings', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'anthropic',
      authPriority: 'oauth',
      customModelName: 'sonnet',
    }), 'utf-8');

    mockGetOAuthConfig.mockReturnValue({
      accessToken: 'anthropic-oauth-token',
      scopes: ['user:inference'],
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeBackend()).toBe('claude-subscription');
    expect(webAuth.getRuntimeProvider()).toBe('anthropic');
    expect(webAuth.getDefaultModelByBackend()).toEqual({
      'claude-subscription': 'sonnet',
    });
  });

  it('should infer openai-compatible backend from legacy codex api-key settings', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'apiKey',
      apiKey: 'sk-openai-test',
      customModelName: 'gpt-5.4',
    }), 'utf-8');

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeBackend()).toBe('openai-compatible-api');
    expect(webAuth.getRuntimeProvider()).toBe('codex');
    expect(webAuth.getCustomModelName()).toBe('gpt-5.4');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'api_key',
      provider: 'openai-compatible',
      runtimeBackend: 'openai-compatible-api',
    });
  });

  it('should read per-backend model preferences for openai-compatible api mode', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'openai-compatible-api',
      runtimeProvider: 'anthropic',
      authPriority: 'apiKey',
      apiProvider: 'openai-compatible',
      apiKey: 'sk-test',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.4',
        'claude-subscription': 'sonnet',
      },
    }), 'utf-8');

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeBackend()).toBe('openai-compatible-api');
    expect(webAuth.getRuntimeProvider()).toBe('codex');
    expect(webAuth.getCustomModelName()).toBe('gpt-5.4');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'api_key',
      provider: 'openai-compatible',
      runtimeBackend: 'openai-compatible-api',
    });
  });

  it('should preserve arbitrary custom model ids for openai-compatible and axon-cloud backends', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'axon-cloud',
      runtimeProvider: 'anthropic',
      authPriority: 'apiKey',
      apiProvider: 'anthropic',
      apiKey: 'sk-axon',
      customModelName: 'kimi-k2.5',
      defaultModelByBackend: {
        'openai-compatible-api': 'deepseek-v3',
      },
    }), 'utf-8');

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeProvider()).toBe('codex');
    expect(webAuth.getCustomModelName()).toBe('kimi-k2.5');
    expect(webAuth.getDefaultModelByBackend()).toEqual({
      'openai-compatible-api': 'deepseek-v3',
      'axon-cloud': 'kimi-k2.5',
    });
  });

  it('should treat explicit axon-cloud runtime backend as axon cloud even on custom domains', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'axon-cloud',
      runtimeProvider: 'anthropic',
      authPriority: 'apiKey',
      apiProvider: 'anthropic',
      apiKey: 'sk-axon',
      apiBaseUrl: 'https://newapi.example.com',
    }), 'utf-8');

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.isAxonCloudUser()).toBe(true);
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'api_key',
      provider: 'axon-cloud',
      runtimeBackend: 'axon-cloud',
    });
  });

  it('should NOT use apiBaseUrl for claude-compatible-api when console OAuth is active', async () => {
    // Scenario: user had a proxy configured, then logs in via Console OAuth
    // OAuth credentials must go directly to api.anthropic.com, not the proxy
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'claude-compatible-api',
      runtimeProvider: 'anthropic',
      authPriority: 'oauth',
      apiBaseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-old-proxy-key',
    }), 'utf-8');

    mockGetOAuthConfig.mockReturnValue({
      accessToken: 'oauth-access-token',
      scopes: ['org:create_api_key', 'user:profile'],
      oauthApiKey: 'sk-ant-oauthkey-console',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    const creds = webAuth.getCredentials();

    // OAuth credentials should NOT include the proxy baseUrl
    expect(creds.baseUrl).toBeUndefined();
    // Should use the oauthApiKey, not the old proxy apiKey
    expect(creds.apiKey).toBe('sk-ant-oauthkey-console');
    expect(creds.authToken).toBeUndefined();
  });

  it('should infer claude-compatible-api backend from legacy console oauth settings', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'anthropic',
      authPriority: 'oauth',
    }), 'utf-8');

    mockGetOAuthConfig.mockReturnValue({
      accessToken: 'console-oauth-token',
      subscriptionType: 'console',
      scopes: ['org:create_api_key', 'user:profile'],
      oauthApiKey: 'sk-ant-oauthkey-console',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeBackend()).toBe('claude-compatible-api');
    expect(webAuth.getCredentials()).toEqual({
      apiKey: 'sk-ant-oauthkey-console',
      authToken: undefined,
    });
  });

  it('should migrate stale claude-subscription backend for console oauth accounts', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'claude-subscription',
      runtimeProvider: 'anthropic',
      authPriority: 'oauth',
    }), 'utf-8');

    mockGetOAuthConfig.mockReturnValue({
      accessToken: 'console-oauth-token',
      subscriptionType: 'console',
      scopes: ['org:create_api_key', 'user:profile'],
      oauthApiKey: 'sk-ant-oauthkey-console',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getRuntimeBackend()).toBe('claude-compatible-api');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'oauth',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });
  });

  it('should report anthropic provider for claude-compatible-api even if old openai config remains', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'claude-compatible-api',
      runtimeProvider: 'anthropic',
      authPriority: 'oauth',
      apiProvider: 'openai-compatible',
    }), 'utf-8');
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'apiProvider') return 'openai-compatible';
      return undefined;
    });
    mockGetOAuthConfig.mockReturnValue({
      accessToken: 'console-oauth-token',
      subscriptionType: 'console',
      scopes: ['org:create_api_key', 'user:profile'],
      oauthApiKey: 'sk-ant-oauthkey-console',
    });

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    expect(webAuth.getProvider()).toBe('anthropic');
    expect(webAuth.getStatus()).toEqual({
      authenticated: true,
      type: 'oauth',
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
    });
  });

  it('should use apiBaseUrl for claude-compatible-api backend', async () => {
    // Non-subscription backends should still use apiBaseUrl
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeBackend: 'claude-compatible-api',
      runtimeProvider: 'anthropic',
      authPriority: 'apiKey',
      apiBaseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-proxy-key',
    }), 'utf-8');

    const { webAuth } = await import('../../../src/web/server/web-auth.js');
    const creds = webAuth.getCredentials();

    expect(creds.baseUrl).toBe('https://proxy.example.com/v1');
    expect(creds.apiKey).toBe('sk-proxy-key');
  });
});
