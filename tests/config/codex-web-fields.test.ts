import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '../../src/config/index.js';

describe('ConfigManager Codex web fields', () => {
  const tempRoot = path.join(os.tmpdir(), `claude-codex-config-${process.pid}`);
  const configDir = path.join(tempRoot, 'global');
  const projectDir = path.join(tempRoot, 'project');
  const settingsPath = path.join(configDir, 'settings.json');
  const originalConfigDir = process.env.AXON_CONFIG_DIR;
  const originalCwd = process.cwd();

  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.AXON_CONFIG_DIR = configDir;
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (originalConfigDir) {
      process.env.AXON_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AXON_CONFIG_DIR;
    }
  });

  it('should load runtimeProvider and codexAccount without unknown field warnings', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      runtimeProvider: 'codex',
      authPriority: 'oauth',
      customModelName: 'gpt-5-codex',
      codexAccount: {
        accessToken: 'chatgpt-token',
        accountId: 'acct_123',
      },
    }), 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new ConfigManager({ workingDirectory: projectDir });
    const config = manager.getAll() as any;

    expect(config.runtimeProvider).toBe('codex');
    expect(config.customModelName).toBe('gpt-5-codex');
    expect(config.codexAccount).toMatchObject({
      accessToken: 'chatgpt-token',
      accountId: 'acct_123',
    });
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('Unknown fields in settings.json')
      )
    ).toBe(false);
  });

  it('should load openai-compatible runtime fields without validation errors', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      apiProvider: 'openai-compatible',
      runtimeProvider: 'codex',
      runtimeBackend: 'openai-compatible-api',
      customModelName: 'gpt-5.4',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.4',
        'claude-subscription': 'sonnet',
      },
      customModelCatalogByBackend: {
        'openai-compatible-api': ['gpt-5.4', 'gpt-5.4-mini'],
      },
    }), 'utf-8');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new ConfigManager({ workingDirectory: projectDir });
    const config = manager.getAll() as any;

    expect(config.apiProvider).toBe('openai-compatible');
    expect(config.runtimeBackend).toBe('openai-compatible-api');
    expect(config.defaultModelByBackend).toEqual({
      'openai-compatible-api': 'gpt-5.4',
      'claude-subscription': 'sonnet',
    });
    expect(config.customModelCatalogByBackend).toEqual({
      'openai-compatible-api': ['gpt-5.4', 'gpt-5.4-mini'],
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('Unknown fields in settings.json')
      )
    ).toBe(false);
  });

  it('should save openai-compatible runtime fields through ConfigManager', () => {
    const manager = new ConfigManager({ workingDirectory: projectDir });

    manager.save({
      apiProvider: 'openai-compatible',
      runtimeProvider: 'codex',
      runtimeBackend: 'openai-compatible-api',
      customModelName: 'gpt-5.3-codex',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.3-codex',
      },
      customModelCatalogByBackend: {
        'openai-compatible-api': ['gpt-5.4', 'gpt-5.3-codex'],
      },
    } as any);

    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(saved.apiProvider).toBe('openai-compatible');
    expect(saved.runtimeBackend).toBe('openai-compatible-api');
    expect(saved.defaultModelByBackend).toEqual({
      'openai-compatible-api': 'gpt-5.3-codex',
    });
    expect(saved.customModelCatalogByBackend).toEqual({
      'openai-compatible-api': ['gpt-5.4', 'gpt-5.3-codex'],
    });
  });
});
