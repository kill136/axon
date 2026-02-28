/**
 * Email MCP 模块入口
 *
 * 内置的邮件 MCP server，通过 settings.json 的 mcpServers 配置启用。
 * 作为标准 stdio MCP server 工作，无需特殊集成代码。
 *
 * 启用方式：在 settings.json 的 mcpServers 中添加 email 配置
 * 入口点：cli.ts --email-mcp → mcp-server.ts main()
 */

export { EMAIL_MCP_TOOLS, getEmailToolNames } from './tools.js';
export type { McpTool } from './tools.js';
