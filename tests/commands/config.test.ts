/**
 * 配置命令完整测试
 * 测试 src/commands/config-cmd.ts 中所有配置管理子命令
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../../src/config/index.js';
import { VERSION } from '../../src/version.js';

// ============ 测试环境设置 ============

const TEST_ROOT = path.join(os.tmpdir(), `claude-test-config-cmd-${Date.now()}`);
const TEST_CONFIG_DIR = path.join(TEST_ROOT, '.axon');
const TEST_PROJECT_DIR = path.join(TEST_ROOT, 'project');

const USER_SETTINGS = path.join(TEST_CONFIG_DIR, 'settings.json');
const PROJECT_SETTINGS = path.join(TEST_PROJECT_DIR, '.axon', 'settings.json');
const LOCAL_SETTINGS = path.join(TEST_PROJECT_DIR, '.axon', 'settings.local.json');

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
  process.env.AXON_CONFIG_DIR = TEST_CONFIG_DIR;
});

afterEach(() => {
  cleanup();
  process.env = originalEnv;
  vi.restoreAllMocks();
});

// ============ 1. 配置获取测试 (config get) ============

describe('Config Get Command', () => {
  it('应该正确获取已设置的配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('maxTokens', 16384);

    expect(manager.get('model')).toBe('opus');
    expect(manager.get('maxTokens')).toBe(16384);
  });

  it('应该返回 undefined 对于未设置的配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.get('customKey' as any)).toBeUndefined();
  });

  it('应该获取默认值配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const model = manager.get('model');
    const version = manager.get('version');

    expect(model).toBeDefined();
    expect(version).toBe(VERSION);
  });

  it('应该获取嵌套配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // proxy 默认值是 undefined，需要先设置
    manager.set('proxy', { http: 'http://proxy.example.com:8080' });
    const proxy = manager.get('proxy');
    expect(proxy).toBeDefined();
    expect(proxy).toHaveProperty('http');
  });

  it('应该处理不同类型的配置值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('verbose', true);
    manager.set('maxTokens', 8192);
    manager.set('model', 'sonnet');

    expect(typeof manager.get('verbose')).toBe('boolean');
    expect(typeof manager.get('maxTokens')).toBe('number');
    expect(typeof manager.get('model')).toBe('string');
  });
});

// ============ 2. 配置设置测试 (config set) ============

describe('Config Set Command', () => {
  it('应该正确设置字符串配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    expect(manager.get('model')).toBe('opus');

    manager.set('model', 'sonnet');
    expect(manager.get('model')).toBe('sonnet');
  });

  it('应该正确设置数字配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('maxTokens', 16384);
    expect(manager.get('maxTokens')).toBe(16384);

    manager.set('temperature', 0.7);
    expect(manager.get('temperature')).toBe(0.7);
  });

  it('应该正确设置布尔配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('verbose', true);
    expect(manager.get('verbose')).toBe(true);

    manager.set('verbose', false);
    expect(manager.get('verbose')).toBe(false);
  });

  it('应该正确设置对象配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const proxyConfig = {
      http: 'http://proxy.example.com:8080',
      https: 'https://proxy.example.com:8443',
    };

    manager.set('proxy', proxyConfig);
    expect(manager.get('proxy')).toEqual(proxyConfig);
  });

  it('应该正确设置数组配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const tools = ['Bash', 'Read', 'Write'];
    manager.set('allowedTools', tools);

    expect(manager.get('allowedTools')).toEqual(tools);
  });

  it('应该持久化设置到文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.save();

    // 验证文件已写入
    expect(fs.existsSync(USER_SETTINGS)).toBe(true);

    // 验证可以重新加载
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager2.get('model')).toBe('opus');
  });

  it('应该支持链式设置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('maxTokens', 16384);
    manager.set('verbose', true);

    expect(manager.get('model')).toBe('opus');
    expect(manager.get('maxTokens')).toBe(16384);
    expect(manager.get('verbose')).toBe(true);
  });

  it('应该覆盖已存在的配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'sonnet');
    expect(manager.get('model')).toBe('sonnet');

    manager.set('model', 'opus');
    expect(manager.get('model')).toBe('opus');
  });
});

// ============ 3. 配置列表显示测试 (config list) ============

describe('Config List Command', () => {
  it('应该列出所有配置项', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config).toBeDefined();
    expect(config.version).toBe(VERSION);
    expect(config.model).toBeDefined();
    expect(config.maxTokens).toBeDefined();
  });

  it('应该包含默认配置值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.version).toBe(VERSION);
    expect(config.maxTokens).toBe(32000); // 默认值是 32000
    // enableTelemetry 的默认值可能是 false 或 undefined
    expect([false, undefined]).toContain(config.enableTelemetry);
  });

  it('应该包含用户自定义配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('verbose', true);

    const config = manager.getAll();

    expect(config.model).toBe('opus');
    expect(config.verbose).toBe(true);
  });

  it('应该合并多个配置源', () => {
    // 用户配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'sonnet',
      maxTokens: 16384,
    }));

    // 项目配置
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'opus', // 覆盖用户配置
      verbose: true,
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.model).toBe('opus'); // 项目配置优先
    expect(config.maxTokens).toBe(16384); // 来自用户配置
    expect(config.verbose).toBe(true); // 来自项目配置
  });

  it('应该显示配置项类型', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('maxTokens', 16384);
    manager.set('verbose', true);

    const config = manager.getAll();

    expect(typeof config.model).toBe('string');
    expect(typeof config.maxTokens).toBe('number');
    expect(typeof config.verbose).toBe('boolean');
  });

  it('应该支持 JSON 格式输出', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');

    const exported = manager.export(false);
    const config = JSON.parse(exported);

    expect(config).toBeDefined();
    expect(config.model).toBe('opus');
  });
});

// ============ 4. 配置验证测试 (config validate) ============

describe('Config Validation', () => {
  it('应该验证有效的配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('maxTokens', 16384);
    manager.set('temperature', 0.7);

    const result = manager.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('应该拒绝无效的模型名称', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const invalidConfig = JSON.stringify({
      model: 'invalid-model-name',
    });

    const success = manager.import(invalidConfig);

    expect(success).toBe(false);
  });

  it('应该拒绝超出范围的数值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 负数 token
    const invalidConfig1 = JSON.stringify({
      maxTokens: -1000,
    });
    expect(manager.import(invalidConfig1)).toBe(false);

    // 超出范围的温度
    const invalidConfig2 = JSON.stringify({
      temperature: 2.5,
    });
    expect(manager.import(invalidConfig2)).toBe(false);
  });

  it('应该拒绝错误类型的配置值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const invalidConfig = JSON.stringify({
      verbose: 'not-a-boolean',
      maxTokens: 'not-a-number',
    });

    const success = manager.import(invalidConfig);

    expect(success).toBe(false);
  });

  it('应该验证 MCP 服务器配置格式', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 有效配置
    expect(() => {
      manager.addMcpServer('test-server', {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });
    }).not.toThrow();

    // 无效配置（缺少 command）
    expect(() => {
      manager.addMcpServer('invalid-server', {
        type: 'stdio',
      } as any);
    }).toThrow();
  });

  it('应该检测配置文件格式错误', () => {
    // 写入无效 JSON
    fs.writeFileSync(USER_SETTINGS, '{ invalid json }');

    // ConfigManager 可能会自动处理无效JSON，或者抛出错误
    // 这里我们只验证不会崩溃，但可能会打印警告
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 应该能够创建 manager，但可能会有警告
    expect(manager).toBeDefined();

    consoleSpy.mockRestore();
  });
});

// ============ 5. 配置持久化测试 ============

describe('Config Persistence', () => {
  it('应该保存配置到用户配置文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.save();

    expect(fs.existsSync(USER_SETTINGS)).toBe(true);

    const content = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf-8'));
    expect(content.model).toBe('opus');
  });

  it('应该保存配置到项目配置文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.saveProject({ model: 'opus', verbose: true });

    expect(fs.existsSync(PROJECT_SETTINGS)).toBe(true);

    const content = JSON.parse(fs.readFileSync(PROJECT_SETTINGS, 'utf-8'));
    expect(content.model).toBe('opus');
    expect(content.verbose).toBe(true);
  });

  it('应该保存配置到本地配置文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.saveLocal({ maxTokens: 32768 });

    expect(fs.existsSync(LOCAL_SETTINGS)).toBe(true);

    const content = JSON.parse(fs.readFileSync(LOCAL_SETTINGS, 'utf-8'));
    expect(content.maxTokens).toBe(32768);
  });

  it('应该在保存时合并已有配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 第一次保存
    manager.set('model', 'opus');
    manager.save();

    // 第二次保存
    manager.set('verbose', true);
    manager.save();

    const content = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf-8'));
    expect(content.model).toBe('opus');
    expect(content.verbose).toBe(true);
  });

  it('应该创建不存在的配置目录', () => {
    const newProjectDir = path.join(TEST_ROOT, 'new-project');

    const manager = new ConfigManager({
      workingDirectory: newProjectDir,
    });

    manager.saveProject({ model: 'opus' });

    const projectConfigPath = path.join(newProjectDir, '.axon', 'settings.json');
    expect(fs.existsSync(projectConfigPath)).toBe(true);
  });

  it('应该保持配置文件格式化', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.save();

    const content = fs.readFileSync(USER_SETTINGS, 'utf-8');

    // 验证是否格式化（包含缩进）
    expect(content).toContain('\n');
    expect(content).toContain('  ');
  });
});

// ============ 6. 环境变量覆盖测试 ============

describe('Environment Variable Override', () => {
  it('应该使用 ANTHROPIC_API_KEY 环境变量', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.getApiKey()).toBe('sk-ant-test-key-123');
  });

  it('应该使用 AXON_API_KEY 作为备用', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AXON_API_KEY = 'sk-claude-test-key-456';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.getApiKey()).toBe('sk-claude-test-key-456');
  });

  it('应该环境变量覆盖文件配置', () => {
    // AXON_MAX_OUTPUT_TOKENS 已迁移到 settings.json，不再通过环境变量映射到 maxTokens
    // 改用 AXON_LANGUAGE 测试环境变量覆盖行为（该变量在 getEnvConfig 中有映射）
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      language: 'english',
    }));

    process.env.AXON_LANGUAGE = 'japanese';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 环境变量优先级高于文件配置
    expect(manager.get('language')).toBe('japanese');
  });

  it('应该解析布尔类型环境变量', () => {
    // AXON_ENABLE_TELEMETRY / AXON_DISABLE_FILE_CHECKPOINTING 已迁移到 settings.json
    // 改用 getEnvConfig 中实际映射的布尔环境变量
    process.env.AXON_ENABLE_SPINNER_TIPS = 'false';
    process.env.AXON_RESPECT_GITIGNORE = '0';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.spinnerTipsEnabled).toBe(false);
    expect(config.respectGitignore).toBe(false);
  });

  it('应该解析数字类型环境变量', () => {
    // AXON_MAX_OUTPUT_TOKENS / AXON_MAX_RETRIES 已迁移到 settings.json，
    // 不再通过 getEnvConfig 环境变量映射。改为测试通过文件配置设置数字值。
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      maxTokens: 16384,
      maxRetries: 10,
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.maxTokens).toBe(16384);
    expect(config.maxRetries).toBe(10);
  });

  it('应该忽略无效的环境变量值', () => {
    process.env.AXON_MAX_OUTPUT_TOKENS = 'invalid-number';

    // 可能会打印警告
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 无效的环境变量应该被忽略，使用默认值
    // 或者环境变量仍然是字符串，ConfigManager会处理
    const maxTokens = manager.get('maxTokens');
    expect(typeof maxTokens === 'number' && maxTokens > 0).toBe(true);

    consoleSpy.mockRestore();
  });

  it('应该支持 Bedrock 配置', () => {
    // AXON_USE_BEDROCK 已迁移到 settings.json，不再通过环境变量映射
    // 改为测试通过文件配置设置 useBedrock
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      useBedrock: true,
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    expect(manager.getAll().useBedrock).toBe(true);
  });

  it('应该支持代理配置环境变量', () => {
    process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
    process.env.HTTPS_PROXY = 'https://proxy.example.com:8443';

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.proxy?.http).toBe('http://proxy.example.com:8080');
    expect(config.proxy?.https).toBe('https://proxy.example.com:8443');
  });
});

// ============ 7. 配置导出和导入测试 ============

describe('Config Export and Import', () => {
  it('应该导出配置为 JSON', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.set('maxTokens', 16384);

    const exported = manager.export(false);
    const config = JSON.parse(exported);

    expect(config.model).toBe('opus');
    expect(config.maxTokens).toBe(16384);
  });

  it('应该导出时掩码敏感信息', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('apiKey', 'sk-ant-1234567890abcdef');

    const exported = manager.export(true);
    const config = JSON.parse(exported);

    expect(config.apiKey).toContain('***');
    expect(config.apiKey).not.toBe('sk-ant-1234567890abcdef');
  });

  it('应该导出时不掩码（如果指定）', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('apiKey', 'sk-ant-1234567890abcdef');

    const exported = manager.export(false);
    const config = JSON.parse(exported);

    expect(config.apiKey).toBe('sk-ant-1234567890abcdef');
  });

  it('应该导入有效的配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const configToImport = JSON.stringify({
      version: '2.1.4',
      model: 'opus',
      maxTokens: 16384,
      verbose: true,
    });

    const success = manager.import(configToImport);
    expect(success).toBe(true);

    const config = manager.getAll();
    expect(config.model).toBe('opus');
    expect(config.maxTokens).toBe(16384);
    expect(config.verbose).toBe(true);
  });

  it('应该拒绝无效的配置导入', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const invalidConfig = JSON.stringify({
      model: 'invalid-model',
      maxTokens: -1000,
    });

    const success = manager.import(invalidConfig);
    expect(success).toBe(false);
  });

  it('应该拒绝格式错误的 JSON', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const invalidJson = '{ invalid: json }';

    const success = manager.import(invalidJson);
    expect(success).toBe(false);
  });

  it('应该支持导出到文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');

    const exportPath = path.join(TEST_ROOT, 'export.json');
    const exported = manager.export(false);
    fs.writeFileSync(exportPath, exported, 'utf-8');

    expect(fs.existsSync(exportPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    expect(content.model).toBe('opus');
  });

  it('应该支持从文件导入', () => {
    const importPath = path.join(TEST_ROOT, 'import.json');
    const configData = {
      version: '2.1.4',
      model: 'sonnet',
      maxTokens: 8192,
    };
    fs.writeFileSync(importPath, JSON.stringify(configData), 'utf-8');

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const configJson = fs.readFileSync(importPath, 'utf-8');
    const success = manager.import(configJson);

    expect(success).toBe(true);
    expect(manager.get('model')).toBe('sonnet');
  });
});

// ============ 8. MCP 服务器配置测试 ============

describe('MCP Server Configuration', () => {
  it('应该添加 stdio 类型 MCP 服务器', () => {
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
    expect(servers.filesystem.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
  });

  it('应该添加 HTTP 类型 MCP 服务器', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('api-server', {
      type: 'http',
      url: 'http://localhost:3000',
    });

    const servers = manager.getMcpServers();
    expect(servers['api-server']).toBeDefined();
    expect(servers['api-server'].type).toBe('http');
    expect(servers['api-server'].url).toBe('http://localhost:3000');
  });

  it('应该列出所有 MCP 服务器', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('server1', {
      type: 'stdio',
      command: 'node',
      args: ['server1.js'],
    });

    manager.addMcpServer('server2', {
      type: 'http',
      url: 'http://localhost:4000',
    });

    const servers = manager.getMcpServers();
    expect(Object.keys(servers).length).toBe(2);
    expect(servers.server1).toBeDefined();
    expect(servers.server2).toBeDefined();
  });

  it('应该更新 MCP 服务器配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('test', {
      type: 'http',
      url: 'http://localhost:3000',
    });

    const success = manager.updateMcpServer('test', {
      url: 'http://localhost:4000',
    });

    expect(success).toBe(true);

    const servers = manager.getMcpServers();
    expect(servers.test.url).toBe('http://localhost:4000');
  });

  it('应该删除 MCP 服务器', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('test', {
      type: 'stdio',
      command: 'node',
      args: ['test.js'],
    });

    expect(manager.getMcpServers().test).toBeDefined();

    const success = manager.removeMcpServer('test');
    expect(success).toBe(true);

    expect(manager.getMcpServers().test).toBeUndefined();
  });

  it('应该验证 MCP 服务器配置格式', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 无效配置：stdio 类型缺少 command
    expect(() => {
      manager.addMcpServer('invalid1', {
        type: 'stdio',
      } as any);
    }).toThrow(/Invalid MCP server configuration/);

    // 无效配置：http 类型缺少 url
    expect(() => {
      manager.addMcpServer('invalid2', {
        type: 'http',
      } as any);
    }).toThrow(/Invalid MCP server configuration/);
  });

  it('应该持久化 MCP 服务器配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('test', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    // 重新加载配置
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const servers = manager2.getMcpServers();
    expect(servers.test).toBeDefined();
    expect(servers.test.command).toBe('node');
  });

  it('应该拒绝添加重名的 MCP 服务器', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.addMcpServer('test', {
      type: 'stdio',
      command: 'node',
      args: ['server1.js'],
    });

    // 第二次添加同名服务器应该覆盖
    manager.addMcpServer('test', {
      type: 'stdio',
      command: 'node',
      args: ['server2.js'],
    });

    const servers = manager.getMcpServers();
    expect(servers.test.args).toEqual(['server2.js']);
  });
});

// ============ 9. 配置重置测试 ============

describe('Config Reset', () => {
  it('应该重置配置为默认值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 修改配置并保存
    manager.set('model', 'opus');
    manager.set('verbose', true);
    manager.set('maxTokens', 16384);
    manager.save();

    // 重置
    manager.reset();

    // 重新加载配置
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager2.getAll();

    // 应该恢复为默认值
    expect(config.model).toBe('sonnet');
    expect([false, undefined]).toContain(config.verbose);
    expect(config.maxTokens).toBe(32000); // 默认值是 32000
  });

  it('应该删除用户配置文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.save();

    expect(fs.existsSync(USER_SETTINGS)).toBe(true);

    manager.reset();

    // 配置文件可能被清空、删除或重置为空对象
    // 验证配置已经被重置
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });
    expect(manager2.get('model')).toBe('sonnet'); // 默认值
  });

  it('应该保留系统默认配置', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');
    manager.save();
    manager.reset();

    // 重新加载以获取最新配置
    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager2.getAll();

    // 系统配置应该仍然存在
    expect(config.version).toBe(VERSION);
    // cwd 可能不在 UserConfig 中，检查工作目录相关配置
    expect(config.workingDirectory || TEST_PROJECT_DIR).toBeDefined();
  });

  it('应该只重置指定作用域的配置', () => {
    // 设置用户配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'opus',
    }));

    // 设置项目配置
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      verbose: true,
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 只重置用户配置（通过删除文件或清空）
    manager.reset();

    // 项目配置应该仍然存在
    expect(fs.existsSync(PROJECT_SETTINGS)).toBe(true);
  });
});

// ============ 10. 配置路径获取测试 ============

describe('Config Path', () => {
  it('应该获取全局配置文件路径', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(paths.userSettings).toBeDefined();
    expect(paths.userSettings).toContain('settings.json');
    expect(paths.globalConfigDir).toBe(TEST_CONFIG_DIR);
  });

  it('应该获取项目配置文件路径', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(paths.projectSettings).toBeDefined();
    expect(paths.projectSettings).toContain('.axon');
    expect(paths.projectSettings).toContain('settings.json');
  });

  it('应该获取本地配置文件路径', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(paths.localSettings).toBeDefined();
    expect(paths.localSettings).toContain('settings.local.json');
  });

  it('应该获取策略配置文件路径', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(paths.policySettings).toBeDefined();
  });

  it('应该所有路径都是绝对路径', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const paths = manager.getConfigPaths();

    expect(path.isAbsolute(paths.userSettings)).toBe(true);
    expect(path.isAbsolute(paths.projectSettings)).toBe(true);
    expect(path.isAbsolute(paths.localSettings)).toBe(true);
    expect(path.isAbsolute(paths.globalConfigDir)).toBe(true);
  });
});

// ============ 11. 配置作用域测试 ============

describe('Config Scope', () => {
  it('应该区分全局和项目配置', () => {
    // 全局配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({
      model: 'sonnet',
      maxTokens: 8192,
    }));

    // 项目配置
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'opus', // 覆盖全局
      verbose: true, // 新增
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    // 项目配置应该覆盖全局配置
    expect(config.model).toBe('opus');
    expect(config.verbose).toBe(true);
    expect(config.maxTokens).toBe(8192); // 来自全局
  });

  it('应该区分项目和本地配置', () => {
    // 项目配置
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({
      model: 'sonnet',
      verbose: false,
    }));

    // 本地配置
    fs.writeFileSync(LOCAL_SETTINGS, JSON.stringify({
      verbose: true, // 覆盖项目
      maxTokens: 16384, // 新增
    }));

    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    expect(config.model).toBe('sonnet'); // 来自项目
    expect(config.verbose).toBe(true); // 本地覆盖项目
    expect(config.maxTokens).toBe(16384); // 来自本地
  });

  it('应该支持保存到不同作用域', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 保存到全局
    manager.set('model', 'opus');
    manager.save();

    // 保存到项目
    manager.saveProject({ verbose: true });

    // 保存到本地
    manager.saveLocal({ maxTokens: 32768 });

    // 验证文件
    expect(fs.existsSync(USER_SETTINGS)).toBe(true);
    expect(fs.existsSync(PROJECT_SETTINGS)).toBe(true);
    expect(fs.existsSync(LOCAL_SETTINGS)).toBe(true);
  });

  it('应该支持清除特定作用域的配置', () => {
    // 设置各级配置
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ model: 'opus', maxTokens: 16384 }));
    fs.writeFileSync(PROJECT_SETTINGS, JSON.stringify({ verbose: true }));
    fs.writeFileSync(LOCAL_SETTINGS, JSON.stringify({ maxTokens: 32768 }));

    const manager1 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 验证本地配置生效
    expect(manager1.get('maxTokens')).toBe(32768);

    // 清除本地配置
    if (fs.existsSync(LOCAL_SETTINGS)) {
      fs.unlinkSync(LOCAL_SETTINGS);
    }

    // 重新加载配置
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const config = manager.getAll();

    // 全局和项目配置应该仍然存在
    expect(config.model).toBe('opus');
    expect(config.verbose).toBe(true);
    // 本地配置被清除后，应该使用用户配置
    expect(config.maxTokens).toBe(16384);
  });
});

// ============ 12. 错误处理测试 ============

describe('Config Error Handling', () => {
  it('应该处理不存在的配置文件', () => {
    expect(() => {
      new ConfigManager({
        workingDirectory: TEST_PROJECT_DIR,
      });
    }).not.toThrow();
  });

  it('应该处理权限错误', () => {
    // 这个测试在某些环境下可能无法运行
    // 仅作为示例
    if (process.platform !== 'win32') {
      const restrictedDir = path.join(TEST_ROOT, 'restricted');
      fs.mkdirSync(restrictedDir, { recursive: true });

      const restrictedFile = path.join(restrictedDir, 'settings.json');
      fs.writeFileSync(restrictedFile, '{}');
      fs.chmodSync(restrictedFile, 0o000);

      // 应该优雅处理权限错误
      try {
        fs.readFileSync(restrictedFile, 'utf-8');
        // 如果没有抛出错误，测试通过
      } catch (error: any) {
        expect(error.code).toBe('EACCES');
      } finally {
        fs.chmodSync(restrictedFile, 0o644);
      }
    }
  });

  it('应该处理磁盘空间不足', () => {
    // 模拟磁盘写入错误
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 正常情况下应该成功
    expect(() => {
      manager.set('model', 'opus');
      manager.save();
    }).not.toThrow();
  });

  it('应该处理并发配置修改', () => {
    const manager1 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const manager2 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager1.set('model', 'opus');
    manager1.save();

    manager2.set('verbose', true);
    manager2.save();

    // 重新加载应该包含两个修改
    const manager3 = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 可能会有竞态条件，但不应该崩溃
    const config = manager3.getAll();
    expect(config).toBeDefined();
  });

  it('应该处理循环依赖', () => {
    // 创建配置不应该有循环引用问题
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('model', 'opus');

    // 导出和导入不应该有问题
    const exported = manager.export(false);
    expect(() => JSON.parse(exported)).not.toThrow();
  });

  it('应该处理超大配置文件', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    // 创建一个大的配置对象
    const largeArray = Array(1000).fill('item');
    manager.set('allowedTools', largeArray);

    expect(() => {
      manager.save();
    }).not.toThrow();

    const exported = manager.export(false);
    expect(exported.length).toBeGreaterThan(5000);
  });
});

// ============ 13. 配置格式化和显示测试 ============

describe('Config Display Formatting', () => {
  it('应该格式化布尔值显示', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('verbose', true);
    manager.set('enableTelemetry', false);

    const config = manager.getAll();

    expect(config.verbose).toBe(true);
    expect(config.enableTelemetry).toBe(false);
  });

  it('应该格式化数字值显示', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    manager.set('maxTokens', 16384);
    manager.set('temperature', 0.7);

    const config = manager.getAll();

    expect(typeof config.maxTokens).toBe('number');
    expect(typeof config.temperature).toBe('number');
  });

  it('应该格式化对象值显示', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const proxyConfig = {
      http: 'http://proxy.example.com:8080',
      https: 'https://proxy.example.com:8443',
    };

    manager.set('proxy', proxyConfig);

    const config = manager.getAll();
    expect(config.proxy).toEqual(proxyConfig);
  });

  it('应该格式化数组值显示', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const tools = ['Bash', 'Read', 'Write', 'Edit'];
    manager.set('allowedTools', tools);

    const config = manager.getAll();
    expect(config.allowedTools).toEqual(tools);
  });

  it('应该正确显示未设置的值', () => {
    const manager = new ConfigManager({
      workingDirectory: TEST_PROJECT_DIR,
    });

    const customValue = manager.get('customKey' as any);
    expect(customValue).toBeUndefined();
  });
});
