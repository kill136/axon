/**
 * Claude Code 类型定义入口文件
 * Type definitions entry point for Claude Code
 *
 * 这个文件是类型系统的统一入口，从各个模块化类型文件重新导出
 * This file is the unified entry point for the type system, re-exporting from modular type files
 */

// ============ 从各个类型模块重新导出 ============
// Re-export from type modules

export * from './tools.js';
export * from './results.js';
export * from './errors.js';
export * from './messages.js';
export * from './config.js';

// ============ 常用类型别名 ============
// Common type aliases for convenience

// --- 工具相关 Tool-related ---
export type {
  // 工具输入联合类型
  ToolInputSchemas as ToolInput,
} from './tools.js';

export type {
  // 基础工具结果
  ToolResult,
  BashResult,
  FileResult,
  EditToolResult,
  GrepResult,
} from './results.js';

export type {
  // 工具定义
  ToolDefinition,
} from './messages.js';

// --- 消息相关 Message-related ---
export type {
  Message,
  ContentBlock,
  // v2.1.33: Extended Thinking block types
  ThinkingBlock,
  RedactedThinkingBlock,
  // Server Tool 类型 (Anthropic API built-in tools)
  ServerToolUseBlock,
  WebSearchResultBlock,
  WebSearchToolResultBlock,
  WebSearchToolResultError,
  WebSearchTool20250305,
  WebSearchUserLocation,
  CitationsWebSearchResultLocation,
} from './messages.js';

// --- 配置相关 Configuration-related ---
export type {
  Config as ClaudeConfig,
  Config as Settings,
  SessionState,
  McpServerConfig,
  PermissionMode,
  OutputFormat,
  InputFormat,
} from './config.js';

// --- 错误相关 Error-related ---
export type {
  ClaudeError,
  ErrorOptions,
} from './errors.js';

export {
  // 错误代码枚举
  ErrorCode,
  ErrorSeverity,

  // 错误类
  BaseClaudeError,
  ToolExecutionError,
  PermissionDeniedError,
  ConfigurationError,
  NetworkError,
  AuthenticationError,
  ValidationError,
  SessionError,
  SandboxError,
  PluginError,
  SystemError,

  // 错误工厂函数
  createToolExecutionError,
  createPermissionDeniedError,
  createConfigurationError,
  createNetworkError,
  createAuthenticationError,
  createValidationError,
  createSessionError,
  createSandboxError,
  createPluginError,
  createSystemError,

  // 错误转换和判断函数
  fromNativeError,
  isClaudeError,
  isRecoverableError,
  isRetryableError,
  formatError,
  getErrorSeverity,
  getErrorCode,

  // 错误处理辅助函数
  wrapWithErrorHandling,
  wrapAsyncWithErrorHandling,
} from './errors.js';

// ============ 具体工具类型别名 ============
// Specific tool type aliases for easy access

// --- Agent 工具 ---
export type {
  AgentInput as AgentToolInput,
} from './tools.js';

// --- Bash 相关工具 ---
export type {
  BashInput as BashToolInput,
  BashOutputInput as BashOutputToolInput,
  TaskOutputInput as TaskOutputToolInput,
  KillShellInput as KillShellToolInput,
} from './tools.js';

// --- 文件操作工具 ---
export type {
  FileReadInput as ReadToolInput,
  FileWriteInput as WriteToolInput,
  FileEditInput as EditToolInput,
} from './tools.js';

// --- 搜索工具 ---
export type {
  GlobInput as GlobToolInput,
  GrepInput as GrepToolInput,
} from './tools.js';

// --- Web 工具 ---
export type {
  WebFetchInput as WebFetchToolInput,
  // WebSearchInput 已移除 - 使用 Server Tool (web_search_20250305)
} from './tools.js';

// --- Todo 工具 (v1 Legacy) ---
export type {
  TodoItem,
  TodoWriteInput as TodoWriteToolInput,
} from './tools.js';

// --- Task v2 工具 (2.1.16+) ---
export type {
  TaskV2Status,
  TaskV2Item,
  TaskCreateInput as TaskCreateToolInput,
  TaskGetInput as TaskGetToolInput,
  TaskUpdateInput as TaskUpdateToolInput,
  TaskListInput as TaskListToolInput,
} from './tools.js';

// --- Notebook 工具 ---
export type {
  NotebookEditInput as NotebookEditToolInput,
} from './tools.js';

// --- MCP 工具 ---
export type {
  McpInput as McpToolInput,
  ListMcpResourcesInput as ListMcpResourcesToolInput,
  ReadMcpResourceInput as ReadMcpResourceToolInput,
  MCPSearchInput as MCPSearchToolInput,
} from './tools.js';

// --- 交互工具 ---
export type {
  AskUserQuestion,
  AskUserQuestionOption,
  AskUserQuestionInput as AskUserQuestionToolInput,
  ExitPlanModeInput as ExitPlanModeToolInput,
} from './tools.js';
