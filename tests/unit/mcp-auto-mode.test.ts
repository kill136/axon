/**
 * MCP Tool Search 自动模式测试
 * v2.1.7 功能：当 MCP 工具描述超过上下文窗口的 10% 阈值时，自动启用延迟加载
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getContextWindowSize,
  getAutoToolSearchCharThreshold,
  getMcpMode,
  modelSupportsToolReference,
  isMcpSearchToolAvailable,
  isToolSearchEnabled,
  isToolSearchEnabledOptimistic,
  calculateMcpToolDescriptionChars,
  type McpMode,
} from '../../src/tools/mcp.js';

describe('MCP Tool Search Auto Mode', () => {
  // 保存原始环境变量
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // 保存环境变量
    originalEnv.ENABLE_TOOL_SEARCH = process.env.ENABLE_TOOL_SEARCH;
    originalEnv.ENABLE_MCP_CLI = process.env.ENABLE_MCP_CLI;
    originalEnv.DEBUG = process.env.DEBUG;

    // 清除环境变量
    delete process.env.ENABLE_TOOL_SEARCH;
    delete process.env.ENABLE_MCP_CLI;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    // 恢复环境变量
    if (originalEnv.ENABLE_TOOL_SEARCH !== undefined) {
      process.env.ENABLE_TOOL_SEARCH = originalEnv.ENABLE_TOOL_SEARCH;
    } else {
      delete process.env.ENABLE_TOOL_SEARCH;
    }
    if (originalEnv.ENABLE_MCP_CLI !== undefined) {
      process.env.ENABLE_MCP_CLI = originalEnv.ENABLE_MCP_CLI;
    } else {
      delete process.env.ENABLE_MCP_CLI;
    }
    if (originalEnv.DEBUG !== undefined) {
      process.env.DEBUG = originalEnv.DEBUG;
    } else {
      delete process.env.DEBUG;
    }
  });

  describe('getContextWindowSize', () => {
    it('should return 200000 for standard models', () => {
      expect(getContextWindowSize('claude-3-5-sonnet')).toBe(200000);
      expect(getContextWindowSize('claude-opus-4')).toBe(200000);
      expect(getContextWindowSize('claude-sonnet-4')).toBe(200000);
    });

    it('should return 1000000 for 1M models', () => {
      expect(getContextWindowSize('claude-sonnet-4-5[1m]')).toBe(1000000);
      expect(getContextWindowSize('model-with-[1m]-marker')).toBe(1000000);
    });

    it('should return 1000000 for sonnet-4-5 with max-tokens-1m beta', () => {
      expect(getContextWindowSize('claude-sonnet-4-5', ['max-tokens-1m'])).toBe(1000000);
    });
  });

  describe('getAutoToolSearchCharThreshold', () => {
    it('should calculate threshold as contextWindow * 0.1 * 2.5', () => {
      // 200000 * 0.1 * 2.5 = 50000
      expect(getAutoToolSearchCharThreshold('claude-3-5-sonnet')).toBe(50000);

      // 1000000 * 0.1 * 2.5 = 250000
      expect(getAutoToolSearchCharThreshold('claude-sonnet-4-5[1m]')).toBe(250000);
    });
  });

  describe('getMcpMode', () => {
    it('should return tst-auto by default', () => {
      expect(getMcpMode()).toBe('tst-auto');
    });

    it('should return tst-auto when ENABLE_TOOL_SEARCH=auto', () => {
      process.env.ENABLE_TOOL_SEARCH = 'auto';
      expect(getMcpMode()).toBe('tst-auto');
    });

    it('should return tst when ENABLE_TOOL_SEARCH=1', () => {
      process.env.ENABLE_TOOL_SEARCH = '1';
      expect(getMcpMode()).toBe('tst');
    });

    it('should return tst when ENABLE_TOOL_SEARCH=true', () => {
      process.env.ENABLE_TOOL_SEARCH = 'true';
      expect(getMcpMode()).toBe('tst');
    });

    it('should return standard when ENABLE_TOOL_SEARCH=0', () => {
      process.env.ENABLE_TOOL_SEARCH = '0';
      expect(getMcpMode()).toBe('standard');
    });

    it('should return standard when ENABLE_TOOL_SEARCH=false', () => {
      process.env.ENABLE_TOOL_SEARCH = 'false';
      expect(getMcpMode()).toBe('standard');
    });

    it('should return mcp-cli when ENABLE_MCP_CLI=1', () => {
      process.env.ENABLE_MCP_CLI = '1';
      expect(getMcpMode()).toBe('mcp-cli');
    });

    it('should return standard when ENABLE_MCP_CLI=0', () => {
      process.env.ENABLE_MCP_CLI = '0';
      expect(getMcpMode()).toBe('standard');
    });
  });

  describe('modelSupportsToolReference', () => {
    it('should return true for supported models', () => {
      expect(modelSupportsToolReference('claude-sonnet-4')).toBe(true);
      expect(modelSupportsToolReference('claude-opus-4')).toBe(true);
      expect(modelSupportsToolReference('claude-3-5-sonnet')).toBe(true);
    });

    it('should return false for haiku models', () => {
      expect(modelSupportsToolReference('claude-haiku-4')).toBe(false);
      expect(modelSupportsToolReference('claude-3-haiku')).toBe(false);
      expect(modelSupportsToolReference('CLAUDE-HAIKU')).toBe(false); // case insensitive
    });
  });

  describe('isMcpSearchToolAvailable', () => {
    it('should return true when MCPSearch is in tools list', () => {
      const tools = [
        { name: 'Bash' },
        { name: 'Read' },
        { name: 'Mcp' },
      ];
      expect(isMcpSearchToolAvailable(tools)).toBe(true);
    });

    it('should return false when MCPSearch is not in tools list', () => {
      const tools = [
        { name: 'Bash' },
        { name: 'Read' },
      ];
      expect(isMcpSearchToolAvailable(tools)).toBe(false);
    });
  });

  describe('isToolSearchEnabledOptimistic', () => {
    it('should return true for tst-auto mode', () => {
      expect(isToolSearchEnabledOptimistic()).toBe(true);
    });

    it('should return true for tst mode', () => {
      process.env.ENABLE_TOOL_SEARCH = '1';
      expect(isToolSearchEnabledOptimistic()).toBe(true);
    });

    it('should return false for standard mode', () => {
      process.env.ENABLE_TOOL_SEARCH = '0';
      expect(isToolSearchEnabledOptimistic()).toBe(false);
    });

    it('should return false for mcp-cli mode', () => {
      process.env.ENABLE_MCP_CLI = '1';
      expect(isToolSearchEnabledOptimistic()).toBe(false);
    });
  });

  describe('isToolSearchEnabled', () => {
    const mockTools = [
      { name: 'Bash' },
      { name: 'Read' },
      { name: 'Mcp' },
    ];

    it('should return false for haiku models', () => {
      expect(isToolSearchEnabled('claude-haiku-4', mockTools)).toBe(false);
    });

    it('should return false when MCPSearch is not available', () => {
      const toolsWithoutSearch = [{ name: 'Bash' }, { name: 'Read' }];
      expect(isToolSearchEnabled('claude-sonnet-4', toolsWithoutSearch)).toBe(false);
    });

    it('should return true when ENABLE_TOOL_SEARCH=1 (tst mode)', () => {
      process.env.ENABLE_TOOL_SEARCH = '1';
      expect(isToolSearchEnabled('claude-sonnet-4', mockTools)).toBe(true);
    });

    it('should return false when ENABLE_TOOL_SEARCH=0 (standard mode)', () => {
      process.env.ENABLE_TOOL_SEARCH = '0';
      expect(isToolSearchEnabled('claude-sonnet-4', mockTools)).toBe(false);
    });

    it('should return false when ENABLE_MCP_CLI=1 (mcp-cli mode)', () => {
      process.env.ENABLE_MCP_CLI = '1';
      expect(isToolSearchEnabled('claude-sonnet-4', mockTools)).toBe(false);
    });

    // tst-auto 模式下，需要根据实际的 MCP 工具数量判断
    // 由于测试环境没有真正的 MCP 工具，所以总字符数为 0，应该返回 false
    it('should return false in tst-auto mode when no MCP tools registered', () => {
      // 默认就是 tst-auto 模式
      expect(isToolSearchEnabled('claude-sonnet-4', mockTools)).toBe(false);
    });
  });

  describe('calculateMcpToolDescriptionChars', () => {
    it('should return 0 when no MCP servers are registered', () => {
      // 测试环境下没有注册 MCP 服务器
      expect(calculateMcpToolDescriptionChars()).toBe(0);
    });
  });
});
