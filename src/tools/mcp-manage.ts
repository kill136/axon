/**
 * MCP 管理工具 - 让 AI Agent 能主动启用/禁用/列出 MCP 服务器
 *
 * 解决的问题：
 * - MCPSearchTool 只能搜索已加载的工具，无法启用被禁用的 MCP 服务器
 * - AI Agent 缺少管理 MCP 服务器生命周期的能力
 *
 * 设计：
 * - 工具注册到全局 ToolRegistry（提供 schema）
 * - 实际执行由 ConversationManager.executeTool() 拦截处理
 *   （需要访问 ConversationManager 的 toggleMcpServer/listMcpServers 等方法）
 *
 * 安全考虑：
 * - 用完 MCP 后应主动禁用，防止污染并行会话
 * - 工具描述中强调"用完即关"的原则
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export interface McpManageInput {
  action: 'list' | 'enable' | 'disable';
  /** MCP 服务器名称（enable/disable 时必填） */
  name?: string;
}

export class McpManageTool extends BaseTool<McpManageInput, ToolResult> {
  name = 'McpManage';
  description = `Manage MCP server lifecycle: list, enable, or disable MCP servers.

Use this tool when you need to:
- List all configured MCP servers and their enabled/disabled status
- Enable a disabled MCP server to access its tools
- Disable an MCP server after you're done using it

IMPORTANT: After you finish using an MCP server's tools, you MUST disable it to prevent polluting other parallel sessions. Follow the pattern: enable -> use tools -> disable.

Actions:
- list: Show all MCP servers with their status (enabled/disabled), type, and tool count
- enable: Enable a disabled MCP server (connects and loads its tools)
- disable: Disable an enabled MCP server (disconnects and unloads its tools)`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'enable', 'disable'],
          description: 'Action to perform: list all servers, enable a server, or disable a server.',
        },
        name: {
          type: 'string',
          description: 'MCP server name (required for enable/disable actions).',
        },
      },
      required: ['action'],
    };
  }

  async execute(_input: McpManageInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    // 这里仅作为 fallback（CLI 模式或未被拦截时）
    return {
      success: false,
      output: 'McpManage tool requires Web server mode. It is intercepted by ConversationManager.executeTool().',
    };
  }
}
