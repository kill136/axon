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
});
