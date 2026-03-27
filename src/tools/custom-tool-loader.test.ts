import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { toolRegistry } from './base.js';
import {
  loadCustomTools,
  reloadCustomTools,
  getCustomToolsDir,
  listCustomToolFiles,
  CustomToolWrapper,
} from './custom-tool-loader.js';

let testDir: string;
let originalConfigDir: string | undefined;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `axon-custom-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(testDir, { recursive: true });

  // 用环境变量隔离测试目录（getCustomToolsDir 优先读这个）
  originalConfigDir = process.env.AXON_CONFIG_DIR;
  process.env.AXON_CONFIG_DIR = testDir;

  // 清理模块加载时可能已注册的自定义工具
  await reloadCustomTools();
});

afterEach(async () => {
  // 清理已加载的自定义工具
  await reloadCustomTools();
  for (const tool of toolRegistry.getAll()) {
    if (tool instanceof CustomToolWrapper) {
      toolRegistry.unregister(tool.name);
    }
  }

  // 恢复环境变量
  if (originalConfigDir !== undefined) {
    process.env.AXON_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.AXON_CONFIG_DIR;
  }

  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
});

/**
 * 写入一个自定义工具 JS 文件到测试目录
 */
function writeToolFile(fileName: string, content: string): string {
  const dir = getCustomToolsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${fileName}.js`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('CustomToolLoader', () => {
  describe('loadCustomTools', () => {
    it('should create custom-tools directory if not exists', async () => {
      // 使用一个全新的子目录来测试自动创建
      const freshDir = path.join(testDir, 'fresh-config');
      process.env.AXON_CONFIG_DIR = freshDir;
      const dir = getCustomToolsDir();
      expect(fs.existsSync(dir)).toBe(false);

      const result = await loadCustomTools();
      expect(fs.existsSync(dir)).toBe(true);
      expect(result.loaded).toHaveLength(0);
      expect(result.errors).toHaveLength(0);

      // 恢复为 testDir
      process.env.AXON_CONFIG_DIR = testDir;
    });

    it('should load a valid tool file', async () => {
      writeToolFile('hello', `
        export default {
          name: "HelloTool",
          description: "Says hello",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" }
            }
          },
          async execute(input) {
            return { success: true, output: "Hello, " + (input.name || "World") + "!" };
          }
        };
      `);

      const result = await loadCustomTools();
      expect(result.loaded).toContain('HelloTool');
      expect(result.errors).toHaveLength(0);

      const tool = toolRegistry.get('HelloTool');
      expect(tool).toBeDefined();
      expect(tool).toBeInstanceOf(CustomToolWrapper);
      expect(tool!.description).toBe('Says hello');
    });

    it('should execute a loaded tool correctly', async () => {
      writeToolFile('greet', `
        export default {
          name: "GreetTool",
          description: "Greets someone",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" }
            },
            required: ["name"]
          },
          async execute(input) {
            return { success: true, output: "Hi " + input.name };
          }
        };
      `);

      await loadCustomTools();
      const tool = toolRegistry.get('GreetTool');
      expect(tool).toBeDefined();

      const result = await tool!.execute({ name: 'Alice' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hi Alice');
    });

    it('should handle string return from execute', async () => {
      writeToolFile('simple', `
        export default {
          name: "SimpleTool",
          description: "Returns a string",
          inputSchema: { type: "object", properties: {} },
          async execute(input) {
            return "simple result";
          }
        };
      `);

      await loadCustomTools();
      const tool = toolRegistry.get('SimpleTool');
      const result = await tool!.execute({});
      expect(result.success).toBe(true);
      expect(result.output).toBe('simple result');
    });

    it('should skip files with invalid definitions', async () => {
      writeToolFile('bad', `
        export default {
          description: "No name",
          inputSchema: { type: "object" },
          async execute() { return "ok"; }
        };
      `);

      const result = await loadCustomTools();
      expect(result.loaded).toHaveLength(0);
    });

    it('should skip files with syntax errors', async () => {
      writeToolFile('broken', `
        export default {{{
      `);

      const result = await loadCustomTools();
      expect(result.loaded).toHaveLength(0);
    });

    it('should load multiple tools', async () => {
      writeToolFile('tool-a', `
        export default {
          name: "ToolA",
          description: "Tool A",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "a"; }
        };
      `);
      writeToolFile('tool-b', `
        export default {
          name: "ToolB",
          description: "Tool B",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "b"; }
        };
      `);

      const result = await loadCustomTools();
      expect(result.loaded).toHaveLength(2);
      expect(result.loaded).toContain('ToolA');
      expect(result.loaded).toContain('ToolB');
    });

    it('should not overwrite built-in tools', async () => {
      // 手动注册一个模拟内置工具来测试冲突检测
      const { BaseTool: BT } = await import('./base.js');
      class FakeBuiltIn extends BT {
        name = 'BuiltInTool';
        description = 'A built-in tool';
        getInputSchema() { return { type: 'object' as const, properties: {} }; }
        async execute() { return { success: true, output: 'built-in' }; }
      }
      toolRegistry.register(new FakeBuiltIn());

      writeToolFile('override', `
        export default {
          name: "BuiltInTool",
          description: "Fake override",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "fake"; }
        };
      `);

      const result = await loadCustomTools();
      expect(result.loaded).not.toContain('BuiltInTool');
      expect(result.errors.some(e => e.includes('conflicts'))).toBe(true);

      // 验证内置工具未被覆盖
      const tool = toolRegistry.get('BuiltInTool');
      expect(tool).not.toBeInstanceOf(CustomToolWrapper);

      // 清理
      toolRegistry.unregister('BuiltInTool');
    });
  });

  describe('reloadCustomTools', () => {
    it('should unload old tools and load new ones', async () => {
      writeToolFile('v1', `
        export default {
          name: "ReloadTest",
          description: "Version 1",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "v1"; }
        };
      `);
      await loadCustomTools();
      let tool = toolRegistry.get('ReloadTest');
      expect(tool).toBeDefined();
      expect(tool!.description).toBe('Version 1');

      // 删除旧文件，写入新版本
      const dir = getCustomToolsDir();
      fs.unlinkSync(path.join(dir, 'v1.js'));
      writeToolFile('v2', `
        export default {
          name: "ReloadTest",
          description: "Version 2",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "v2"; }
        };
      `);

      const result = await reloadCustomTools();
      expect(result.loaded).toContain('ReloadTest');

      tool = toolRegistry.get('ReloadTest');
      expect(tool).toBeDefined();
      expect(tool!.description).toBe('Version 2');
    });

    it('should clean up removed tools', async () => {
      writeToolFile('temp', `
        export default {
          name: "TempTool",
          description: "Temporary",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "temp"; }
        };
      `);
      await loadCustomTools();
      expect(toolRegistry.get('TempTool')).toBeDefined();

      fs.unlinkSync(path.join(getCustomToolsDir(), 'temp.js'));
      await reloadCustomTools();
      expect(toolRegistry.get('TempTool')).toBeUndefined();
    });
  });

  describe('listCustomToolFiles', () => {
    it('should return empty array when no tools exist', () => {
      const tools = listCustomToolFiles();
      expect(tools).toHaveLength(0);
    });

    it('should list loaded tools with metadata', async () => {
      writeToolFile('listed', `
        export default {
          name: "ListedTool",
          description: "A listed tool",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "listed"; }
        };
      `);
      await loadCustomTools();

      const tools = listCustomToolFiles();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('ListedTool');
      expect(tools[0].description).toBe('A listed tool');
      expect(tools[0].loaded).toBe(true);
    });
  });

  describe('CustomToolWrapper', () => {
    it('should set shouldDefer to true', async () => {
      writeToolFile('defer', `
        export default {
          name: "DeferTool",
          description: "Deferred",
          inputSchema: { type: "object", properties: {} },
          async execute() { return "ok"; }
        };
      `);
      await loadCustomTools();
      const tool = toolRegistry.get('DeferTool');
      expect(tool!.shouldDefer).toBe(true);
    });

    it('should catch execute errors gracefully', async () => {
      writeToolFile('error-tool', `
        export default {
          name: "ErrorTool",
          description: "Throws error",
          inputSchema: { type: "object", properties: {} },
          async execute() { throw new Error("boom"); }
        };
      `);
      await loadCustomTools();
      const tool = toolRegistry.get('ErrorTool');
      const result = await tool!.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
    });

    it('should have correct definition', async () => {
      writeToolFile('def-test', `
        export default {
          name: "DefTest",
          description: "Definition test",
          inputSchema: {
            type: "object",
            properties: { x: { type: "number" } },
            required: ["x"]
          },
          async execute(input) { return String(input.x * 2); }
        };
      `);
      await loadCustomTools();
      const tool = toolRegistry.get('DefTest')!;
      const def = tool.getDefinition();
      expect(def.name).toBe('DefTest');
      expect(def.description).toBe('Definition test');
      expect((def.inputSchema.properties as any).x.type).toBe('number');
      expect(def.shouldDefer).toBe(true);
    });
  });

  describe('tool with Node.js modules', () => {
    it('should support using import() for Node.js modules', async () => {
      writeToolFile('node-tool', `
        export default {
          name: "NodeTool",
          description: "Uses Node.js path module",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string" }
            }
          },
          async execute(input) {
            const path = await import("path");
            return { success: true, output: path.basename(input.filePath || "/foo/bar.txt") };
          }
        };
      `);
      await loadCustomTools();
      const tool = toolRegistry.get('NodeTool');
      const result = await tool!.execute({ filePath: '/home/user/test.js' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('test.js');
    });
  });
});
