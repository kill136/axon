import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockConfigGetAll = vi.fn();
const mockConfigSet = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

vi.mock('../../../src/config/index.js', () => ({
  configManager: {
    getAll: (...args: any[]) => mockConfigGetAll(...args),
    set: (...args: any[]) => mockConfigSet(...args),
  },
}));

import { CODEX_OAUTH_CONFIG, CodexAuthManager } from '../../../src/web/server/codex-auth-manager.js';

describe('CodexAuthManager', () => {
  let storedConfig: Record<string, any>;

  beforeEach(() => {
    storedConfig = {};
    mockConfigGetAll.mockImplementation(() => storedConfig);
    mockConfigSet.mockImplementation((key: string, value: unknown) => {
      storedConfig = {
        ...storedConfig,
        [key]: value,
      };
    });
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should generate PKCE verifier and challenge', () => {
    const manager = new CodexAuthManager();
    const { codeVerifier, codeChallenge } = manager.generatePkcePair();

    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(codeVerifier).not.toBe(codeChallenge);
  });

  it('should build the official Codex authorization URL', () => {
    const manager = new CodexAuthManager();
    const url = new URL(manager.buildAuthorizationUrl('state-123', 'challenge-456'));

    expect(url.origin + url.pathname).toBe(CODEX_OAUTH_CONFIG.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe(CODEX_OAUTH_CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CODEX_OAUTH_CONFIG.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-456');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
  });

  it('should import OPENAI_API_KEY credentials from auth.json', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      OPENAI_API_KEY: 'sk-codex-local',
    }));

    const manager = new CodexAuthManager();
    const config = await manager.importOfficialAuthFile();

    expect(config).toEqual({
      apiKey: 'sk-codex-local',
      accessToken: undefined,
      refreshToken: undefined,
      idToken: undefined,
      accountId: undefined,
      email: undefined,
      displayName: undefined,
      expiresAt: undefined,
      authMethod: 'api_key',
      source: 'imported',
    });
    expect(mockConfigSet).toHaveBeenCalledWith('codexAccount', expect.objectContaining({
      apiKey: 'sk-codex-local',
      authMethod: 'api_key',
      source: 'imported',
    }));
    expect(manager.isTokenExpired()).toBe(false);
  });

  it('should import model and provider baseUrl from config.toml', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('config.toml'));
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('config.toml')) {
        return `
model = "gpt-5.4"
model_provider = "yuncode"

[model_providers.yuncode]
base_url = "https://proxy.example.com/v1/"
wire_api = "responses"
`;
      }
      return '';
    });

    const manager = new CodexAuthManager();
    expect(manager.importOfficialConfigFile()).toEqual({
      apiBaseUrl: 'https://proxy.example.com/v1',
      customModelName: 'gpt-5.4',
      defaultModelByBackend: {
        'codex-subscription': 'gpt-5.4',
      },
      modelProvider: 'yuncode',
      wireApi: 'responses',
    });
  });
});
