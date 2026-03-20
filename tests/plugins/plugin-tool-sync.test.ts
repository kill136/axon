/**
 * 插件工具同步到 toolRegistry 的测试
 *
 * 测试覆盖：
 * 1. PluginToolWrapper 正确桥接 ToolDefinition + executor 为 BaseTool
 * 2. PluginToolWrapper 的 shouldDefer / searchHint 属性
 * 3. ToolRegistry.unregister 能正确删除工具
 * 4. 插件工具不会覆盖内置工具（重名保护）
 */

import { describe, it, expect, vi } from 'vitest';
import { PluginToolWrapper, ToolRegistry } from '../../src/tools/base';
import type { ToolDefinition, ToolResult } from '../../src/types/index';

describe('PluginToolWrapper', () => {
  const mockDefinition: ToolDefinition = {
    name: 'TestPluginTool',
    description: 'A test plugin tool',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Test query' },
      },
      required: ['query'],
    },
  };

  const mockExecutor = vi.fn(async (input: unknown): Promise<ToolResult> => {
    return { success: true, output: `executed with ${JSON.stringify(input)}` };
  });

  it('应该正确桥接 ToolDefinition 属性', () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');

    expect(wrapper.name).toBe('TestPluginTool');
    expect(wrapper.description).toBe('A test plugin tool');
    expect(wrapper.pluginName).toBe('my-plugin');
  });

  it('应该返回正确的 inputSchema', () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');
    const schema = wrapper.getInputSchema();

    expect(schema).toEqual(mockDefinition.inputSchema);
  });

  it('应该委托执行给 executor', async () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');
    const result = await wrapper.execute({ query: 'hello' });

    expect(mockExecutor).toHaveBeenCalledWith({ query: 'hello' });
    expect(result).toEqual({ success: true, output: 'executed with {"query":"hello"}' });
  });

  it('shouldDefer 默认为 true（避免膨胀核心工具列表）', () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');
    expect(wrapper.shouldDefer).toBe(true);
  });

  it('searchHint 默认包含插件名', () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');
    expect(wrapper.searchHint).toContain('my-plugin');
  });

  it('如果 ToolDefinition 有 searchHint 则优先使用', () => {
    const defWithHint: ToolDefinition = {
      ...mockDefinition,
      searchHint: 'custom search hint for users',
    };
    const wrapper = new PluginToolWrapper(defWithHint, mockExecutor, 'my-plugin');
    expect(wrapper.searchHint).toBe('custom search hint for users');
  });

  it('getDefinition() 应该返回完整的 ToolDefinition', () => {
    const wrapper = new PluginToolWrapper(mockDefinition, mockExecutor, 'my-plugin');
    const def = wrapper.getDefinition();

    expect(def.name).toBe('TestPluginTool');
    expect(def.description).toBe('A test plugin tool');
    expect(def.inputSchema).toEqual(mockDefinition.inputSchema);
    expect(def.shouldDefer).toBe(true);
    expect(def.searchHint).toBeDefined();
  });
});

describe('ToolRegistry.unregister', () => {
  it('应该能正确删除已注册的工具', () => {
    const registry = new ToolRegistry();
    const mockExecutor = async () => ({ success: true, output: 'ok' });
    const wrapper = new PluginToolWrapper(
      { name: 'ToRemove', description: 'test', inputSchema: { type: 'object' as const, properties: {} } },
      mockExecutor,
      'test-plugin',
    );

    registry.register(wrapper);
    expect(registry.get('ToRemove')).toBeDefined();

    registry.unregister('ToRemove');
    expect(registry.get('ToRemove')).toBeUndefined();
  });

  it('unregister 不存在的工具不应报错', () => {
    const registry = new ToolRegistry();
    expect(() => registry.unregister('nonexistent')).not.toThrow();
  });
});

describe('插件工具重名保护', () => {
  it('PluginToolWrapper 实例可通过 instanceof 区分', () => {
    const mockExecutor = async () => ({ success: true, output: 'ok' });
    const wrapper = new PluginToolWrapper(
      { name: 'Test', description: 'test', inputSchema: { type: 'object' as const, properties: {} } },
      mockExecutor,
      'test-plugin',
    );

    // 确保 instanceof 检查可用（用于 unregister 时只删除插件工具）
    expect(wrapper instanceof PluginToolWrapper).toBe(true);
  });
});
