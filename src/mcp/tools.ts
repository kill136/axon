/**
 * MCP 工具调用管理器
 * 提供 MCP 工具的发现、调用、验证等功能
 */

import type { ToolDefinition } from '../types/index.js';

// ============ 接口定义 ============

/**
 * JSON Schema 类型定义
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
}

/**
 * MCP 工具定义
 */
export interface McpTool {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description?: string;
  /** 输入参数的 JSON Schema */
  inputSchema: JSONSchema;
  /** 所属服务器名称 */
  serverName: string;
}

/**
 * 工具结果内容
 */
export interface ToolResultContent {
  /** 内容类型 */
  type: 'text' | 'image' | 'resource';
  /** 文本内容 */
  text?: string;
  /** 数据（base64 编码的图片等） */
  data?: string;
  /** MIME 类型 */
  mimeType?: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  /** 结果内容数组 */
  content: ToolResultContent[];
  /** 是否为错误 */
  isError?: boolean;
}

/**
 * 参数验证结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息 */
  errors?: string[];
}

/**
 * 调用信息
 */
export interface CallInfo {
  /** 调用 ID */
  callId: string;
  /** 服务器名称 */
  serverName: string;
  /** 工具名称 */
  toolName: string;
  /** 调用参数 */
  args: Record<string, unknown>;
  /** 调用开始时间 */
  startTime: number;
  /** 是否已完成 */
  completed: boolean;
  /** 取消标志 */
  cancelled: boolean;
}

/**
 * 批量调用的工具调用定义
 */
export interface ToolCall {
  /** 服务器名称 */
  serverName: string;
  /** 工具名称 */
  toolName: string;
  /** 调用参数 */
  args: Record<string, unknown>;
}

/**
 * MCP 连接管理器接口
 */
export interface McpConnectionManager {
  /** 获取服务器工具列表 */
  listTools(serverName: string): Promise<McpTool[]>;
  /** 调用工具 */
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  /** 检查服务器是否已连接 */
  isConnected(serverName: string): boolean;
  /** 连接到服务器 */
  connect(serverName: string): Promise<boolean>;
}

// ============ 工具管理器 ============

/**
 * MCP 工具管理器
 * 管理 MCP 工具的发现、调用、验证等
 */
export class McpToolManager {
  private connectionManager: McpConnectionManager;
  private toolCache: Map<string, McpTool[]> = new Map();
  private pendingCalls: Map<string, CallInfo> = new Map();
  private callIdCounter = 0;

  constructor(connectionManager: McpConnectionManager) {
    this.connectionManager = connectionManager;
  }

  // ============ 工具发现 ============

  /**
   * 列出所有可用工具
   * @param serverName 可选的服务器名称过滤
   * @returns MCP 工具列表
   */
  async listTools(serverName?: string): Promise<McpTool[]> {
    const tools: McpTool[] = [];

    if (serverName) {
      // 列出特定服务器的工具
      const serverTools = await this.getServerTools(serverName);
      tools.push(...serverTools);
    } else {
      // 列出所有服务器的工具（需要从连接管理器获取服务器列表）
      // 这里假设连接管理器有方法获取所有服务器
      // 实际实现可能需要调整
      const cachedServers = Array.from(this.toolCache.keys());
      for (const server of cachedServers) {
        const serverTools = await this.getServerTools(server);
        tools.push(...serverTools);
      }
    }

    return tools;
  }

  /**
   * 获取特定工具
   * @param serverName 服务器名称
   * @param toolName 工具名称
   * @returns MCP 工具定义，如果不存在则返回 null
   */
  async getTool(serverName: string, toolName: string): Promise<McpTool | null> {
    const tools = await this.getServerTools(serverName);
    return tools.find((t) => t.name === toolName) || null;
  }

  /**
   * 获取服务器的工具列表（带缓存）
   * @param serverName 服务器名称
   * @returns 工具列表
   */
  private async getServerTools(serverName: string): Promise<McpTool[]> {
    // 检查缓存
    if (this.toolCache.has(serverName)) {
      return this.toolCache.get(serverName)!;
    }

    // 从连接管理器获取
    try {
      const tools = await this.connectionManager.listTools(serverName);
      this.toolCache.set(serverName, tools);
      return tools;
    } catch (err) {
      console.error(`Failed to list tools for server ${serverName}:`, err);
      return [];
    }
  }

  /**
   * 清除工具缓存
   * @param serverName 可选的服务器名称，如果不提供则清除所有缓存
   */
  clearCache(serverName?: string): void {
    if (serverName) {
      this.toolCache.delete(serverName);
    } else {
      this.toolCache.clear();
    }
  }

  // ============ 工具调用 ============

  /**
   * 调用工具
   * @param serverName 服务器名称
   * @param toolName 工具名称
   * @param args 调用参数
   * @returns 工具调用结果
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    // 验证工具存在
    const tool = await this.getTool(serverName, toolName);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool not found: ${toolName} on server ${serverName}`,
          },
        ],
        isError: true,
      };
    }

    // 验证参数
    const validation = this.validateArgs(tool, args);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid arguments: ${validation.errors?.join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    // 创建调用记录
    const callId = this.generateCallId();
    const callInfo: CallInfo = {
      callId,
      serverName,
      toolName,
      args,
      startTime: Date.now(),
      completed: false,
      cancelled: false,
    };
    this.pendingCalls.set(callId, callInfo);

    try {
      // 调用工具
      const result = await this.connectionManager.callTool(serverName, toolName, args);

      // 检查是否被取消
      if (callInfo.cancelled) {
        return {
          content: [
            {
              type: 'text',
              text: 'Tool call was cancelled',
            },
          ],
          isError: true,
        };
      }

      callInfo.completed = true;
      return result;
    } catch (err) {
      callInfo.completed = true;
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    } finally {
      // 清理调用记录（延迟清理以便可以查询状态）
      setTimeout(() => {
        this.pendingCalls.delete(callId);
      }, 5000);
    }
  }

  /**
   * 带超时的工具调用
   * @param serverName 服务器名称
   * @param toolName 工具名称
   * @param args 调用参数
   * @param timeout 超时时间（毫秒）
   * @returns 工具调用结果
   */
  async callToolWithTimeout(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ToolCallResult> {
    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        resolve({
          content: [
            {
              type: 'text',
              text: `Tool call timed out after ${timeout}ms`,
            },
          ],
          isError: true,
        });
      }, timeout);

      this.callTool(serverName, toolName, args)
        .then((result) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeoutHandle);
          resolve({
            content: [
              {
                type: 'text',
                text: `Error calling tool: ${err instanceof Error ? err.message : 'Unknown error'}`,
              },
            ],
            isError: true,
          });
        });
    });
  }

  // ============ 参数验证 ============

  /**
   * 验证工具参数
   * @param tool MCP 工具定义
   * @param args 调用参数
   * @returns 验证结果
   */
  validateArgs(tool: McpTool, args: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const schema = tool.inputSchema;

    // 检查必需参数
    if (schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in args)) {
          errors.push(`Missing required field: ${requiredField}`);
        }
      }
    }

    // 检查参数类型（基本验证）
    if (schema.properties) {
      for (const [key, value] of Object.entries(args)) {
        const propSchema = schema.properties[key];
        if (!propSchema) {
          // 不在 schema 中的字段（可能允许额外字段）
          continue;
        }

        // 验证类型
        const validationError = this.validateValue(value, propSchema, key);
        if (validationError) {
          errors.push(validationError);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 验证单个值
   * @param value 要验证的值
   * @param schema 值的 schema
   * @param fieldName 字段名称
   * @returns 错误信息，如果有效则返回 null
   */
  private validateValue(value: unknown, schema: JSONSchema, fieldName: string): string | null {
    const actualType = this.getType(value);

    // 检查类型
    if (schema.type) {
      const expectedType = schema.type;

      // 处理数组类型
      if (expectedType === 'array') {
        if (!Array.isArray(value)) {
          return `Field ${fieldName}: expected array, got ${actualType}`;
        }
        // 如果有 items schema，验证数组元素
        if (schema.items && Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const itemError = this.validateValue(value[i], schema.items, `${fieldName}[${i}]`);
            if (itemError) {
              return itemError;
            }
          }
        }
        return null;
      }

      // 处理对象类型
      if (expectedType === 'object') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return `Field ${fieldName}: expected object, got ${actualType}`;
        }
        return null;
      }

      // 处理基本类型
      if (expectedType !== actualType && expectedType !== 'any') {
        // 特殊处理：integer 可以接受 number
        if (expectedType === 'integer' && actualType === 'number') {
          if (!Number.isInteger(value as number)) {
            return `Field ${fieldName}: expected integer, got float`;
          }
          return null;
        }

        return `Field ${fieldName}: expected ${expectedType}, got ${actualType}`;
      }
    }

    // 检查枚举值
    if (schema.enum && !schema.enum.includes(value)) {
      return `Field ${fieldName}: value must be one of ${schema.enum.join(', ')}`;
    }

    return null;
  }

  /**
   * 获取 JavaScript 值的类型字符串
   * @param value 要检查的值
   * @returns 类型字符串
   */
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';

    const type = typeof value;
    if (type === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number';
    }

    return type;
  }

  // ============ 调用管理 ============

  /**
   * 取消工具调用
   * @param callId 调用 ID
   */
  cancelCall(callId: string): void {
    const callInfo = this.pendingCalls.get(callId);
    if (callInfo && !callInfo.completed) {
      callInfo.cancelled = true;
    }
  }

  /**
   * 获取所有待处理的调用
   * @returns 调用信息数组
   */
  getPendingCalls(): CallInfo[] {
    return Array.from(this.pendingCalls.values()).filter((call) => !call.completed);
  }

  /**
   * 生成调用 ID
   * @returns 唯一的调用 ID
   */
  private generateCallId(): string {
    return `call_${++this.callIdCounter}_${Date.now()}`;
  }

  // ============ 批量调用 ============

  /**
   * 批量调用多个工具
   * @param calls 工具调用数组
   * @returns 调用结果数组（按输入顺序）
   */
  async callToolsBatch(calls: ToolCall[]): Promise<ToolCallResult[]> {
    // 并行执行所有调用
    const promises = calls.map((call) =>
      this.callTool(call.serverName, call.toolName, call.args)
    );

    // 等待所有调用完成
    const results = await Promise.allSettled(promises);

    // 转换结果
    return results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Batch call failed: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }
}

// ============ MCP 工具搜索模式 (v2.1.7+) ============

/**
 * MCP 工具搜索模式
 * - 'tst-auto': 自动模式（默认），当工具描述超过阈值时启用搜索
 * - 'tst': 强制启用工具搜索
 * - 'mcp-cli': MCP CLI 模式
 * - 'standard': 标准模式，不使用工具搜索
 */
export type McpToolSearchMode = 'tst-auto' | 'tst' | 'mcp-cli' | 'standard';

// 官方常量（来自 cli.js）
const DEFAULT_TOOL_SEARCH_PERCENTAGE = 10;  // WX0 = 10 (默认 10%)
const TOOL_SEARCH_CHAR_MULTIPLIER = 2.5; // W25 = 2.5 (字符数乘数)

/**
 * v2.1.9: 解析 auto:N 语法
 *
 * 官方实现（DX0 函数）：
 * function DX0(A){
 *   if(!A.startsWith("auto:"))return null;
 *   let Q=A.slice(5), B=parseInt(Q,10);
 *   if(isNaN(B)) return k(`Invalid ENABLE_TOOL_SEARCH value "${A}": expected auto:N where N is a number.`),null;
 *   return Math.max(0,Math.min(100,B))
 * }
 *
 * @param value 环境变量值
 * @returns 解析出的百分比值 (0-100)，如果不是 auto:N 格式返回 null
 */
function parseAutoNSyntax(value: string): number | null {
  if (!value.startsWith('auto:')) {
    return null;
  }

  const numStr = value.slice(5);
  const num = parseInt(numStr, 10);

  if (isNaN(num)) {
    console.warn(`Invalid ENABLE_TOOL_SEARCH value "${value}": expected auto:N where N is a number.`);
    return null;
  }

  // 限制在 0-100 范围内
  return Math.max(0, Math.min(100, num));
}

/**
 * v2.1.9: 检查是否为 auto 模式（包括 auto 和 auto:N）
 *
 * 官方实现（F22 函数）：
 * function F22(A){ if(!A)return!1; return A==="auto" || A.startsWith("auto:") }
 */
function isAutoMode(value: string | undefined): boolean {
  if (!value) return false;
  return value === 'auto' || value.startsWith('auto:');
}

/**
 * v2.1.9: 获取工具搜索的百分比阈值
 *
 * 官方实现（H22 函数）：
 * function H22(){
 *   let A=process.env.ENABLE_TOOL_SEARCH;
 *   if(!A)return WX0;
 *   if(A==="auto")return WX0;
 *   let Q=DX0(A);
 *   if(Q!==null)return Q;
 *   return WX0;
 * }
 *
 * @returns 百分比值 (0-100)
 */
export function getToolSearchPercentage(): number {
  const value = process.env.ENABLE_TOOL_SEARCH;

  if (!value) {
    return DEFAULT_TOOL_SEARCH_PERCENTAGE;
  }

  if (value === 'auto') {
    return DEFAULT_TOOL_SEARCH_PERCENTAGE;
  }

  const parsed = parseAutoNSyntax(value);
  if (parsed !== null) {
    return parsed;
  }

  return DEFAULT_TOOL_SEARCH_PERCENTAGE;
}

// 向后兼容：保留旧常量（计算得出）
const TOOL_SEARCH_CONTEXT_RATIO = DEFAULT_TOOL_SEARCH_PERCENTAGE / 100;

/**
 * 获取 MCP 工具搜索模式 (v2.1.7+, v2.1.9 新增 auto:N 支持)
 *
 * 基于官方 Qt8() / V4A() 函数实现
 * 默认返回 'tst-auto'（自动模式）
 *
 * v2.1.9 支持的值：
 * - "auto:N" - 自动模式，使用 N% 的上下文窗口作为阈值（0-100）
 * - "auto" - 自动模式，使用默认 10% 阈值
 * - "true" / "1" - 强制启用工具搜索（tst 模式）
 * - "false" / "0" - 禁用工具搜索（standard 模式）
 */
export function getMcpToolSearchMode(): McpToolSearchMode {
  const value = process.env.ENABLE_TOOL_SEARCH;

  // v2.1.9: 支持 auto:N 语法
  if (isAutoMode(value)) {
    return 'tst-auto';
  }

  // 环境变量显式启用工具搜索
  if (value === 'true' || value === '1') {
    return 'tst';
  }

  // 环境变量启用 MCP CLI 模式
  if (process.env.ENABLE_MCP_CLI === 'true' || process.env.ENABLE_MCP_CLI === '1') {
    return 'mcp-cli';
  }

  // 环境变量显式禁用 MCP CLI
  if (process.env.ENABLE_MCP_CLI === 'false' || process.env.ENABLE_MCP_CLI === '0') {
    return 'standard';
  }

  // 环境变量显式禁用工具搜索
  if (value === 'false' || value === '0') {
    return 'standard';
  }

  // v2.1.7+: 默认启用自动模式
  return 'tst-auto';
}

/**
 * 获取外部 MCP 工具搜索模式 (v2.1.9 新增 auto:N 支持)
 *
 * 基于官方 k9A() 函数实现
 */
export function getExternalMcpToolSearchMode(): McpToolSearchMode {
  const value = process.env.ENABLE_TOOL_SEARCH;

  // v2.1.9: 支持 auto:N 语法
  if (isAutoMode(value)) {
    return 'tst-auto';
  }

  if (value === 'true' || value === '1') {
    return 'tst';
  }

  if (process.env.ENABLE_EXPERIMENTAL_MCP_CLI === 'true' || process.env.ENABLE_EXPERIMENTAL_MCP_CLI === '1') {
    return 'mcp-cli';
  }

  if (value === 'false' || value === '0') {
    return 'standard';
  }

  if (process.env.ENABLE_EXPERIMENTAL_MCP_CLI === 'false' || process.env.ENABLE_EXPERIMENTAL_MCP_CLI === '0') {
    return 'standard';
  }

  // v2.1.7+: 默认启用自动模式
  return 'tst-auto';
}

/**
 * 计算自动工具搜索的字符阈值 (v2.1.7+, v2.1.9 支持 auto:N)
 *
 * 基于官方 E22() 函数实现
 * 当 MCP 工具描述超过这个阈值时，自动启用工具搜索
 *
 * 计算公式（v2.1.9）：contextWindow * (percentage/100) * 2.5
 *
 * @param contextWindowSize 上下文窗口大小
 * @returns 字符阈值
 */
export function getAutoToolSearchCharThreshold(contextWindowSize: number): number {
  const percentage = getToolSearchPercentage();
  return Math.floor(contextWindowSize * (percentage / 100) * TOOL_SEARCH_CHAR_MULTIPLIER);
}

/**
 * 计算 MCP 工具描述的总字符数
 *
 * @param tools MCP 工具列表
 * @returns 总字符数
 */
export function calculateMcpToolsCharCount(tools: McpTool[]): number {
  let totalChars = 0;

  for (const tool of tools) {
    // 工具名称
    totalChars += tool.name.length;

    // 工具描述
    if (tool.description) {
      totalChars += tool.description.length;
    }

    // 输入 schema（JSON 序列化）
    if (tool.inputSchema) {
      totalChars += JSON.stringify(tool.inputSchema).length;
    }
  }

  return totalChars;
}

/**
 * 检查是否应该启用工具搜索 (v2.1.7+)
 *
 * 基于官方 RZ0() 函数实现
 *
 * @param mode 当前工具搜索模式
 * @param tools MCP 工具列表
 * @param contextWindowSize 上下文窗口大小
 * @returns 是否应该启用工具搜索
 */
export function shouldEnableToolSearch(
  mode: McpToolSearchMode,
  tools: McpTool[],
  contextWindowSize: number
): boolean {
  // 强制启用模式
  if (mode === 'tst') {
    return true;
  }

  // 标准模式或 MCP CLI 模式，不启用工具搜索
  if (mode === 'standard' || mode === 'mcp-cli') {
    return false;
  }

  // 自动模式：检查工具描述是否超过阈值
  if (mode === 'tst-auto') {
    const mcpTools = tools.filter(t => t.serverName !== undefined);
    if (mcpTools.length === 0) {
      return false;
    }

    const toolsCharCount = calculateMcpToolsCharCount(mcpTools);
    const threshold = getAutoToolSearchCharThreshold(contextWindowSize);

    // 当工具描述超过阈值时启用工具搜索
    return toolsCharCount >= threshold;
  }

  return false;
}

/**
 * 检查工具搜索是否乐观启用
 *
 * @returns 是否乐观启用
 */
export function isToolSearchEnabledOptimistic(): boolean {
  const mode = getExternalMcpToolSearchMode();
  return mode === 'tst' || mode === 'tst-auto';
}

// ============ 辅助函数 ============

/**
 * 从 MCP 工具创建工具定义
 * @param mcpTool MCP 工具
 * @returns Claude 工具定义
 */
export function createToolDefinition(mcpTool: McpTool): ToolDefinition {
  return {
    name: `mcp__${mcpTool.serverName}__${mcpTool.name}`,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    inputSchema: {
      type: 'object',
      properties: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
    },
    isMcp: true,
  };
}

// ============ Deferred Tool 机制 (对齐官方 v2.1.34) ============

/**
 * 判断工具是否为 deferred 工具
 *
 * 对齐官方 isDeferredTool (OG) 函数：
 * function OG(A){ if(A.isMcp===true) return true; return false; }
 *
 * @param tool 工具定义
 * @returns 是否为 deferred 工具
 */
export function isDeferredTool(tool: ToolDefinition): boolean {
  if (tool.isMcp === true) return true;
  return false;
}

/**
 * 从消息历史中提取已发现的 deferred 工具名称
 *
 * 对齐官方 abA 函数：扫描消息历史中 MCPSearch/ToolSearch 的 tool_result，
 * 找出模型之前通过 ToolSearch 已选中加载的 MCP 工具名
 *
 * 官方实现：
 * function abA(A){
 *   let q=new Set;
 *   for(let K of A){
 *     if(K.type!=="user")continue;
 *     let Y=K.message?.content;
 *     if(!Array.isArray(Y))continue;
 *     for(let z of Y)
 *       if(k9z(z))  // 是 tool_result 类型
 *         for(let w of z.content)
 *           if(E9z(w))  // 是 tool_name reference
 *             q.add(w.tool_name)
 *   }
 *   return q
 * }
 *
 * @param messages 消息历史
 * @returns 已发现的工具名称集合
 */
export function getDiscoveredToolsFromMessages(messages: Array<Record<string, any>>): Set<string> {
  const discovered = new Set<string>();

  for (const msg of messages) {
    // 只扫描 user 消息（tool_result 在 user 消息中）
    if (msg.role !== 'user') continue;

    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      // tool_result 块
      if (block.type === 'tool_result') {
        const resultContent = block.content;
        if (!Array.isArray(resultContent)) {
          // 如果 content 是字符串，尝试解析 MCP 工具名
          if (typeof resultContent === 'string') {
            extractMcpToolNames(resultContent, discovered);
          }
          continue;
        }
        for (const item of resultContent) {
          // 检查 tool_name reference（对齐官方 E9z 检查）
          if (item.type === 'tool_reference' && item.tool_name) {
            discovered.add(item.tool_name);
          }
          // 也从文本内容中提取
          if (item.type === 'text' && item.text) {
            extractMcpToolNames(item.text, discovered);
          }
        }
      }
    }
  }

  return discovered;
}

/**
 * 从文本中提取 MCP 工具名
 * MCPSearchTool 返回的结果中包含工具名
 */
function extractMcpToolNames(text: string, discovered: Set<string>): void {
  // 匹配 "mcp__server__tool" 模式的工具名
  const mcpToolNameRegex = /\bmcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+\b/g;
  let match;
  while ((match = mcpToolNameRegex.exec(text)) !== null) {
    discovered.add(match[0]);
  }
}

/**
 * 生成 ToolSearch 工具的 prompt（包含 deferred 工具列表）
 *
 * 对齐官方 r$6 / getPrompt 函数
 *
 * @param allTools 所有工具
 * @param basePrompt ToolSearch 工具的基础 prompt
 * @returns 包含 deferred 工具列表的完整 prompt
 */
export function getToolSearchPrompt(allTools: ToolDefinition[], basePrompt: string): string {
  const deferredTools = allTools.filter(isDeferredTool);

  if (deferredTools.length === 0) {
    return basePrompt;
  }

  const toolNames = deferredTools.map(t => t.name).join('\n');
  return `${basePrompt}

Available deferred tools (must be loaded before use):
${toolNames}`;
}

/**
 * 转换 MCP 结果为字符串
 * @param result 工具调用结果
 * @returns 格式化的字符串
 */
export function convertMcpResult(result: ToolCallResult): string {
  if (result.isError) {
    return `Error: ${result.content.map((c) => c.text || '').join('\n')}`;
  }

  const parts: string[] = [];

  for (const content of result.content) {
    switch (content.type) {
      case 'text':
        if (content.text) {
          parts.push(content.text);
        }
        break;

      case 'image':
        if (content.data && content.mimeType) {
          parts.push(`[Image: ${content.mimeType}]`);
        }
        break;

      case 'resource':
        if (content.text) {
          parts.push(content.text);
        } else if (content.data) {
          parts.push(`[Resource data: ${content.mimeType || 'unknown type'}]`);
        }
        break;
    }
  }

  return parts.join('\n\n');
}
