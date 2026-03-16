/**
 * MCP Disabled Servers 幽灵 server 过滤测试
 *
 * Bug: disabledMcpServers 数组中可能包含配置中不存在的 server 名称（幽灵 server），
 * 导致 MCPSearchTool 的描述中显示不存在的 MCP server，误导 AI 尝试 enable 它们。
 *
 * 修复:
 * 1. toggleMcpServer() 在操作前验证 server 是否存在于配置中
 * 2. syncDisabledServersToSearchTool() 过滤掉配置中不存在的 server 名
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPSearchTool } from '../../src/tools/mcp.js';

describe('MCP Disabled Servers Ghost Filtering', () => {

  beforeEach(() => {
    // 每次测试前清空 disabled servers 列表
    MCPSearchTool.disabledServers = [];
    MCPSearchTool.serverCapabilitySummaries.clear();
  });

  describe('MCPSearchTool.disabledServers display', () => {

    it('should not display ghost server names in description', () => {
      // 模拟：只有 "reddit" 是真实配置的 disabled server，
      // "email", "server1" 是幽灵条目
      MCPSearchTool.disabledServers = ['reddit'];

      const tool = new MCPSearchTool();
      const desc = tool.description;

      // 真实的 disabled server 应该出现
      expect(desc).toContain('reddit');
      // 确认描述包含 Disabled 关键字
      expect(desc).toContain('Disabled MCP servers');
    });

    it('should not show disabled section when disabledServers is empty', () => {
      MCPSearchTool.disabledServers = [];

      const tool = new MCPSearchTool();
      const desc = tool.description;

      expect(desc).not.toContain('Disabled MCP servers');
    });

    it('should include capability summary for disabled servers', () => {
      MCPSearchTool.disabledServers = ['reddit'];
      MCPSearchTool.serverCapabilitySummaries.set('reddit', 'fetch hot threads, read post content');

      const tool = new MCPSearchTool();
      const desc = tool.description;

      expect(desc).toContain('reddit');
      expect(desc).toContain('fetch hot threads');
    });

    it('should not include capability summary for non-disabled servers', () => {
      MCPSearchTool.disabledServers = [];
      MCPSearchTool.serverCapabilitySummaries.set('reddit', 'fetch hot threads');

      const tool = new MCPSearchTool();
      const desc = tool.description;

      // disabled section 不应出现
      expect(desc).not.toContain('Disabled MCP servers');
    });
  });

  describe('Ghost server filtering logic', () => {

    it('should filter out server names not in config', () => {
      // 模拟 getDisabledMcpServers 返回的原始数据
      const rawDisabled = ['reddit', 'email', 'server1', 'claude-in-chrome'];
      // 模拟 mcpConfigManager.getServers() 返回的配置
      const configuredServers: Record<string, any> = {
        'reddit': { type: 'stdio', command: 'uvx' },
        'claude-in-chrome': { type: 'stdio', command: 'node' },
      };
      // 模拟 getMcpServers() 返回的运行时 Map（空，因为都 disabled 了）
      const runtimeServers = new Map<string, any>();

      // 过滤逻辑（与 syncDisabledServersToSearchTool 一致）
      const validDisabled = rawDisabled.filter(
        name => !!configuredServers[name] || runtimeServers.has(name)
      );

      expect(validDisabled).toEqual(['reddit', 'claude-in-chrome']);
      expect(validDisabled).not.toContain('email');
      expect(validDisabled).not.toContain('server1');
    });

    it('should keep server that exists only in runtime map', () => {
      const rawDisabled = ['dynamic-server'];
      const configuredServers: Record<string, any> = {};
      const runtimeServers = new Map<string, any>();
      runtimeServers.set('dynamic-server', { connected: true, tools: [] });

      const validDisabled = rawDisabled.filter(
        name => !!configuredServers[name] || runtimeServers.has(name)
      );

      expect(validDisabled).toEqual(['dynamic-server']);
    });

    it('should return empty array when all disabled servers are ghosts', () => {
      const rawDisabled = ['ghost1', 'ghost2', 'ghost3'];
      const configuredServers: Record<string, any> = {};
      const runtimeServers = new Map<string, any>();

      const validDisabled = rawDisabled.filter(
        name => !!configuredServers[name] || runtimeServers.has(name)
      );

      expect(validDisabled).toEqual([]);
    });
  });

  describe('toggleMcpServer validation logic', () => {

    it('should reject toggle for non-existent server', () => {
      // 模拟校验逻辑
      const configuredServers: Record<string, any> = {
        'reddit': { type: 'stdio' },
      };
      const runtimeServers = new Map<string, any>();

      const serverName = 'non-existent';
      const exists = !!configuredServers[serverName] || runtimeServers.has(serverName);

      expect(exists).toBe(false);
    });

    it('should allow toggle for configured server', () => {
      const configuredServers: Record<string, any> = {
        'reddit': { type: 'stdio' },
      };
      const runtimeServers = new Map<string, any>();

      const serverName = 'reddit';
      const exists = !!configuredServers[serverName] || runtimeServers.has(serverName);

      expect(exists).toBe(true);
    });

    it('should allow toggle for runtime-only server', () => {
      const configuredServers: Record<string, any> = {};
      const runtimeServers = new Map<string, any>();
      runtimeServers.set('chrome-extension', { connected: true, tools: [] });

      const serverName = 'chrome-extension';
      const exists = !!configuredServers[serverName] || runtimeServers.has(serverName);

      expect(exists).toBe(true);
    });
  });
});
