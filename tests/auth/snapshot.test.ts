/**
 * snapshotAuthCredentials 统一认证快照测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MOCK_SETTINGS_PATH = path.join(os.tmpdir(), `axon-test-snapshot-${process.pid}.json`);

// Mock configManager — getConfigPaths 返回临时路径
const mockGetConfigPaths = vi.fn().mockReturnValue({ userSettings: MOCK_SETTINGS_PATH });
const mockGetAll = vi.fn().mockReturnValue({});

vi.mock('../../src/config/index.js', () => ({
  configManager: {
    getConfigPaths: (...args: any[]) => mockGetConfigPaths(...args),
    getAll: (...args: any[]) => mockGetAll(...args),
  },
}));

// Mock CLI auth
const mockInitAuth = vi.fn();
const mockGetAuth = vi.fn().mockReturnValue(null);

vi.mock('../../src/auth/index.js', () => ({
  initAuth: (...args: any[]) => mockInitAuth(...args),
  getAuth: (...args: any[]) => mockGetAuth(...args),
}));

import { snapshotAuthCredentials } from '../../src/auth/snapshot.js';

/** 写临时 settings.json */
function writeSettings(obj: Record<string, unknown>): void {
  fs.writeFileSync(MOCK_SETTINGS_PATH, JSON.stringify(obj), 'utf-8');
}

/** 删除临时 settings.json */
function removeSettings(): void {
  try { fs.unlinkSync(MOCK_SETTINGS_PATH); } catch { /* ok */ }
}

describe('snapshotAuthCredentials', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockGetConfigPaths.mockReturnValue({ userSettings: MOCK_SETTINGS_PATH });
    mockGetAll.mockReturnValue({});
    mockInitAuth.mockReset();
    mockGetAuth.mockReturnValue(null);
    removeSettings();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXON_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  });

  afterEach(() => {
    removeSettings();
    process.env = { ...originalEnv };
  });

  // ===== 来源 1: settings.json =====

  it('应从 settings.json 中的 apiKey 读取（Web UI 场景）', () => {
    writeSettings({
      apiKey: 'sk-ant-test-key-from-settings',
      apiBaseUrl: 'https://custom-api.example.com',
    });

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      apiKey: 'sk-ant-test-key-from-settings',
      baseUrl: 'https://custom-api.example.com',
    });
  });

  it('应从 settings.json 的 OAuth 配置读取（authPriority=oauth）', () => {
    writeSettings({ authPriority: 'oauth' });
    mockGetAll.mockReturnValue({
      oauthAccount: {
        accessToken: 'oauth-token-123',
        scopes: ['user:inference'],
      },
    });

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      authToken: 'oauth-token-123',
    });
  });

  it('auto 模式下 apiKey 优先于 OAuth', () => {
    writeSettings({
      apiKey: 'sk-ant-api-key',
      authPriority: 'auto',
    });
    mockGetAll.mockReturnValue({
      oauthAccount: {
        accessToken: 'oauth-token',
        scopes: ['user:inference'],
      },
    });

    const result = snapshotAuthCredentials();

    expect(result?.apiKey).toBe('sk-ant-api-key');
    expect(result?.authToken).toBeUndefined();
  });

  it('auto 模式下没有 apiKey 时回退到 OAuth', () => {
    writeSettings({ authPriority: 'auto' });
    mockGetAll.mockReturnValue({
      oauthAccount: {
        accessToken: 'oauth-token-456',
        scopes: ['user:inference'],
      },
    });

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      authToken: 'oauth-token-456',
    });
  });

  it('OAuth oauthApiKey（无 inference scope）时使用 apiKey', () => {
    writeSettings({ authPriority: 'oauth' });
    mockGetAll.mockReturnValue({
      oauthAccount: {
        accessToken: 'token-no-inference',
        scopes: ['org:create_api_key'],
        oauthApiKey: 'sk-oauth-created-key',
      },
    });

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      apiKey: 'sk-oauth-created-key',
    });
  });

  // ===== 来源 2: 环境变量 =====

  it('settings.json 无凭证时回退到环境变量 ANTHROPIC_API_KEY', () => {
    writeSettings({});
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';
    process.env.ANTHROPIC_BASE_URL = 'https://env-base.example.com';

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      apiKey: 'sk-env-key',
      baseUrl: 'https://env-base.example.com',
    });
  });

  it('settings.json 不存在时回退到环境变量 AXON_API_KEY', () => {
    process.env.AXON_API_KEY = 'sk-axon-key';

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      apiKey: 'sk-axon-key',
      baseUrl: undefined,
    });
  });

  // ===== 来源 3: CLI auth =====

  it('所有来源都无凭证时回退到 CLI auth（initAuth/getAuth）', () => {
    mockGetAuth.mockReturnValue({
      type: 'api_key',
      apiKey: 'sk-cli-keychain-key',
    });

    const result = snapshotAuthCredentials();

    expect(mockInitAuth).toHaveBeenCalled();
    expect(result).toEqual({
      apiKey: 'sk-cli-keychain-key',
      baseUrl: undefined,
    });
  });

  it('CLI auth 返回 OAuth token 时正确处理', () => {
    mockGetAuth.mockReturnValue({
      type: 'oauth',
      authToken: 'cli-oauth-token',
    });

    const result = snapshotAuthCredentials();

    expect(result).toEqual({
      authToken: 'cli-oauth-token',
      baseUrl: undefined,
    });
  });

  // ===== 边界情况 =====

  it('所有来源都失败时返回 undefined', () => {
    mockGetAuth.mockReturnValue(null);

    const result = snapshotAuthCredentials();

    expect(result).toBeUndefined();
  });
});
