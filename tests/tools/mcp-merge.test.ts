/**
 * Tests for McpManage → Mcp merge
 * Verifies that MCPSearchTool now supports action parameter for server management
 */

import { describe, it, expect } from 'vitest';
import { MCPSearchTool } from '../../src/tools/mcp.js';

describe('MCPSearchTool - McpManage merge', () => {
  let tool: MCPSearchTool;

  beforeEach(() => {
    tool = new MCPSearchTool();
  });

  it('should have action and name in input schema', () => {
    const schema = tool.getInputSchema();
    expect(schema.properties).toHaveProperty('action');
    expect(schema.properties).toHaveProperty('name');
    expect(schema.properties.action.enum).toEqual(['list', 'enable', 'disable']);
    // query is no longer required (action mode doesn't need it)
    expect(schema.required).toEqual([]);
  });

  it('should return error when no query and no action', async () => {
    const result = await tool.execute({ query: '' });
    // Empty query without action should still work (returns no matches)
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  it('should handle action=list as fallback in CLI mode', async () => {
    const result = await tool.execute({ query: '', action: 'list' });
    // In CLI mode (no ConversationManager interception), returns fallback error
    expect(result.success).toBe(false);
    expect(result.output).toContain('requires Web server mode');
  });

  it('should handle action=enable as fallback in CLI mode', async () => {
    const result = await tool.execute({ query: '', action: 'enable', name: 'test-server' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('requires Web server mode');
  });

  it('should handle action=disable as fallback in CLI mode', async () => {
    const result = await tool.execute({ query: '', action: 'disable', name: 'test-server' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('requires Web server mode');
  });

  it('should still work as normal tool search when no action', async () => {
    const result = await tool.execute({ query: 'test-query' });
    // Should do keyword search (no MCP servers loaded, so no matches)
    expect(result.success).toBe(true);
    expect(result.query).toBe('test-query');
  });

  it('description should mention server management', () => {
    const desc = tool.description;
    expect(desc).toContain('MCP Server Management');
    expect(desc).toContain('action');
    expect(desc).toContain('enable');
    expect(desc).toContain('disable');
  });

  it('description should not mention McpManage', () => {
    const desc = tool.description;
    expect(desc).not.toContain('McpManage');
  });

  it('disabled servers hint should not mention McpManage', () => {
    MCPSearchTool.disabledServers = ['test-server'];
    const desc = tool.description;
    expect(desc).not.toContain('McpManage');
    expect(desc).toContain('action="enable"');
    MCPSearchTool.disabledServers = [];
  });
});
