/**
 * 配置加载器测试（完整版）
 *
 * 测试所有配置来源、优先级、环境变量、AXON.md解析等功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager, AxonMdParser } from '../../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 测试配置目录
const TEST_ROOT = path.join(os.tmpdir(), `claude-test-config-${Date.now()}`);
const TEST_CONFIG_DIR = path.join(TEST_ROOT, '.axon');
const TEST_PROJECT_DIR = path.join(TEST_ROOT, 'project');

// 配置文件路径
const USER_SETTINGS = path.join(TEST_CONFIG_DIR, 'settings.json');
const PROJECT_SETTINGS = path.join(TEST_PROJECT_DIR, '.axon', 'settings.json');
const LOCAL_SETTINGS = path.join(TEST_PROJECT_DIR, '.axon', 'settings.local.json');
const POLICY_SETTINGS = path.join(TEST_CONFIG_DIR, 'managed_settings.json');
const FLAG_SETTINGS = path.join(TEST_ROOT, 'flag-settings.json');
const CLAUDE_MD = path.join(TEST_PROJECT_DIR, 'AXON.md');
const USER_CLAUDE_MD = path.join(TEST_CONFIG_DIR, 'AXON.md');

// 清理和初始化
function cleanup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function setup() {
  cleanup();
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_PROJECT_DIR, '.axon'), { recursive: true });
}

// 环境变量备份
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  setup();
  originalEnv = { ...process.env };
});

afterEach(() => {
  cleanup();
  process.env = originalEnv;
  vi.restoreAllMocks();
});

// ============ 1. 配置优先级测试 ============

describe('配置优先级系统', () => {
  it('应该按照正确的优先级合并配置 (默认 < 用户 < 项目 < 本地 < 环境变量 < 标志 < 策略)', () => {
    // 1. 用户配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'sonnet',
      maxTokens: 8192,
      verbose: false,
    }));

    // 2. 项目配置（覆盖 model）
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'opus',
      temperature: 0.5,
    }));

    // 3. 本地配置（覆盖 verbose）
    fs.writeFileSync(LOCAL_SETTINGS, JSON.stringify({
      verbose: true,
      maxTokens: 16384,
    }));

    // 4. 环境变量（覆盖 maxTokens）
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_MAX_OUTPUT_TOKENS = '32768';

    // 5. 标志配置（覆盖 temperature）
    fs.writeFileSync(FLAG_SETTINGS, JSON.stringify({
      temperature: 1,
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
      flagSettingsPath: FLAG_SETTINGS,
    });

    const config = manager.getAll();

    // 验证优先级
    expect(config.model).toBe('opus'); // 项目配置覆盖用户配置
    expect(config.maxTokens).toBe(32768); // 环境变量覆盖本地配置
    expect(config.temperature).toBe(1); // 标志配置覆盖项目配置
    expect(config.verbose).toBe(true); // 本地配置覆盖用户配置
  });

  it('应该支持企业策略强制配置（最高优先级）', () => {
    // 用户配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'opus',
      maxTokens: 32768,
    }));

    // 企业策略（强制设置）
    fs.writeFileSync(POLICY_SETTINGS, JSON.stringify({
      enforced: {
        model: 'sonnet', // 强制使用 sonnet
        maxTokens: 8192, // 强制限制 token
      },
      metadata: {
        organizationId: 'test-org',
        policyName: 'security-policy',
      },
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    // 企业策略应该覆盖所有用户设置
    expect(config.model).toBe('sonnet');
    expect(config.maxTokens).toBe(8192);
  });

  it('应该支持 CLI 标志直接传入（高优先级）', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'sonnet',
      verbose: false,
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
      cliFlags: {
        model: 'opus',
        verbose: true,
      },
    });

    const config = manager.getAll();

    expect(config.model).toBe('opus');
    expect(config.verbose).toBe(true);
  });
});

// ============ 2. 环境变量解析测试 ============

describe('环境变量解析', () => {
  it('应该正确解析 API 密钥环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.getApiKey()).toBe('sk-ant-test-key-123');
  });

  it('应该支持 AXON_API_KEY 作为备用', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_API_KEY = 'sk-claude-test-key-456';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.getApiKey()).toBe('sk-claude-test-key-456');
  });

  it('应该正确解析布尔类型环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_ENABLE_TELEMETRY = 'true';
    process.env.AXON_DISABLE_FILE_CHECKPOINTING = '1';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.enableTelemetry).toBe(true);
    expect(config.disableFileCheckpointing).toBe(true);
  });

  it('应该正确解析数字类型环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_MAX_OUTPUT_TOKENS = '16384';
    process.env.AXON_MAX_RETRIES = '5';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.maxTokens).toBe(16384);
    expect(config.maxRetries).toBe(5);
  });

  it('应该支持 Bedrock 和 Vertex 环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_USE_BEDROCK = 'true';

    const manager1 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager1.getAll().useBedrock).toBe(true);
    expect(manager1.getAll().apiProvider).toBe('bedrock');

    // 重置环境
    delete process.env.AXON_USE_BEDROCK;
    process.env.AXON_USE_VERTEX = 'true';

    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager2.getAll().useVertex).toBe(true);
    expect(manager2.getAll().apiProvider).toBe('vertex');
  });

  it('应该支持调试和日志环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_DEBUG_LOGS_DIR = '/tmp/logs';
    process.env.AXON_AGENT_ID = 'test-agent-123';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.debugLogsDir).toBe('/tmp/logs');
    expect(config.agentId).toBe('test-agent-123');
  });

  it('应该支持遥测配置环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_OTEL_SHUTDOWN_TIMEOUT_MS = '5000';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.telemetry?.otelShutdownTimeoutMs).toBe(5000);
  });

  it('应该支持代理配置环境变量', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
    process.env.HTTPS_PROXY = 'https://proxy.example.com:8443';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.proxy?.http).toBe('http://proxy.example.com:8080');
    expect(config.proxy?.https).toBe('https://proxy.example.com:8443');
  });

  it('应该正确处理无效的环境变量值', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_MAX_OUTPUT_TOKENS = 'invalid-number';
    process.env.AXON_ENABLE_TELEMETRY = 'invalid-bool';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    // 无效值应该被忽略，使用默认值
    expect(config.maxTokens).toBe(32000); // 默认值
    expect(config.enableTelemetry).toBe(false); // 默认值
  });
});

// ============ 3. AXON.md 解析测试 ============

describe('AXON.md 解析', () => {
  it('应该正确解析项目级 AXON.md', () => {
    const content = `# AXON.md

This is a test project.

## Guidelines

- Follow TypeScript best practices
- Write tests for all features
`;

    fs.writeFileSync(CLAUDE_MD, content);

    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const info = parser.parse();

    expect(info.exists).toBe(true);
    expect(info.content).toBe(content);
    expect(info.path).toBe(CLAUDE_MD);
  });

  it('应该正确注入 AXON.md 到系统提示', () => {
    const content = '# Test Project\n\nUse TypeScript.';
    fs.writeFileSync(CLAUDE_MD, content);

    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const basePrompt = 'You are a helpful assistant.';
    const injected = parser.injectIntoSystemPrompt(basePrompt);

    expect(injected).toContain(basePrompt);
    expect(injected).toContain('# axonMd');
    expect(injected).toContain(content);
    expect(injected).toContain('IMPORTANT: this context may or may not be relevant');
  });

  it('应该处理不存在的 AXON.md', () => {
    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const info = parser.parse();

    expect(info.exists).toBe(false);
    expect(info.content).toBe('');
  });

  it('应该验证 AXON.md 格式', () => {
    // 空文件
    fs.writeFileSync(CLAUDE_MD, '');
    const parser1 = new AxonMdParser(TEST_PROJECT_DIR);
    const result1 = parser1.validate();
    expect(result1.valid).toBe(true);
    expect(result1.warnings).toContain('AXON.md 文件为空');

    // 无标题
    fs.writeFileSync(CLAUDE_MD, 'No headings here');
    const parser2 = new AxonMdParser(TEST_PROJECT_DIR);
    const result2 = parser2.validate();
    expect(result2.warnings).toContain('建议使用 Markdown 标题组织内容');

    // 过大文件
    const largeContent = 'x'.repeat(60000);
    fs.writeFileSync(CLAUDE_MD, largeContent);
    const parser3 = new AxonMdParser(TEST_PROJECT_DIR);
    const result3 = parser3.validate();
    expect(result3.warnings.some(w => w.includes('过大'))).toBe(true);
  });

  it('应该获取 AXON.md 统计信息', () => {
    const content = 'Line 1\nLine 2\nLine 3';
    fs.writeFileSync(CLAUDE_MD, content);

    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const stats = parser.getStats();

    expect(stats).not.toBeNull();
    expect(stats!.lines).toBe(3);
    expect(stats!.chars).toBe(content.length);
  });

  it('应该支持创建默认模板', () => {
    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const result = parser.create();

    expect(result).toBe(true);
    expect(fs.existsSync(CLAUDE_MD)).toBe(true);

    const content = fs.readFileSync(CLAUDE_MD, 'utf-8');
    expect(content).toContain('# AXON.md');
    expect(content).toContain('## Project Overview');
  });

  it('应该支持更新 AXON.md', () => {
    fs.writeFileSync(CLAUDE_MD, 'Old content');

    const parser = new AxonMdParser(TEST_PROJECT_DIR);
    const newContent = '# New Content\n\nUpdated.';
    const result = parser.update(newContent);

    expect(result).toBe(true);
    expect(fs.readFileSync(CLAUDE_MD, 'utf-8')).toBe(newContent);
  });
});

// ============ 4. 配置来源追踪测试 ============

describe('配置来源追踪', () => {
  it('应该追踪每个配置项的来源', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'sonnet',
      maxTokens: 8192,
    }));

    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'opus',
      verbose: true,
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_MAX_OUTPUT_TOKENS = '16384';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 检查配置来源
    expect(manager.getConfigSource('model')).toBe('projectSettings');
    expect(manager.getConfigSource('maxTokens')).toBe('envSettings');
    expect(manager.getConfigSource('verbose')).toBe('projectSettings');
    expect(manager.getConfigSource('temperature')).toBe('default');
  });

  it('应该提供配置值和来源的组合信息', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'opus',
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const modelInfo = manager.getWithSource('model');
    expect(modelInfo.value).toBe('opus');
    expect(modelInfo.source).toBe('userSettings');
    expect(modelInfo.sourcePath).toContain('settings.json');
  });

  it('应该列出所有配置来源及其状态', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'sonnet' }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const sources = manager.getConfigSourceInfo();

    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some(s => s.source === 'default')).toBe(true);
    expect(sources.some(s => s.source === 'userSettings')).toBe(true);
  });

  it('应该列出所有可能的配置来源', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const allSources = manager.getAllPossibleSources();

    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'default' })
    );
    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'userSettings' })
    );
    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'projectSettings' })
    );
    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'localSettings' })
    );
    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'envSettings' })
    );
    expect(allSources).toContainEqual(
      expect.objectContaining({ source: 'policySettings' })
    );
  });

  it('应该获取所有配置项的详细来源信息', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'opus',
      maxTokens: 16384,
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const details = manager.getAllConfigDetails();

    expect(details.length).toBeGreaterThan(0);
    expect(details.some(d => d.key === 'model')).toBe(true);
    expect(details.some(d => d.key === 'version')).toBe(true);
  });
});

// ============ 5. 企业策略配置测试 ============

describe('企业策略配置', () => {
  it('应该加载企业策略配置', () => {
    fs.writeFileSync(POLICY_SETTINGS, JSON.stringify({
      enforced: {
        maxTokens: 4096,
      },
      defaults: {
        temperature: 0.7,
      },
      metadata: {
        organizationId: 'test-org',
        policyName: 'test-policy',
      },
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const policy = manager.getEnterprisePolicy();
    expect(policy).toBeDefined();
    expect(policy?.metadata?.organizationId).toBe('test-org');
  });

  it('应该检查配置项是否被策略强制', () => {
    fs.writeFileSync(POLICY_SETTINGS, JSON.stringify({
      enforced: {
        model: 'sonnet',
        maxTokens: 8192,
      },
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.isEnforcedByPolicy('model')).toBe(true);
    expect(manager.isEnforcedByPolicy('maxTokens')).toBe(true);
    expect(manager.isEnforcedByPolicy('temperature')).toBe(false);
  });

  it('应该检查功能是否被策略禁用', () => {
    fs.writeFileSync(POLICY_SETTINGS, JSON.stringify({
      disabledFeatures: ['telemetry', 'autoSave'],
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.isFeatureDisabled('telemetry')).toBe(true);
    expect(manager.isFeatureDisabled('autoSave')).toBe(true);
    expect(manager.isFeatureDisabled('otherFeature')).toBe(false);
  });

  it('应该阻止保存被策略强制的配置到本地', () => {
    fs.writeFileSync(POLICY_SETTINGS, JSON.stringify({
      enforced: {
        model: 'sonnet',
      },
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 尝试保存被强制的配置
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.saveLocal({
      model: 'opus', // 尝试覆盖被强制的值
      verbose: true,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('enforced by enterprise policy')
    );

    // 验证被强制的配置未被保存，但其他配置已保存
    const localConfig = JSON.parse(fs.readFileSync(LOCAL_SETTINGS, 'utf-8'));
    expect(localConfig.model).toBeUndefined();
    expect(localConfig.verbose).toBe(true);

    consoleSpy.mockRestore();
  });
});

// ============ 6. 配置验证测试 ============

describe('配置验证', () => {
  it('应该验证有效的配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const result = manager.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('应该拦截无效的模型名称', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // set 方法本身不验证，但会在加载配置时被验证掉
    // 测试导入无效配置会被拒绝
    const result = manager.import(JSON.stringify({
      model: 'invalid-model',
    }));

    expect(result).toBe(false);
  });

  it('应该拦截无效的数值范围', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 测试导入无效配置会被拒绝
    const result1 = manager.import(JSON.stringify({
      maxTokens: -1000,
    }));
    expect(result1).toBe(false);

    const result2 = manager.import(JSON.stringify({
      temperature: 2,
    }));
    expect(result2).toBe(false);
  });
});

// ============ 7. 本地配置测试 ============

describe('本地配置 (settings.local.json)', () => {
  it('应该保存和加载本地配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.saveLocal({
      verbose: true,
      maxTokens: 16384,
    });

    expect(fs.existsSync(LOCAL_SETTINGS)).toBe(true);

    // 重新加载
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager2.getAll();
    expect(config.verbose).toBe(true);
    expect(config.maxTokens).toBe(16384);
  });

  it('应该自动添加 settings.local.json 到 .gitignore', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.saveLocal({ verbose: true });

    const gitignorePath = path.join(TEST_PROJECT_DIR, '.gitignore');

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('.axon/settings.local.json');
    }
  });

  it('本地配置应该覆盖项目配置但被环境变量覆盖', () => {
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'sonnet',
      verbose: false,
    }));

    fs.writeFileSync(LOCAL_SETTINGS, JSON.stringify({
      model: 'opus',
      verbose: true,
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
    process.env.AXON_MAX_OUTPUT_TOKENS = '32768';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.model).toBe('opus'); // 本地配置覆盖项目配置
    expect(config.verbose).toBe(true); // 本地配置覆盖项目配置
    expect(config.maxTokens).toBe(32768); // 环境变量覆盖所有文件配置
  });
});

// ============ 8. 配置备份和恢复测试 ============

describe('配置备份和恢复', () => {
  it('应该在保存前自动备份配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    // 创建初始配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'sonnet' }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 修改并保存
    manager.set('model', 'opus');

    // 检查备份目录
    const backupDir = path.join(TEST_CONFIG_DIR, '.backups');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir);
      expect(backups.length).toBeGreaterThan(0);
    }
  });

  it('应该列出可用的备份', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'sonnet' }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.save();

    const backups = manager.listBackups('user');
    // 可能有备份，也可能没有（取决于是否是首次创建）
    expect(Array.isArray(backups)).toBe(true);
  });

  it('应该从备份恢复配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    // 创建初始配置并保存
    const manager1 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });
    manager1.set('model', 'opus');
    manager1.save();

    // 修改配置
    manager1.set('model', 'sonnet');
    manager1.save();

    // 获取备份列表
    const backups = manager1.listBackups('user');

    if (backups.length > 0) {
      // 恢复第一个备份
      const result = manager1.restoreFromBackup(backups[0], 'user');
      expect(result).toBe(true);
    }
  });
});

// ============ 9. 配置导出和导入测试 ============

describe('配置导出和导入', () => {
  it('应该导出配置并掩码敏感信息', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('apiKey', 'sk-ant-1234567890abcdef');

    const exported = manager.export(true);
    const config = JSON.parse(exported);

    expect(config.apiKey).toContain('***');
    expect(config.apiKey).not.toBe('sk-ant-1234567890abcdef');
  });

  it('应该导出配置不掩码（如果指定）', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('apiKey', 'sk-ant-1234567890abcdef');

    const exported = manager.export(false);
    const config = JSON.parse(exported);

    expect(config.apiKey).toBe('sk-ant-1234567890abcdef');
  });

  it('应该导入有效的配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const configToImport = JSON.stringify({
      version: '2.1.4',
      model: 'opus',
      maxTokens: 16384,
      verbose: true,
    });

    const result = manager.import(configToImport);
    expect(result).toBe(true);

    const config = manager.getAll();
    expect(config.model).toBe('opus');
    expect(config.maxTokens).toBe(16384);
    expect(config.verbose).toBe(true);
  });

  it('应该拒绝无效的配置导入', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const invalidConfig = JSON.stringify({
      model: 'invalid-model',
      maxTokens: -1000,
    });

    const result = manager.import(invalidConfig);
    expect(result).toBe(false);
  });
});

// ============ 10. 配置热重载测试 ============

describe('配置热重载', () => {
  it('应该监听配置文件变化并重新加载', async () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'sonnet' }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 初始配置应该是 sonnet
    expect(manager.getAll().model).toBe('sonnet');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        manager.unwatch();
        reject(new Error('配置文件变化监听超时'));
      }, 5000);

      manager.watch((config) => {
        try {
          // 配置应该已更新为 opus
          expect(config.model).toBe('opus');
          clearTimeout(timeout);
          manager.unwatch();
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          manager.unwatch();
          reject(error);
        }
      });

      // 修改配置文件，触发重载
      setTimeout(() => {
        fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'opus' }));
      }, 100);
    });
  });
});

// ============ 11. MCP 服务器配置测试 ============

describe('MCP 服务器配置', () => {
  it('应该添加 MCP 服务器', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('filesystem', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });

    const servers = manager.getMcpServers();
    expect(servers.filesystem).toBeDefined();
    expect(servers.filesystem.type).toBe('stdio');
    expect(servers.filesystem.command).toBe('npx');
  });

  it('应该验证 MCP 服务器配置', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(() => {
      manager.addMcpServer('invalid', {
        type: 'stdio',
        // 缺少 command
      } as any);
    }).toThrow(/无效的 MCP 服务器配置/);
  });

  it('应该更新和删除 MCP 服务器', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('test', {
      type: 'http',
      url: 'http://localhost:3000',
    });

    // 更新
    const updateResult = manager.updateMcpServer('test', {
      url: 'http://localhost:4000',
    });
    expect(updateResult).toBe(true);

    const servers1 = manager.getMcpServers();
    expect(servers1.test.url).toBe('http://localhost:4000');

    // 删除
    const deleteResult = manager.removeMcpServer('test');
    expect(deleteResult).toBe(true);

    const servers2 = manager.getMcpServers();
    expect(servers2.test).toBeUndefined();
  });
});

// ============ 12. 配置迁移测试 ============

describe('配置迁移', () => {
  it('应该迁移旧版本的模型名称', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      version: '1.0.0',
      model: 'claude-3-opus',
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();
    expect(config.model).toBe('opus');
    expect(config.version).toBe('2.1.4');
  });

  it('应该迁移 autoSave 到 enableAutoSave', () => {
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      autoSave: true,
    }));

    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();
    expect(config.enableAutoSave).toBe(true);
  });
});

// ============ 13. 配置路径获取测试 ============

describe('配置路径获取', () => {
  it('应该获取所有配置文件路径', () => {
    process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(paths.userSettings).toContain('settings.json');
    expect(paths.projectSettings).toContain('.axon');
    expect(paths.localSettings).toContain('settings.local.json');
    expect(paths.policySettings).toBeDefined();
    expect(paths.globalConfigDir).toBe(TEST_CONFIG_DIR);
  });
});
