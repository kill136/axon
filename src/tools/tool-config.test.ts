import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { toolRegistry, BaseTool, type ToolConfigMap } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';

let testDir: string;
let originalConfigDir: string | undefined;

/** 注册用的假工具 */
class FakeTool extends BaseTool {
  name: string;
  description: string;
  constructor(name: string, description: string, defer = false) {
    super();
    this.name = name;
    this.description = description;
    this.shouldDefer = defer;
    this.searchHint = `hint for ${name}`;
  }
  getInputSchema(): ToolDefinition['inputSchema'] {
    return { type: 'object', properties: {} };
  }
  async execute(): Promise<ToolResult> {
    return { success: true, output: `${this.name} executed` };
  }
}

/** 写入 tool-config.json */
function writeToolConfig(config: ToolConfigMap): void {
  const configPath = path.join(testDir, 'tool-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `axon-tool-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(testDir, { recursive: true });

  originalConfigDir = process.env.AXON_CONFIG_DIR;
  process.env.AXON_CONFIG_DIR = testDir;

  // 强制刷新配置缓存
  toolRegistry.reloadToolConfig();

  // 注册测试工具
  toolRegistry.register(new FakeTool('AlphaTool', 'Alpha description'));
  toolRegistry.register(new FakeTool('BetaTool', 'Beta description', true));
  toolRegistry.register(new FakeTool('GammaTool', 'Gamma description'));
});

afterEach(() => {
  // 清理测试工具
  toolRegistry.unregister('AlphaTool');
  toolRegistry.unregister('BetaTool');
  toolRegistry.unregister('GammaTool');
  toolRegistry.reloadToolConfig();

  if (originalConfigDir !== undefined) {
    process.env.AXON_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.AXON_CONFIG_DIR;
  }

  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
});

describe('ToolConfig Override', () => {
  describe('no config file', () => {
    it('should return all tools when no config exists', () => {
      const defs = toolRegistry.getDefinitions();
      const names = defs.map(d => d.name);
      expect(names).toContain('AlphaTool');
      expect(names).toContain('BetaTool');
      expect(names).toContain('GammaTool');
    });

    it('should return original descriptions when no config exists', () => {
      const defs = toolRegistry.getDefinitions();
      const alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.description).toBe('Alpha description');
    });
  });

  describe('enabled: false', () => {
    it('should exclude disabled tools from getDefinitions', () => {
      writeToolConfig({
        GammaTool: { enabled: false },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const names = defs.map(d => d.name);
      expect(names).toContain('AlphaTool');
      expect(names).toContain('BetaTool');
      expect(names).not.toContain('GammaTool');
    });

    it('should exclude disabled tools from getAll', () => {
      writeToolConfig({
        GammaTool: { enabled: false },
      });
      toolRegistry.reloadToolConfig();

      const tools = toolRegistry.getAll();
      const names = tools.map(t => t.name);
      expect(names).not.toContain('GammaTool');
    });

    it('should still allow get() for disabled tools (execution bypass)', () => {
      writeToolConfig({
        GammaTool: { enabled: false },
      });
      toolRegistry.reloadToolConfig();

      // get() 不受 enabled 影响（直接查注册表）
      const tool = toolRegistry.get('GammaTool');
      expect(tool).toBeDefined();
    });
  });

  describe('description override', () => {
    it('should override tool description', () => {
      writeToolConfig({
        AlphaTool: { description: 'Custom alpha desc' },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.description).toBe('Custom alpha desc');
    });

    it('should not affect other tools', () => {
      writeToolConfig({
        AlphaTool: { description: 'Custom alpha desc' },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const beta = defs.find(d => d.name === 'BetaTool');
      expect(beta?.description).toBe('Beta description');
    });
  });

  describe('shouldDefer override', () => {
    it('should override shouldDefer from false to true', () => {
      writeToolConfig({
        AlphaTool: { shouldDefer: true },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.shouldDefer).toBe(true);
    });

    it('should override shouldDefer from true to false', () => {
      writeToolConfig({
        BetaTool: { shouldDefer: false },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const beta = defs.find(d => d.name === 'BetaTool');
      // shouldDefer=false 时 getDefinition 返回 undefined（falsy）
      expect(beta?.shouldDefer).toBeFalsy();
    });
  });

  describe('searchHint override', () => {
    it('should override searchHint', () => {
      writeToolConfig({
        AlphaTool: { searchHint: 'custom hint' },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.searchHint).toBe('custom hint');
    });
  });

  describe('multiple overrides combined', () => {
    it('should apply all overrides together', () => {
      writeToolConfig({
        AlphaTool: {
          description: 'New desc',
          shouldDefer: true,
          searchHint: 'new hint',
        },
        GammaTool: { enabled: false },
      });
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      const names = defs.map(d => d.name);
      expect(names).not.toContain('GammaTool');

      const alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.description).toBe('New desc');
      expect(alpha?.shouldDefer).toBe(true);
      expect(alpha?.searchHint).toBe('new hint');

      // BetaTool 不受影响
      const beta = defs.find(d => d.name === 'BetaTool');
      expect(beta?.description).toBe('Beta description');
    });
  });

  describe('config auto-refresh', () => {
    it('should pick up config changes when file is modified', async () => {
      writeToolConfig({
        AlphaTool: { description: 'Version 1' },
      });
      toolRegistry.reloadToolConfig();

      let defs = toolRegistry.getDefinitions();
      let alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.description).toBe('Version 1');

      // 等待 1ms 确保 mtime 变化
      await new Promise(r => setTimeout(r, 10));

      writeToolConfig({
        AlphaTool: { description: 'Version 2' },
      });

      // 不调用 reloadToolConfig()，依赖 mtime 自动刷新
      defs = toolRegistry.getDefinitions();
      alpha = defs.find(d => d.name === 'AlphaTool');
      expect(alpha?.description).toBe('Version 2');
    });
  });

  describe('invalid config handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const configPath = path.join(testDir, 'tool-config.json');
      fs.writeFileSync(configPath, '{ invalid json }}}', 'utf-8');
      toolRegistry.reloadToolConfig();

      // 应该不影响正常工具返回
      const defs = toolRegistry.getDefinitions();
      const names = defs.map(d => d.name);
      expect(names).toContain('AlphaTool');
      expect(names).toContain('BetaTool');
      expect(names).toContain('GammaTool');
    });

    it('should handle non-object config gracefully', () => {
      const configPath = path.join(testDir, 'tool-config.json');
      fs.writeFileSync(configPath, '"just a string"', 'utf-8');
      toolRegistry.reloadToolConfig();

      const defs = toolRegistry.getDefinitions();
      expect(defs.length).toBeGreaterThan(0);
    });
  });
});
