/**
 * 主对话循环
 * 处理用户输入、工具调用和响应
 */

import { ClaudeClient, type ClientConfig } from './client.js';
import { Session, setCurrentSessionId } from './session.js';
import { toolRegistry } from '../tools/index.js';
import { runWithCwd, runGeneratorWithCwd } from './cwd-context.js';
import { isToolSearchEnabled } from '../tools/mcp.js';
import { isDeferredTool, getDiscoveredToolsFromMessages } from '../mcp/tools.js';
import type { Message, ContentBlock, ToolDefinition, PermissionMode, AnyContentBlock, ToolResult } from '../types/index.js';

// ============================================================================
// 官方 v2.1.2 AppState 类型定义 - 响应式状态管理
// ============================================================================

/**
 * 工具权限上下文 - 官方实现
 * 存储当前的权限模式和相关配置
 */
export interface ToolPermissionContext {
  mode: PermissionMode;
  /** 额外的工作目录 */
  additionalWorkingDirectories?: Map<string, boolean>;
  /** 始终允许的规则 */
  alwaysAllowRules?: {
    command?: string[];
    file?: string[];
  };
  /** 是否避免权限提示 */
  shouldAvoidPermissionPrompts?: boolean;
}

/**
 * 应用状态 - 官方实现
 * 通过 getAppState() 实时获取
 */
export interface AppState {
  toolPermissionContext: ToolPermissionContext;
}

/**
 * 创建默认的 ToolPermissionContext
 */
export function createDefaultToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {
      command: [],
      file: [],
    },
    shouldAvoidPermissionPrompts: false,
  };
}
import chalk from 'chalk';
import {
  SystemPromptBuilder,
  systemPromptBuilder,
  type PromptContext,
  type SystemPromptOptions,
} from '../prompt/index.js';
import { modelConfig, type ThinkingConfig } from '../models/index.js';
import { initAuth, getAuth, ensureOAuthApiKey } from '../auth/index.js';
import { runPermissionRequestHooks } from '../hooks/index.js';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setParentModelContext } from '../tools/agent.js';
import { configManager } from '../config/index.js';
import { accountUsageManager } from '../ratelimit/index.js';
import { initNotebookManager, getNotebookManager } from '../memory/notebook.js';
import {
  isSessionMemoryEnabled as checkSessionMemoryEnabled,
  SESSION_MEMORY_TEMPLATE,
  isEmptyTemplate,
  initSessionMemory,
  readSessionMemory,
  writeSessionMemory,
  getSummaryPath,
  getUpdatePrompt,
  formatForSystemPrompt,
  waitForWrite as waitForSessionMemoryWrite,
  setLastCompactedUuid as setSessionMemoryLastCompactedUuid,
  getLastCompactedUuid as getSessionMemoryLastCompactedUuid,
} from '../context/session-memory.js';

// ============================================================================
// 持久化输出常量
// ============================================================================

/** 持久化输出起始标签 */
const PERSISTED_OUTPUT_START = '<persisted-output>';

/** 持久化输出结束标签 */
const PERSISTED_OUTPUT_END = '</persisted-output>';

/** 最大输出行数限制 */
const MAX_OUTPUT_LINES = 2000;

/** 输出阈值（字符数），超过此值使用持久化标签 */
const OUTPUT_THRESHOLD = 400000; // 400KB

/** 预览大小（字节） */
const PREVIEW_SIZE = 2000; // 2KB

// ============================================================================
// v2.1.27: 调试日志功能 - 工具失败和拒绝记录
// ============================================================================

/**
 * 调试日志类型
 */
type DebugLogType = 'tool_denied' | 'tool_failed' | 'tool_error' | 'permission_denied';

/**
 * 调试日志条目
 */
interface DebugLogEntry {
  timestamp: string;
  type: DebugLogType;
  toolName?: string;
  reason?: string;
  error?: string;
  input?: unknown;
  sessionId?: string;
}

/**
 * 写入调试日志
 *
 * @param entry 调试日志条目
 */
function writeDebugLogEntry(entry: DebugLogEntry): void {
  // 只有在 DEBUG 模式下才记录
  if (!process.env.DEBUG && !process.env.CLAUDE_CODE_DEBUG) {
    return;
  }

  try {
    const logDir = path.join(os.homedir(), '.claude', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'debug.log');
    const logLine = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    }) + '\n';

    fs.appendFileSync(logFile, logLine, 'utf-8');
  } catch {
    // 静默忽略日志写入错误
  }
}

/**
 * 记录工具拒绝
 */
function logToolDenied(toolName: string, reason: string, sessionId?: string): void {
  writeDebugLogEntry({
    timestamp: new Date().toISOString(),
    type: 'tool_denied',
    toolName,
    reason,
    sessionId,
  });

  if (process.env.DEBUG) {
    console.log(chalk.yellow(`[Debug] Tool denied: ${toolName} - ${reason}`));
  }
}

/**
 * 记录工具执行失败
 */
function logToolFailed(toolName: string, error: string, input?: unknown, sessionId?: string): void {
  writeDebugLogEntry({
    timestamp: new Date().toISOString(),
    type: 'tool_failed',
    toolName,
    error,
    input,
    sessionId,
  });

  if (process.env.DEBUG) {
    console.log(chalk.red(`[Debug] Tool failed: ${toolName} - ${error}`));
  }
}

/**
 * 记录权限拒绝
 */
function logPermissionDenied(toolName: string, reason: string, sessionId?: string): void {
  writeDebugLogEntry({
    timestamp: new Date().toISOString(),
    type: 'permission_denied',
    toolName,
    reason,
    sessionId,
  });

  if (process.env.DEBUG) {
    console.log(chalk.yellow(`[Debug] Permission denied: ${toolName} - ${reason}`));
  }
}

/**
 * 可清理的工具白名单（官方策略）
 * 只有这些工具的结果会被自动清理
 * 其他工具（如 NotebookEdit、MultiEdit 等）不会被清理
 */
const COMPACTABLE_TOOLS = new Set([
  'Read',
  'Bash',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
  'Edit',
  'Write'
]);

// ============================================================================
// Microcompact 常量（第一层清理机制）
// ============================================================================

/**
 * 最小节省阈值（tokens）
 * 只有当清理能节省超过此值的 tokens 时才执行清理
 * 官方值：qy5 = 20000
 */
const MIN_SAVINGS_THRESHOLD = 20000;

/**
 * Microcompact 触发阈值（tokens）
 * 当消息历史超过此值时，才考虑执行清理
 * 官方值：Ny5 = 40000
 */
const MICROCOMPACT_THRESHOLD = 40000;

/**
 * 保留最近的工具结果数量
 * 最近的 N 个可清理工具结果不会被清理
 * 官方值：Ly5 = 3
 */
const KEEP_RECENT_COUNT = 3;

// ============================================================================
// v2.1.6: 速率限制警告集成
// ============================================================================

/**
 * 速率限制信息接口
 * 对齐官方 anthropic-ratelimit-unified-* 响应头
 */
interface RateLimitInfo {
  /** 使用率状态: allowed, allowed_warning, rejected */
  status: 'allowed' | 'allowed_warning' | 'rejected';
  /** 使用率 (0-1) */
  utilization?: number;
  /** 重置时间 (Unix timestamp in seconds) */
  resetsAt?: number;
  /** 限制类型: five_hour, seven_day, overage 等 */
  rateLimitType?: string;
  /** 是否支持回退 */
  unifiedRateLimitFallbackAvailable: boolean;
  /** 是否使用超额 */
  isUsingOverage: boolean;
}

/**
 * 从响应头中提取速率限制信息
 * 对齐官方 lrB 函数
 *
 * @param headers 响应头对象 (Response.headers)
 * @returns 速率限制信息
 */
function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const status = (headers.get('anthropic-ratelimit-unified-status') || 'allowed') as 'allowed' | 'allowed_warning' | 'rejected';
  const resetStr = headers.get('anthropic-ratelimit-unified-reset');
  const resetsAt = resetStr ? Number(resetStr) : undefined;
  const fallbackAvailable = headers.get('anthropic-ratelimit-unified-fallback') === 'available';
  const representativeClaim = headers.get('anthropic-ratelimit-unified-representative-claim');
  const overageStatus = headers.get('anthropic-ratelimit-unified-overage-status');

  // 检测是否使用超额
  const isUsingOverage = status === 'rejected' && (overageStatus === 'allowed' || overageStatus === 'allowed_warning');

  // 构建基础信息
  const info: RateLimitInfo = {
    status,
    resetsAt,
    unifiedRateLimitFallbackAvailable: fallbackAvailable,
    isUsingOverage,
  };

  // 添加限制类型
  if (representativeClaim) {
    info.rateLimitType = representativeClaim;
  }

  // 尝试从具体的 claim 头中获取使用率
  // 官方支持的 claim 类型: 5h (five_hour), 7d (seven_day), overage
  const claimTypes = ['5h', '7d', 'overage'];
  for (const claim of claimTypes) {
    const utilizationStr = headers.get(`anthropic-ratelimit-unified-${claim}-utilization`);
    const thresholdStr = headers.get(`anthropic-ratelimit-unified-${claim}-surpassed-threshold`);

    if (utilizationStr !== null) {
      info.utilization = Number(utilizationStr);
      if (thresholdStr !== null && info.status === 'allowed') {
        info.status = 'allowed_warning';
      }
      break;
    }
  }

  return info;
}

/**
 * 更新账户使用率状态并显示警告
 * 对齐官方 pG0 函数
 *
 * @param headers 响应头对象
 * @param verbose 是否显示详细日志
 */
function updateRateLimitStatus(headers: Headers, verbose?: boolean): void {
  const info = parseRateLimitHeaders(headers);

  // 更新 accountUsageManager 状态
  if (info.utilization !== undefined && info.resetsAt !== undefined) {
    // 计算 used 和 limit（根据使用率反推）
    // 假设基础限额为 100（实际限额取决于订阅类型）
    const baseLimit = 100;
    const used = Math.round(info.utilization * baseLimit);
    const resetDate = new Date(info.resetsAt * 1000);

    accountUsageManager.updateUsage(used, baseLimit, resetDate);

    if (verbose) {
      console.log(chalk.gray(`[RateLimit] Status: ${info.status}, Utilization: ${Math.round(info.utilization * 100)}%`));
    }
  }

  // 获取并显示警告消息
  const warningMessage = accountUsageManager.getWarningMessage();
  if (warningMessage) {
    console.log(chalk.yellow(`\n[Rate Limit Warning] ${warningMessage}\n`));
  }
}

// ============================================================================
// 工具结果处理辅助函数
// ============================================================================

/**
 * 检查环境变量是否为真值
 * 对齐官方 F0 函数实现
 * 支持的真值：'1', 'true', 'yes', 'on'（不区分大小写）
 * @param value 环境变量值
 * @returns 是否为真值
 */
function isEnvTrue(value: string | undefined): boolean {
  if (!value) return false;
  if (typeof value === 'boolean') return value;
  const normalized = value.toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

/**
 * 简单的 token 估算函数
 * 官方实现：使用字符数除以 4 作为近似值
 * 这个估算足够用于决策是否清理
 * @param content 文本内容
 * @returns 估算的 token 数
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * 智能截断输出内容
 * 优先在换行符处截断，以保持内容的可读性
 * @param content 原始内容
 * @param maxSize 最大字节数
 * @returns 截断结果 { preview: 预览内容, hasMore: 是否有更多内容 }
 */
function truncateOutput(content: string, maxSize: number): { preview: string; hasMore: boolean } {
  if (content.length <= maxSize) {
    return { preview: content, hasMore: false };
  }

  // 找到最后一个换行符的位置
  const lastNewline = content.slice(0, maxSize).lastIndexOf('\n');

  // 如果换行符在前半部分（>50%），就在换行符处截断，否则直接截断
  const cutoff = lastNewline > maxSize * 0.5 ? lastNewline : maxSize;

  return {
    preview: content.slice(0, cutoff),
    hasMore: true,
  };
}

/**
 * 使用持久化标签包装大型输出
 * 生成带预览的持久化格式
 * @param content 输出内容
 * @returns 包装后的内容
 */
function wrapPersistedOutput(content: string): string {
  // 如果输出未超过阈值，直接返回
  if (content.length <= OUTPUT_THRESHOLD) {
    return content;
  }

  // 生成预览
  const { preview, hasMore } = truncateOutput(content, PREVIEW_SIZE);

  // 格式化持久化输出
  let result = `${PERSISTED_OUTPUT_START}\n`;
  result += `Preview (first ${PREVIEW_SIZE} bytes):\n`;
  result += preview;
  if (hasMore) {
    result += '\n...\n';
  } else {
    result += '\n';
  }
  result += PERSISTED_OUTPUT_END;

  return result;
}

/**
 * 格式化工具结果
 * 统一处理所有工具的输出，根据大小自动应用持久化
 * @param toolName 工具名称（暂未使用，保留用于未来扩展）
 * @param result 工具执行结果
 * @returns 格式化后的内容
 */
function formatToolResult(
  toolName: string,
  result: { success: boolean; output?: string; error?: string }
): string {
  // 获取原始内容
  let content: string;
  if (!result.success) {
    content = `Error: ${result.error}`;
  } else {
    content = result.output || '';
  }

  // 统一应用持久化处理（根据大小自动决定）
  content = wrapPersistedOutput(content);

  return content;
}

/**
 * 查找工具结果对应的工具名称
 * 用于确定是否应该清理某个工具的结果
 * @param messages 消息列表
 * @param toolUseId 工具使用 ID
 * @returns 工具名称，找不到则返回空字符串
 */
function findToolNameForResult(messages: Message[], toolUseId: string): string {
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_use' &&
          'id' in block &&
          block.id === toolUseId &&
          'name' in block
        ) {
          return block.name as string;
        }
      }
    }
  }
  return '';
}

// ============================================================================
// 孤立工具结果验证和修复（v2.1.7 修复）
// ============================================================================

/**
 * 默认的孤立工具错误消息
 * 对齐官方实现
 */
const ORPHANED_TOOL_ERROR_MESSAGE = 'Tool execution was interrupted during streaming. The tool call did not complete successfully.';

/**
 * 验证并修复孤立的 tool_result
 *
 * 问题场景：
 * 当流式执行中断时（网络错误、用户中止、sibling tool 失败等），
 * assistant 消息中可能已经有了 tool_use 块，但 user 消息中缺少对应的 tool_result。
 * 这会导致 Anthropic API 报错，因为 API 要求每个 tool_use 都必须有对应的 tool_result。
 *
 * 此函数会：
 * 1. 收集所有 assistant 消息中的 tool_use IDs
 * 2. 收集所有 user 消息中的 tool_result IDs
 * 3. 找出缺少 tool_result 的 tool_use（孤立的 tool_use）
 * 4. 为每个孤立的 tool_use 创建一个 error tool_result
 * 5. 将这些 error tool_result 追加到最后一个 user 消息中，或创建新的 user 消息
 *
 * 对齐 v2.1.7 的 "Fixed orphaned tool_result errors when sibling tools fail during streaming execution" 修复
 *
 * @param messages 消息列表
 * @returns 修复后的消息列表
 */
export function validateToolResults(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  // 1. 收集所有 tool_use IDs（从 assistant 消息中）
  const toolUseIds = new Set<string>();
  const toolUseNames = new Map<string, string>(); // id -> name 映射

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_use' &&
          'id' in block &&
          typeof block.id === 'string'
        ) {
          toolUseIds.add(block.id);
          if ('name' in block && typeof block.name === 'string') {
            toolUseNames.set(block.id, block.name);
          }
        }
      }
    }
  }

  // 如果没有任何 tool_use，直接返回
  if (toolUseIds.size === 0) {
    return messages;
  }

  // 2. 收集所有 tool_result IDs（从 user 消息中）
  const toolResultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_result' &&
          'tool_use_id' in block &&
          typeof block.tool_use_id === 'string'
        ) {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  // 3. 找出孤立的 tool_use（有 tool_use 但没有对应的 tool_result）
  const orphanedToolUseIds: string[] = [];
  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) {
      orphanedToolUseIds.push(id);
    }
  }

  // 如果没有孤立的 tool_use，直接返回
  if (orphanedToolUseIds.length === 0) {
    return messages;
  }

  // 4. 创建 error tool_result 块
  const errorToolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }> = [];
  for (const id of orphanedToolUseIds) {
    const toolName = toolUseNames.get(id) || 'unknown';
    errorToolResults.push({
      type: 'tool_result',
      tool_use_id: id,
      content: `Error: ${ORPHANED_TOOL_ERROR_MESSAGE} (Tool: ${toolName})`,
      is_error: true,
    });
  }

  // 5. 将 error tool_result 追加到消息列表
  // 策略：找到最后一条 assistant 消息之后的 user 消息，如果没有则创建一个新的
  const result = [...messages];

  // 从后往前找最后一个 assistant 消息的索引
  let lastAssistantIndex = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

  if (lastAssistantIndex === -1) {
    // 没有 assistant 消息，这不应该发生，但为了安全起见
    return messages;
  }

  // 检查最后一个 assistant 消息之后是否有 user 消息包含 tool_result
  let targetUserMsgIndex = -1;
  for (let i = lastAssistantIndex + 1; i < result.length; i++) {
    const msg = result[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // 检查是否包含 tool_result
      const hasToolResult = msg.content.some(
        (block) =>
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_result'
      );
      if (hasToolResult) {
        targetUserMsgIndex = i;
        break;
      }
    }
  }

  if (targetUserMsgIndex !== -1) {
    // 追加到现有的 user 消息中
    const existingUserMsg = result[targetUserMsgIndex];
    if (Array.isArray(existingUserMsg.content)) {
      result[targetUserMsgIndex] = {
        ...existingUserMsg,
        content: [...existingUserMsg.content, ...errorToolResults],
      };
    }
  } else {
    // 在最后一个 assistant 消息之后创建新的 user 消息
    const newUserMsg: Message = {
      role: 'user',
      content: errorToolResults,
    };
    // 插入到 lastAssistantIndex + 1 位置
    result.splice(lastAssistantIndex + 1, 0, newUserMsg);
  }

  // 输出调试信息
  if (orphanedToolUseIds.length > 0) {
    console.log(chalk.yellow(`[validateToolResults] Fixed ${orphanedToolUseIds.length} orphaned tool_use(s):`));
    for (const id of orphanedToolUseIds) {
      const toolName = toolUseNames.get(id) || 'unknown';
      console.log(chalk.yellow(`  - ${toolName} (${id})`));
    }
  }

  return result;
}

/**
 * 计算消息历史的总 token 数
 * 遍历所有消息内容，累加 token 估算值
 * @param messages 消息列表
 * @returns 总 token 数（估算值）
 */
function calculateTotalTokens(messages: Message[]): number {
  let totalTokens = 0;

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      // 字符串内容
      if (typeof msg.content === 'string') {
        totalTokens += estimateTokens(msg.content);
      }
      continue;
    }

    // 数组内容
    for (const block of msg.content) {
      if (typeof block === 'string') {
        totalTokens += estimateTokens(block);
      } else if (typeof block === 'object' && 'type' in block) {
        if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
          totalTokens += estimateTokens(block.text);
        } else if (block.type === 'image') {
          // 图片用固定常量，不能 JSON.stringify base64 数据（对齐官方 Nr4=2000）
          totalTokens += 2000;
        } else if (block.type === 'tool_result' && 'content' in block && typeof block.content === 'string') {
          totalTokens += estimateTokens(block.content);
        } else {
          totalTokens += estimateTokens(JSON.stringify(block));
        }
      }
    }
  }

  return totalTokens;
}

/**
 * 获取模型的上下文窗口大小
 * 对齐官方实现
 * @param model 模型 ID
 * @returns 上下文窗口大小（tokens）
 */
export function getContextWindowSize(model: string): number {
  // 检查是否是 1M 模型（带 [1m] 标记）
  if (model.includes('[1m]')) {
    return 1000000;
  }
  // 默认 200K 上下文窗口
  return 200000;
}

/**
 * 获取模型的最大输出 tokens
 * 对齐官方 kH0 函数
 * @param model 模型 ID
 * @returns 最大输出 tokens
 */
export function getMaxOutputTokens(model: string): number {
  let defaultMax: number;

  // 根据模型类型确定默认最大输出 tokens
  if (model.includes('opus-4-5')) {
    defaultMax = 64000;
  } else if (model.includes('opus-4')) {
    defaultMax = 32000;
  } else if (model.includes('sonnet-4') || model.includes('haiku-4')) {
    defaultMax = 64000;
  } else {
    defaultMax = 32000;
  }

  // 环境变量可以覆盖（但不能超过默认最大值）
  const envMax = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  if (envMax) {
    const parsed = parseInt(envMax, 10);
    if (!isNaN(parsed)) {
      return Math.min(parsed, defaultMax);
    }
  }

  return defaultMax;
}

/**
 * 计算可用的输入 token 空间
 * 对齐官方 EHA 函数
 * @param model 模型 ID
 * @returns 可用的输入 tokens
 */
export function calculateAvailableInput(model: string): number {
  return getContextWindowSize(model) - getMaxOutputTokens(model);
}

/**
 * 计算自动压缩阈值
 * 对齐官方 zT2 函数
 * @param model 模型 ID
 * @returns 自动压缩阈值（tokens）
 */
export function calculateAutoCompactThreshold(model: string): number {
  const availableInput = calculateAvailableInput(model);
  const vH0 = 13000; // Session Memory 压缩缓冲区
  const threshold = availableInput - vH0;

  // 环境变量可以覆盖百分比
  const override = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (override) {
    const pct = parseFloat(override);
    if (!isNaN(pct) && pct > 0 && pct <= 100) {
      return Math.min(Math.floor(availableInput * (pct / 100)), threshold);
    }
  }

  return threshold;
}

/**
 * 检查是否超过自动压缩阈值
 * 对齐官方 Sy5 函数
 * @param messages 消息列表
 * @param model 模型 ID
 * @returns 是否超过阈值
 */
export function isAboveAutoCompactThreshold(messages: Message[], model: string): boolean {
  const totalTokens = calculateTotalTokens(messages);
  const threshold = calculateAutoCompactThreshold(model);
  return totalTokens >= threshold;
}

/**
 * 综合判断是否应该自动压缩
 * @param messages 消息列表
 * @param model 模型 ID
 * @returns 是否应该自动压缩
 */
export function shouldAutoCompact(messages: Message[], model: string): boolean {
  // 1. 检查环境变量 - 如果禁用则直接返回
  if (isEnvTrue(process.env.DISABLE_COMPACT)) {
    return false;
  }

  // 2. 检查配置
  // 注意：这里可以从 configManager 读取 autoCompactEnabled
  // 但为了避免循环依赖，暂时跳过配置检查
  // 未来可以通过依赖注入的方式传入配置

  // 3. 检查是否超过阈值
  return isAboveAutoCompactThreshold(messages, model);
}

/**
 * 生成对话摘要的 prompt（对齐官方 aY0 函数）
 * @param customInstructions 自定义指令（可选）
 * @returns 摘要 prompt
 */
export function generateSummaryPrompt(customInstructions?: string): string {
  // 对齐官方 dDA 函数的完整摘要 prompt
  let prompt = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

IMPORTANT: Do NOT use any tools. You MUST respond with ONLY the <summary>...</summary> block as your text output.`;

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }

  return prompt;
}

/**
 * 创建压缩边界标记（对齐官方 LJ1 函数）
 * @param trigger 触发方式 ('auto' 或 'manual')
 * @param preTokens 压缩前的token数
 * @returns 边界标记消息
 */
function createCompactBoundaryMarker(trigger: 'auto' | 'manual', preTokens: number): Message {
  return {
    role: 'user',
    content: `--- Conversation Compacted (${trigger}) ---\nPrevious messages were summarized to save ${preTokens.toLocaleString()} tokens.`,
  };
}

/**
 * 格式化摘要消息（对齐官方 l71 函数）
 * @param summary 摘要内容
 * @param microcompact 是否为微压缩
 * @returns 格式化后的摘要文本
 */
function formatSummaryMessage(summary: string, microcompact: boolean): string {
  if (microcompact) {
    // 微压缩模式：保留原始摘要
    return summary;
  }

  // 正常模式：添加标记
  return `<conversation-summary>\n${summary}\n</conversation-summary>`;
}

/**
 * 清理摘要中的 XML 标签（对齐官方 oT9 函数）
 * 将 <analysis>...</analysis> 和 <summary>...</summary> 转为纯文本格式
 * @param summary 原始摘要文本
 * @returns 清理后的摘要文本
 */
export function cleanSummaryXmlTags(summary: string): string {
  let result = summary;

  // 将 <analysis>...</analysis> 转为 "Analysis:\n{content}"
  const analysisMatch = result.match(/<analysis>([\s\S]*?)<\/analysis>/);
  if (analysisMatch) {
    const content = analysisMatch[1] || '';
    result = result.replace(/<analysis>[\s\S]*?<\/analysis>/, `Analysis:\n${content.trim()}`);
  }

  // 将 <summary>...</summary> 转为 "Summary:\n{content}"
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    const content = summaryMatch[1] || '';
    result = result.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${content.trim()}`);
  }

  // 去除多余的连续空行
  result = result.replace(/\n\n+/g, '\n\n');

  return result.trim();
}

/**
 * 格式化压缩摘要内容（对齐官方 Au1 函数）
 * 将 AI 生成的摘要包装为标准格式的用户消息内容
 * @param summaryText AI 生成的原始摘要
 * @param isContinuation 是否为继续上次任务（添加 "Please continue..." 提示）
 * @returns 格式化后的消息内容
 */
export function formatCompactSummaryContent(summaryText: string, isContinuation: boolean): string {
  let content = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${cleanSummaryXmlTags(summaryText)}`;

  if (isContinuation) {
    content += `\nPlease continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`;
  }

  return content;
}

/**
 * 获取最后一个压缩边界后的消息（对齐官方 QS 函数）
 * @param messages 消息列表
 * @returns 最后一个边界后的消息
 */
function getMessagesSinceLastBoundary(messages: Message[]): Message[] {
  // 从后往前查找最后一个压缩边界标记
  // 边界标记的特征：用户消息，内容包含 "Conversation Compacted"
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg &&
      msg.role === 'user' &&
      typeof msg.content === 'string' &&
      msg.content.includes('Conversation Compacted')
    ) {
      // 返回边界标记之后的所有消息
      return messages.slice(i);
    }
  }

  // 如果没有找到边界标记，返回所有消息
  return messages;
}

// ============================================================================
// Layer 3: TJ1 - Session Memory 压缩相关函数
// ============================================================================

/**
 * 检查Session Memory功能是否启用（对齐官方 rF1 函数）
 *
 * 官方实现检查两个Feature Flags：
 * - tengu_session_memory
 * - tengu_sm_compact
 *
 * 官方使用远程 Feature Flag，我们直接写死为 true
 *
 * @returns 始终返回 true
 */
async function isSessionMemoryEnabled(): Promise<boolean> {
  // 官方检查 ROA("tengu_session_memory") && ROA("tengu_sm_compact")
  // 我们直接写死为 true，与官方功能保持一致
  return checkSessionMemoryEnabled();
}

/**
 * 获取Session Memory模板内容（对齐官方 vL0 函数）
 *
 * 官方使用内置模板 w97，包含 10 个结构化章节：
 * - Session Title, Current State, Task specification
 * - Files and Functions, Workflow, Errors & Corrections
 * - Codebase and System Documentation, Learnings
 * - Key results, Worklog
 *
 * @returns Session Memory模板内容
 */
function getSessionMemoryTemplate(): string | null {
  // 使用官方模板 w97
  return SESSION_MEMORY_TEMPLATE;
}

/**
 * 检查模板是否为空（对齐官方 Os2 函数）
 * @param template 模板内容
 * @returns 是否为空模板
 */
async function isTemplateEmpty(template: string): Promise<boolean> {
  // 使用新的 session-memory 模块的函数
  return isEmptyTemplate(template);
}

/**
 * 获取最后一次压缩的UUID（对齐官方 nj2 函数）
 *
 * 这个函数查找消息历史中最后一个Session Memory边界标记的UUID
 * 用于实现增量压缩（只压缩新消息，不重复压缩已压缩的内容）
 *
 * @param session 会话对象，用于获取存储的压缩状态
 * @returns 最后一次压缩的UUID，如果没有则返回null
 */
function getLastCompactedUuid(session?: Session): string | null {
  // 从会话状态中获取最后一次压缩的边界标记 UUID
  // 官方实现存储在会话状态中，用于支持增量压缩
  if (session) {
    return session.getLastCompactedUuid() || null;
  }
  return null;
}

/**
 * 等待异步操作（对齐官方 Ws2 函数）
 * 等待 session memory 写入完成
 */
async function waitForAsyncInit(): Promise<void> {
  // 等待 session memory 写入完成
  await waitForSessionMemoryWrite();
}

/**
 * 创建Session Memory压缩结果（对齐官方 jy5 函数）
 *
 * 这个函数构建压缩后的消息列表，包括：
 * - boundaryMarker: 边界标记（标识压缩点）
 * - summaryMessages: 摘要消息（Session Memory内容）
 * - attachments: 附件（如果有agentId）
 * - hookResults: Hook执行结果（如果有）
 * - messagesToKeep: 需要保留的新消息
 *
 * @param messages 所有消息
 * @param template 压缩模板
 * @param messagesToKeep 需要保留的消息
 * @param agentId 代理ID（可选）
 * @returns 压缩结果
 */
function createSessionMemoryCompactResult(
  messages: Message[],
  template: string,
  messagesToKeep: Message[],
  agentId?: string
): {
  boundaryMarker: Message;
  summaryMessages: Message[];
  attachments: Message[];
  hookResults: Message[];
  messagesToKeep: Message[];
  preCompactTokenCount: number;
  postCompactTokenCount: number;
} {
  // 1. 计算压缩前token数
  const preCompactTokenCount = calculateTotalTokens(messages);

  // 2. 创建边界标记（使用uuid字段标记这是Session Memory压缩）
  const boundaryUuid = `sm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const boundaryMarker: Message = {
    role: 'user',
    content: `--- Session Memory Compacted (auto) ---\nPrevious messages were compressed using Session Memory.`,
    uuid: boundaryUuid,
  };

  // 3. 创建摘要消息（对齐官方 Au1 函数格式）
  const summaryContent = formatCompactSummaryContent(template, true);
  const summaryMessage: Message = {
    role: 'user',
    content: summaryContent,
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
  };

  // 4. 创建附件（如果有agentId，添加agent上下文）
  const attachments: Message[] = [];
  if (agentId) {
    // 添加agent上下文附件
    attachments.push({
      role: 'user',
      content: `Agent context: ${agentId}`,
    });
  }

  // 5. Hook结果（暂时为空，未来可以扩展）
  const hookResults: Message[] = [];

  // 6. 计算压缩后token数（边界标记 + 摘要）
  const postCompactTokenCount = calculateTotalTokens([summaryMessage]);

  return {
    boundaryMarker,
    summaryMessages: [summaryMessage],
    attachments,
    hookResults,
    messagesToKeep,
    preCompactTokenCount,
    postCompactTokenCount,
  };
}

/**
 * 尝试Session Memory压缩（第三层 - 对齐官方 TJ1 函数）
 *
 * 核心流程：
 * 1. 检查Feature Flag是否启用
 * 2. 找到最后一个压缩边界标记的UUID
 * 3. 只压缩边界后的新消息（增量压缩）
 * 4. 使用AI模型生成Session Memory
 * 5. 检查压缩后是否仍超过阈值
 *
 * @param messages 当前消息历史
 * @param agentId 代理ID（可选）
 * @param autoCompactThreshold 自动压缩阈值（可选）
 * @param session 会话对象（可选，用于获取压缩状态）
 * @returns 压缩结果
 */
async function trySessionMemoryCompact(
  messages: Message[],
  agentId?: string,
  autoCompactThreshold?: number,
  session?: Session
): Promise<{
  success: boolean;
  messages: Message[];
  savedTokens: number;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
  boundaryMarker: Message;
  summaryMessages: Message[];
  attachments: Message[];
  hookResults: Message[];
  messagesToKeep: Message[];
} | null> {
  // 1. 检查Feature Flag是否启用
  if (!(await isSessionMemoryEnabled())) {
    return null;
  }

  // 2. 等待异步初始化
  await waitForAsyncInit();

  // 3. 获取最后一次压缩的UUID（从会话状态中读取）
  const lastCompactedUuid = getLastCompactedUuid(session);

  // 4. 获取Session Memory模板
  const template = getSessionMemoryTemplate();
  if (!template) {
    return null;
  }

  // 5. 检查模板是否为空
  if (await isTemplateEmpty(template)) {
    console.log(chalk.yellow('[TJ1] Session Memory模板为空，跳过压缩'));
    return null;
  }

  try {
    // 6. 确定需要压缩的消息范围（增量压缩）
    let messagesToCompress: Message[];
    if (lastCompactedUuid) {
      // 找到上次压缩边界的索引
      const lastBoundaryIndex = messages.findIndex((msg) => msg.uuid === lastCompactedUuid);

      if (lastBoundaryIndex === -1) {
        // 找不到边界标记，可能会话数据不一致
        messagesToCompress = [];
        console.log(chalk.yellow('[TJ1] 无法找到上次压缩边界，跳过压缩'));
      } else {
        // 只压缩边界之后的新消息
        messagesToCompress = messages.slice(lastBoundaryIndex + 1);
      }
    } else {
      // 首次压缩，压缩所有消息
      messagesToCompress = [];
      console.log(chalk.blue('[TJ1] 检测到恢复的会话，将进行完整压缩'));
    }

    // 7. 创建压缩结果（使用模板）
    const compactResult = createSessionMemoryCompactResult(
      messages,
      template,
      messagesToCompress,
      agentId
    );

    // 8. 构建最终消息列表
    const finalMessages = [
      compactResult.boundaryMarker,
      ...compactResult.summaryMessages,
      ...compactResult.attachments,
      ...compactResult.hookResults,
      ...compactResult.messagesToKeep,
    ];

    // 9. 计算最终token数
    const finalTokenCount = calculateTotalTokens(finalMessages);

    // 10. 检查压缩后是否仍超过阈值
    if (autoCompactThreshold !== undefined && finalTokenCount >= autoCompactThreshold) {
      console.log(
        chalk.yellow(
          `[TJ1] 压缩后token数 (${finalTokenCount.toLocaleString()}) 仍超过阈值 (${autoCompactThreshold.toLocaleString()})，跳过压缩`
        )
      );
      return null;
    }

    // 11. 返回压缩结果
    const savedTokens = compactResult.preCompactTokenCount - finalTokenCount;

    console.log(chalk.green('[TJ1] Session Memory压缩成功'));
    console.log(chalk.green(`[TJ1] 压缩前: ${compactResult.preCompactTokenCount.toLocaleString()} tokens`));
    console.log(chalk.green(`[TJ1] 压缩后: ${finalTokenCount.toLocaleString()} tokens`));
    console.log(chalk.green(`[TJ1] 节省: ${savedTokens.toLocaleString()} tokens`));

    return {
      success: true,
      messages: finalMessages,
      savedTokens,
      preCompactTokenCount: compactResult.preCompactTokenCount,
      postCompactTokenCount: finalTokenCount,
      boundaryMarker: compactResult.boundaryMarker,
      summaryMessages: compactResult.summaryMessages,
      attachments: compactResult.attachments,
      hookResults: compactResult.hookResults,
      messagesToKeep: compactResult.messagesToKeep,
    };
  } catch (error) {
    // 捕获所有异常，返回null（对齐官方实现）
    console.log(
      chalk.yellow(`[TJ1] Session Memory压缩失败: ${error instanceof Error ? error.message : String(error)}`)
    );
    return null;
  }
}

/**
 * 尝试进行对话摘要压缩（第二层 - 对齐官方 NJ1 函数）
 *
 * 核心流程：
 * 1. 验证消息列表不为空
 * 2. 获取最后一个边界标记后的消息
 * 3. 生成摘要 prompt
 * 4. 调用 AI 模型生成摘要（使用 streaming API）
 * 5. 创建压缩边界标记
 * 6. 返回压缩结果
 *
 * @param messages 当前消息历史
 * @param client Claude客户端（用于调用AI生成摘要）
 * @param customInstructions 自定义摘要指令（可选）
 * @returns 压缩结果
 */
async function tryConversationSummary(
  messages: Message[],
  client: ClaudeClient,
  customInstructions?: string
): Promise<{
  success: boolean;
  messages: Message[];
  savedTokens: number;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
} | null> {
  try {
    // 1. 验证输入
    if (messages.length === 0) {
      console.log(chalk.yellow('[NJ1] 消息列表为空，跳过摘要'));
      return null;
    }

    const preCompactTokenCount = calculateTotalTokens(messages);

    // 2. 获取最后一个边界标记后的消息（避免重复摘要）
    const messagesToSummarize = getMessagesSinceLastBoundary(messages);

    // 3. 生成摘要 prompt
    const summaryPrompt = generateSummaryPrompt(customInstructions);

    // 4. 创建摘要请求消息
    const summaryRequestMessage: Message = {
      role: 'user',
      content: summaryPrompt,
    };

    // 5. 调用 AI 模型生成摘要
    // 注意：使用当前模型（Haiku模型成本低，但这里遵循官方使用 p3()）
    console.log(chalk.blue('[NJ1] 正在生成对话摘要...'));

    const summaryMessages = [...messagesToSummarize, summaryRequestMessage];

    // 使用 client 的 sendMessage 方法生成摘要
    // 注意：这里简化实现，实际官方使用了streaming API
    let summaryText = '';

    try {
      // 调用 client 生成摘要（不使用工具）
      const response = await client.createMessage(
        summaryMessages,
        undefined, // 不需要工具
        'You are a helpful AI assistant tasked with summarizing conversations.'
      );

      // 提取文本响应
      if (Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.type === 'text') {
            summaryText += block.text;
          }
        }
      }

      if (!summaryText || summaryText.trim().length === 0) {
        console.log(chalk.yellow('[NJ1] AI返回空摘要，压缩失败'));
        return null;
      }

      // 检查是否是错误响应
      if (summaryText.startsWith('API Error') || summaryText.includes('Prompt is too long')) {
        console.log(chalk.yellow('[NJ1] AI返回错误响应，压缩失败'));
        return null;
      }

    } catch (error) {
      console.log(chalk.yellow(`[NJ1] 生成摘要时出错: ${error instanceof Error ? error.message : String(error)}`));
      return null;
    }

    // 6. 创建压缩边界标记
    const boundaryMarker = createCompactBoundaryMarker('auto', preCompactTokenCount);

    // 7. 创建摘要消息（对齐官方 Au1 函数）
    const formattedContent = formatCompactSummaryContent(summaryText, false);
    const summaryMessage: Message = {
      role: 'user',
      content: formattedContent,
    };

    // 8. 构建新的消息列表：[边界标记, 摘要消息]
    const compactedMessages = [boundaryMarker, summaryMessage];

    // 9. 计算压缩后的token数
    const postCompactTokenCount = calculateTotalTokens(compactedMessages);
    const savedTokens = preCompactTokenCount - postCompactTokenCount;

    console.log(chalk.green(`[NJ1] 摘要生成成功`));
    console.log(chalk.green(`[NJ1] 压缩前: ${preCompactTokenCount.toLocaleString()} tokens`));
    console.log(chalk.green(`[NJ1] 压缩后: ${postCompactTokenCount.toLocaleString()} tokens`));
    console.log(chalk.green(`[NJ1] 节省: ${savedTokens.toLocaleString()} tokens`));

    return {
      success: true,
      messages: compactedMessages,
      savedTokens,
      preCompactTokenCount,
      postCompactTokenCount,
    };

  } catch (error) {
    console.log(
      chalk.red(`[NJ1] 对话摘要压缩失败: ${error instanceof Error ? error.message : String(error)}`)
    );
    return null;
  }
}

/**
 * 自动压缩协调器（对齐官方 CT2 函数）
 *
 * 完整实现：Vd (MicroCompact) + NJ1 (对话摘要) + TJ1 (Session Memory)
 *
 * 压缩优先级：
 * 1. 优先尝试 TJ1 (Session Memory 压缩) - 保留长期记忆的智能压缩方式
 * 2. 如果 TJ1 失败或未启用，使用 NJ1 (对话总结) - 传统的对话总结方式
 * 3. Vd (MicroCompact) 在所有层之前自动运行
 *
 * @param messages 消息列表
 * @param model 模型名称
 * @param client Claude客户端（用于NJ1生成摘要）
 * @param session 会话对象（可选，用于获取/存储压缩状态）
 * @returns 压缩结果 { wasCompacted: 是否压缩, messages: 处理后的消息列表, boundaryUuid?: 边界标记UUID }
 */
async function autoCompact(
  messages: Message[],
  model: string,
  client: ClaudeClient,
  session?: Session
): Promise<{ wasCompacted: boolean; messages: Message[]; boundaryUuid?: string }> {
  // 1. 检查是否应该自动压缩
  if (!shouldAutoCompact(messages, model)) {
    return { wasCompacted: false, messages };
  }

  // 记录压缩决策
  const currentTokens = calculateTotalTokens(messages);
  const threshold = calculateAutoCompactThreshold(model);

  console.log(chalk.yellow('[AutoCompact] 检测到需要压缩'));
  console.log(chalk.yellow(`[AutoCompact] 当前 tokens: ${currentTokens.toLocaleString()}`));
  console.log(chalk.yellow(`[AutoCompact] 压缩阈值: ${threshold.toLocaleString()}`));
  console.log(chalk.yellow(`[AutoCompact] 超出: ${(currentTokens - threshold).toLocaleString()} tokens`));

  // 2. 优先尝试 TJ1 (Session Memory 压缩)
  const tj1Result = await trySessionMemoryCompact(messages, undefined, threshold, session);
  if (tj1Result && tj1Result.success) {
    console.log(chalk.green(`[AutoCompact] Session Memory压缩成功，节省 ${tj1Result.savedTokens.toLocaleString()} tokens`));
    // 获取边界标记的 UUID（用于增量压缩）
    const boundaryUuid = tj1Result.boundaryMarker?.uuid;
    return { wasCompacted: true, messages: tj1Result.messages, boundaryUuid };
  }

  // 3. 如果 TJ1 失败，使用 NJ1 (对话总结)
  const nj1Result = await tryConversationSummary(messages, client);
  if (nj1Result && nj1Result.success) {
    console.log(chalk.green(`[AutoCompact] 对话摘要成功，节省 ${nj1Result.savedTokens.toLocaleString()} tokens`));
    return { wasCompacted: true, messages: nj1Result.messages };
  }

  // 4. 所有压缩策略都失败，返回未压缩
  console.log(chalk.yellow('[AutoCompact] 所有压缩策略均失败，跳过压缩'));
  console.log(chalk.yellow('[AutoCompact] 提示：您可以通过设置 DISABLE_COMPACT=1 禁用此警告'));

  return { wasCompacted: false, messages };
}

/**
 * 清理消息历史中的旧持久化输出（完整版，对齐官方 Vd 函数）
 *
 * 实现三个层次的控制：
 * 1. 环境变量控制：DISABLE_MICROCOMPACT=1 完全禁用
 * 2. Token 阈值控制：只在消息 > 40K tokens 时清理
 * 3. 最小节省控制：只在能节省 > 20K tokens 时清理
 *
 * 只清理白名单中的工具结果，保护其他工具（如 NotebookEdit）
 *
 * @param messages 消息列表
 * @param keepRecent 保留最近的数量（默认 3，对齐 Ly5）
 * @returns 清理后的消息列表
 */
function cleanOldPersistedOutputs(messages: Message[], keepRecent: number = KEEP_RECENT_COUNT): Message[] {
  // 阶段1：检查环境变量 - 如果禁用则直接返回
  if (isEnvTrue(process.env.DISABLE_MICROCOMPACT)) {
    return messages;
  }

  // 收集所有可清理工具的持久化输出及其 token 数
  const persistedOutputs: {
    index: number;
    toolName: string;
    toolUseId: string;
    tokens: number;
  }[] = [];

  // 找到所有包含持久化输出的消息，并记录工具名称和 token 数
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_result' &&
          typeof block.content === 'string' &&
          block.content.includes(PERSISTED_OUTPUT_START) &&
          'tool_use_id' in block
        ) {
          const toolName = findToolNameForResult(messages, block.tool_use_id as string);

          // 官方策略：只跟踪可清理工具的结果
          if (COMPACTABLE_TOOLS.has(toolName)) {
            persistedOutputs.push({
              index: i,
              toolName,
              toolUseId: block.tool_use_id as string,
              tokens: estimateTokens(block.content)
            });
            break; // 一个消息只记录一次
          }
        }
      }
    }
  }

  // 如果没有足够的可清理输出，直接返回
  if (persistedOutputs.length <= keepRecent) {
    return messages;
  }

  // 阶段2：计算当前消息的总 token 数
  const totalTokens = calculateTotalTokens(messages);

  // 阶段3：计算清理能节省多少 tokens
  // 保留最近的 N 个，清理其余的
  const toClean = persistedOutputs.slice(0, -keepRecent);
  const totalSavings = toClean.reduce((sum, item) => sum + item.tokens, 0);

  // 阶段4：智能触发判断
  // 只有当满足以下两个条件时才清理：
  // 1. 总 token 数超过 MICROCOMPACT_THRESHOLD (40K)
  // 2. 能节省的 token 数超过 MIN_SAVINGS_THRESHOLD (20K)
  if (totalTokens <= MICROCOMPACT_THRESHOLD || totalSavings < MIN_SAVINGS_THRESHOLD) {
    return messages;
  }

  // 执行清理
  const indicesToClean = toClean.map(x => x.index);

  return messages.map((msg, index) => {
    if (!indicesToClean.includes(index)) {
      return msg;
    }

    // 清理这条消息中的持久化标签
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'tool_result' &&
            typeof block.content === 'string'
          ) {
            // 移除持久化标签，替换为简单的清理提示
            let content = block.content;
            if (content.includes(PERSISTED_OUTPUT_START)) {
              // 官方实现：直接替换为固定的清理消息
              content = '[Old tool result content cleared]';
            }
            return { ...block, content };
          }
          return block;
        }),
      };
    }

    return msg;
  });
}

export interface LoopOptions {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  verbose?: boolean;
  maxTurns?: number;
  // 权限模式 - 静态配置（优先级低于 getAppState）
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
  maxBudgetUSD?: number;
  // 新增选项
  workingDir?: string;
  planMode?: boolean;
  delegateMode?: boolean;
  ideType?: 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'terminal';
  fallbackModel?: string;
  thinking?: ThinkingConfig;
  debug?: boolean;
  /** 是否为 sub-agent（用于防止覆盖全局父模型上下文） */
  isSubAgent?: boolean;
  /**
   * 外部传入的认证信息（用于 WebUI 等场景，让子 agent 复用主 agent 的认证）
   * 如果提供，跳过 initAuth()/getAuth()，直接使用这些凭证
   */
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  /** v2.1.30: SDK 提供的 MCP 工具（传递给子代理） */
  mcpTools?: ToolDefinition[];
  /**
   * v2.1.33: 限制可生成的子 agent 类型
   * 当通过 Task(agent_type) 语法在 frontmatter 中指定时，
   * 子 loop 中的 Task 工具只能生成这些类型的 agent
   */
  allowedSubagentTypes?: string[];
  /**
   * 官方 v2.1.2 响应式状态获取回调
   * 用于实时获取应用状态（包括权限模式）
   * 如果提供此回调，权限模式将从 AppState.toolPermissionContext.mode 获取
   */
  getAppState?: () => AppState;
  /**
   * v4.2: AskUserQuestion 工具处理器
   * 在 WebUI 环境下，可以通过此回调拦截 AskUserQuestion 工具调用
   * 用于在前端显示对话框并等待用户响应
   */
  askUserHandler?: (input: AskUserQuestionHandlerInput) => Promise<AskUserQuestionHandlerResult>;
}

/**
 * v4.2: AskUserQuestion 处理器输入类型
 */
export interface AskUserQuestionHandlerInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

/**
 * v4.2: AskUserQuestion 处理器结果类型
 */
export interface AskUserQuestionHandlerResult {
  /** 用户的回答 header -> answer */
  answers: Record<string, string>;
  /** 是否取消 */
  cancelled?: boolean;
}

export class ConversationLoop {
  private client: ClaudeClient;
  private session: Session;
  private options: LoopOptions;
  private tools: ToolDefinition[];
  /** 所有工具（包含 deferred 的 MCP 工具），用于动态过滤 */
  private allTools: ToolDefinition[] = [];
  /** 是否启用了工具搜索/延迟加载 */
  private toolSearchEnabled: boolean = false;
  private totalCostUSD: number = 0;
  private promptBuilder: SystemPromptBuilder;
  private promptContext: PromptContext;

  // ESC 中断支持
  private abortController: AbortController | null = null;

  /**
   * 获取当前权限模式 - 官方 v2.1.2 响应式实现
   *
   * 重要：此方法是权限系统的唯一入口。
   * 优先从 getAppState() 回调获取实时的响应式状态，
   * 这样 UI 层通过 Shift+Tab 切换的权限模式能立即生效。
   *
   * 只有在未提供 getAppState 回调时（如 sub-agent 或测试场景），
   * 才会回退到 options.permissionMode 静态配置。
   */
  private getCurrentPermissionMode(): PermissionMode {
    // 优先使用响应式状态（来自 App.tsx 的 toolPermissionContext）
    if (this.options.getAppState) {
      const appState = this.options.getAppState();
      return appState.toolPermissionContext.mode;
    }
    // 回退到静态配置（仅用于 sub-agent 或测试场景）
    return this.options.permissionMode || 'default';
  }

  /**
   * 处理权限请求（询问用户是否允许工具执行）
   * @param toolName 工具名称
   * @param toolInput 工具输入
   * @param message 权限请求消息
   * @returns 是否批准执行
   */
  private async handlePermissionRequest(
    toolName: string,
    toolInput: unknown,
    message?: string
  ): Promise<boolean> {
    // 1. 检查会话级权限记忆
    if (this.session.isToolAlwaysAllowed(toolName)) {
      if (this.options.verbose) {
        console.log(chalk.green(`[Permission] Auto-allowed by session permission: ${toolName}`));
      }
      return true;
    }

    // 2. 触发 PermissionRequest Hooks
    const hookResult = await runPermissionRequestHooks(
      toolName,
      toolInput,
      this.session.sessionId
    );

    // 如果 hook 返回了决策，使用 hook 的决策
    if (hookResult.decision === 'allow') {
      if (this.options.verbose) {
        console.log(chalk.green(`[Permission] Allowed by hook: ${hookResult.message || 'No reason provided'}`));
      }
      return true;
    } else if (hookResult.decision === 'deny') {
      const reason = hookResult.message || 'No reason provided';
      if (this.options.verbose) {
        console.log(chalk.red(`[Permission] Denied by hook: ${reason}`));
      }
      // v2.1.27: 记录到调试日志
      logPermissionDenied(toolName, `Denied by hook: ${reason}`, this.session.sessionId);
      return false;
    }

    // 3. 检查权限模式 - 官方 v2.1.2 使用响应式状态
    const currentMode = this.getCurrentPermissionMode();

    if (currentMode === 'bypassPermissions' || this.options.dangerouslySkipPermissions) {
      if (this.options.verbose) {
        console.log(chalk.yellow('[Permission] Bypassed due to permission mode'));
      }
      return true;
    }

    if (currentMode === 'dontAsk') {
      // dontAsk 模式：自动拒绝需要询问的操作
      if (this.options.verbose) {
        console.log(chalk.red('[Permission] Auto-denied in dontAsk mode'));
      }
      // v2.1.27: 记录到调试日志
      logPermissionDenied(toolName, 'Auto-denied in dontAsk mode', this.session.sessionId);
      return false;
    }

    // 3.5 plan 模式 - 官方 v2.1.2 Shift+Tab 双击切换
    // Plan 模式下拒绝所有执行操作，只允许只读工具
    if (currentMode === 'plan') {
      const readOnlyTools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
      if (!readOnlyTools.includes(toolName)) {
        if (this.options.verbose) {
          console.log(chalk.yellow(`[Permission] Denied in plan mode (non-readonly tool): ${toolName}`));
        }
        // v2.1.27: 记录到调试日志
        logPermissionDenied(toolName, 'Denied in plan mode (non-readonly tool)', this.session.sessionId);
        return false;
      }
      // 只读工具在 plan 模式下允许执行
      return true;
    }

    // 3.6 acceptEdits 模式 - 官方 v2.1.2 Shift+Tab 单击切换
    // 自动接受文件编辑操作，其他操作仍需询问
    if (currentMode === 'acceptEdits') {
      const editTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
      if (editTools.includes(toolName)) {
        if (this.options.verbose) {
          console.log(chalk.green(`[Permission] Auto-accepted edit tool in acceptEdits mode: ${toolName}`));
        }
        return true;
      }
      // 非编辑工具继续走后面的询问流程
    }

    // 4. 显示权限请求对话框
    console.log(chalk.yellow('\n┌─────────────────────────────────────────┐'));
    console.log(chalk.yellow('│          Permission Request             │'));
    console.log(chalk.yellow('├─────────────────────────────────────────┤'));
    console.log(chalk.yellow(`│ Tool: ${toolName.padEnd(33)}│`));
    if (message) {
      const displayMessage = message.length > 33 ? message.slice(0, 30) + '...' : message;
      console.log(chalk.yellow(`│ Reason: ${displayMessage.padEnd(31)}│`));
    }
    if (toolInput && typeof toolInput === 'object') {
      const inputStr = JSON.stringify(toolInput).slice(0, 30);
      console.log(chalk.yellow(`│ Input: ${inputStr.padEnd(32)}│`));
    }
    console.log(chalk.yellow('└─────────────────────────────────────────┘'));
    console.log('\nOptions:');
    console.log('  [y] Yes, allow once');
    console.log('  [n] No, deny');
    console.log('  [a] Always allow for this session');

    // 5. 等待用户输入
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\nYour choice [y/n/a]: ', (answer) => {
        rl.close();

        const choice = answer.trim().toLowerCase();

        switch (choice) {
          case 'y':
            console.log(chalk.green('✓ Permission granted for this request'));
            resolve(true);
            break;

          case 'a':
            console.log(chalk.green(`✓ Permission granted for all '${toolName}' requests in this session`));
            // 实现会话级权限记忆
            this.session.addAlwaysAllowedTool(toolName);
            resolve(true);
            break;

          case 'n':
          default:
            console.log(chalk.red('✗ Permission denied'));
            resolve(false);
            break;
        }
      });
    });
  }

  constructor(options: LoopOptions = {}) {
    // 解析模型别名
    const resolvedModel = modelConfig.resolveAlias(options.model || 'sonnet');

    // 只有在没有明确指定 isSubAgent 的情况下才设置父模型上下文
    // Sub-agent 不应该覆盖全局的父模型上下文
    if (!options.isSubAgent) {
      setParentModelContext(resolvedModel);
    }

    // 构建 ClaudeClient 配置
    const clientConfig: ClientConfig = {
      model: resolvedModel,
      maxTokens: options.maxTokens,
      fallbackModel: options.fallbackModel,
      thinking: options.thinking,
      debug: options.debug,
      timeout: 300000,  // 5分钟 API 请求超时
    };

    // 如果外部传入了认证信息（如 WebUI 子 agent 复用主 agent 的认证），直接使用
    if (options.apiKey || options.authToken) {
      if (options.apiKey) {
        clientConfig.apiKey = options.apiKey;
      }
      if (options.authToken) {
        clientConfig.authToken = options.authToken;
      }
      if (options.baseUrl) {
        clientConfig.baseUrl = options.baseUrl;
      }
    } else {
      // 默认路径：从本地凭证文件/环境变量初始化认证
      initAuth();
      const auth = getAuth();

      // 根据认证类型设置凭据
      if (auth) {
        if (auth.type === 'api_key' && auth.apiKey) {
          clientConfig.apiKey = auth.apiKey;
        } else if (auth.type === 'oauth') {
          // 检查是否有 user:inference scope (Claude.ai 订阅用户)
          const scopes = auth.scopes || auth.scope || [];
          const hasInferenceScope = scopes.includes('user:inference');

          // 获取 OAuth token（可能是 authToken 或 accessToken）
          const oauthToken = auth.authToken || auth.accessToken;

          if (hasInferenceScope && oauthToken) {
            clientConfig.authToken = oauthToken;
          } else if (auth.oauthApiKey) {
            clientConfig.apiKey = auth.oauthApiKey;
          }
        }
      }
    }

    this.client = new ClaudeClient(clientConfig);

    this.session = new Session();
    this.options = options;
    this.promptBuilder = systemPromptBuilder;

    // v2.1.27: 设置全局会话 ID 以供工具使用（如 gh pr create 自动链接）
    setCurrentSessionId(this.session.sessionId);

    // 初始化提示词上下文
    // 关键修复：subAgent（Worker）必须有明确的 workingDir，禁止回退到 process.cwd()
    // 这避免了 Worker 在程序启动目录而非指定项目路径执行的 bug
    let effectiveWorkingDir: string;
    if (options.isSubAgent) {
      if (!options.workingDir) {
        throw new Error('SubAgent 必须指定 workingDir，禁止使用程序启动目录');
      }
      effectiveWorkingDir = options.workingDir;
    } else {
      // 主 CLI 可以使用 process.cwd()
      effectiveWorkingDir = options.workingDir || process.cwd();
    }

    // 初始化 Agent 笔记本系统
    const notebookMgr = initNotebookManager(effectiveWorkingDir);
    const notebookSummary = notebookMgr.getNotebookSummaryForPrompt();

    this.promptContext = {
      workingDir: effectiveWorkingDir,
      model: resolvedModel,
      permissionMode: options.permissionMode,
      planMode: options.planMode,
      delegateMode: options.delegateMode,
      ideType: options.ideType,
      platform: process.platform,
      todayDate: new Date().toISOString().split('T')[0],
      isGitRepo: this.checkIsGitRepo(effectiveWorkingDir),
      debug: options.debug,
      // v2.1.0+: 语言配置 - 从 configManager 读取
      language: configManager.get('language'),
      // Agent 笔记本内容
      notebookSummary: notebookSummary || undefined,
    };

    // 获取并过滤工具
    let tools = toolRegistry.getDefinitions();

    // 应用工具过滤
    if (options.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools.flatMap(t => t.split(',')).map(t => t.trim()));

      // 如果包含通配符 '*'，允许所有工具
      if (!allowed.has('*')) {
        tools = tools.filter(t => allowed.has(t.name));
      }
    }

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      const disallowed = new Set(options.disallowedTools.flatMap(t => t.split(',')).map(t => t.trim()));
      tools = tools.filter(t => !disallowed.has(t.name));
    }

    // v2.1.33: delegate_mode 工具限制
    // 在 delegate_mode 下，agent 只能使用团队协作相关的工具
    if (options.delegateMode) {
      const DELEGATE_MODE_TOOLS = new Set([
        'Task', 'TaskOutput',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
        'Read', 'Glob', 'Grep',  // 基础读取工具仍然可用
      ]);
      tools = tools.filter(t => DELEGATE_MODE_TOOLS.has(t.name));
    }

    // v2.1.30: 合并 SDK 提供的 MCP 工具
    if (options.mcpTools && options.mcpTools.length > 0) {
      const existingNames = new Set(tools.map(t => t.name));
      for (const mcpTool of options.mcpTools) {
        if (!existingNames.has(mcpTool.name)) {
          tools.push(mcpTool);
        }
      }
    }

    // v2.1.7+: MCP 工具搜索/延迟加载模式（对齐官方 v2.1.34）
    // 判断是否启用 tool search，但不在初始化时过滤工具
    // 工具过滤推迟到每次 API 请求前动态执行（filterToolsForRequest）
    this.toolSearchEnabled = isToolSearchEnabled(resolvedModel, tools);

    if (this.toolSearchEnabled) {
      // 如果启用了 tool search 但没有任何 deferred 工具，关闭它
      // 对齐官方：if(O && !Y.some(OG)) O = false
      if (!tools.some(isDeferredTool)) {
        this.toolSearchEnabled = false;
      }
    }

    if (this.toolSearchEnabled && (options.verbose || options.debug)) {
      console.log(chalk.blue('[MCP] Tool search enabled: MCP tools will be loaded on-demand via Mcp'));
    }

    // 保存所有工具（用于动态过滤）
    this.allTools = tools;
    // this.tools 在每次请求前由 filterToolsForRequest() 动态设置
    // 初始化时先做一次过滤
    this.tools = this.filterToolsForRequest([]);

    // v2.1.33: 将工具名称集合注入 promptContext，用于条件化提示词组装
    this.promptContext.toolNames = new Set(tools.map(t => t.name));

    // 标记是否有 Skill 工具可用，用于系统提示词中的条件化指引
    this.promptContext.hasSkills = this.promptContext.toolNames.has('Skill');

    // v2.1.33: 将 allowedSubagentTypes 传递给 TaskTool 实例
    // 当子 loop 通过 Task(agent_type) 语法限制了允许的子 agent 类型时
    // 在 TaskTool.execute() 中进行验证
    if (options.allowedSubagentTypes) {
      const taskTool = toolRegistry.get('Task');
      if (taskTool && 'setAllowedSubagentTypes' in taskTool) {
        (taskTool as any).setAllowedSubagentTypes(options.allowedSubagentTypes);
      }
    }
  }

  /**
   * 重新初始化客户端（登录后调用）
   * 从当前认证状态重新创建 ClaudeClient
   */
  reinitializeClient(): boolean {
    // 重新初始化认证
    initAuth();
    const auth = getAuth();

    if (!auth) {
      console.warn('[Loop] No auth found after reinitialization');
      return false;
    }

    const resolvedModel = modelConfig.resolveAlias(this.options.model || 'sonnet');

    // 构建 ClaudeClient 配置
    const clientConfig: ClientConfig = {
      model: resolvedModel,
      maxTokens: this.options.maxTokens,
      fallbackModel: this.options.fallbackModel,
      thinking: this.options.thinking,
      debug: this.options.debug,
      timeout: 300000,  // 5分钟 API 请求超时
    };

    // 根据认证类型设置凭据
    if (auth.type === 'api_key' && auth.apiKey) {
      clientConfig.apiKey = auth.apiKey;
    } else if (auth.type === 'oauth') {
      // 检查是否有 user:inference scope (Claude.ai 订阅用户)
      const hasInferenceScope = auth.scope?.includes('user:inference');

      if (hasInferenceScope && auth.accessToken) {
        // Claude.ai 订阅用户可以直接使用 OAuth token
        clientConfig.authToken = auth.accessToken;
      } else if (auth.oauthApiKey) {
        // 使用创建的 OAuth API Key
        clientConfig.apiKey = auth.oauthApiKey;
      } else {
        console.warn('[Loop] OAuth auth without valid credentials');
        return false;
      }
    }

    // 重新创建客户端
    this.client = new ClaudeClient(clientConfig);
    console.log('[Loop] Client reinitialized with new credentials');
    return true;
  }

  /**
   * 动态过滤工具列表（对齐官方 v2.1.34）
   *
   * 每次 API 请求前调用，根据 toolSearchEnabled 和消息历史动态决定
   * 哪些工具的 schema 传给模型。
   *
   * 官方逻辑：
   * if (toolSearchEnabled) {
   *   let discovered = abA(messages);  // 扫描历史中已发现的工具
   *   filteredTools = allTools.filter(t => {
   *     if (!isDeferredTool(t)) return true;       // 非 MCP 工具保留
   *     if (t.name === "ToolSearch") return true;   // ToolSearch 自身保留
   *     return discovered.has(t.name);              // 已发现的 MCP 工具保留
   *   });
   * } else {
   *   filteredTools = allTools.filter(t => t.name !== "ToolSearch");
   * }
   */
  private filterToolsForRequest(messages: Array<Record<string, any>>): ToolDefinition[] {
    if (!this.toolSearchEnabled) {
      // 不启用 tool search 时，移除 Mcp（ToolSearch）工具本身，其他全部保留
      return this.allTools.filter(t => t.name !== 'Mcp');
    }

    // 启用 tool search：从消息历史中找出已发现的 MCP 工具
    const discovered = getDiscoveredToolsFromMessages(messages);

    return this.allTools.filter(t => {
      // 非 deferred 工具（内置工具）始终保留
      if (!isDeferredTool(t)) return true;
      // Mcp（ToolSearch）工具自身始终保留
      if (t.name === 'Mcp') return true;
      // 已被模型通过 ToolSearch 发现的 MCP 工具保留
      return discovered.has(t.name);
    });
  }

  /**
   * 确保认证已完成（处理 OAuth API Key 创建）
   * 在发送第一条消息前调用
   */
  async ensureAuthenticated(): Promise<boolean> {
    const auth = getAuth();

    if (!auth) {
      return false;
    }

    if (auth.type === 'api_key') {
      return !!auth.apiKey;
    }

    if (auth.type === 'oauth') {
      // 检查是否有 user:inference scope (Claude.ai 订阅用户)
      // 注意：AuthConfig 同时有 scope 和 scopes 两个字段，需要都检查
      const scopes = auth.scopes || auth.scope || [];
      const hasInferenceScope = scopes.includes('user:inference');

      if (hasInferenceScope) {
        // Claude.ai 订阅用户：尝试使用 authToken
        // 注意：Anthropic 服务器可能会限制非官方客户端使用 OAuth token
        if (auth.accessToken) {
          return true;
        }
        console.warn('[Auth] OAuth access token not found');
        return false;
      }

      // Console 用户需要创建 OAuth API Key
      const apiKey = await ensureOAuthApiKey();
      if (apiKey) {
        // 重新创建客户端使用新的 API Key
        const resolvedModel = modelConfig.resolveAlias(this.options.model || 'sonnet');
        this.client = new ClaudeClient({
          model: resolvedModel,
          maxTokens: this.options.maxTokens,
          fallbackModel: this.options.fallbackModel,
          thinking: this.options.thinking,
          debug: this.options.debug,
          timeout: 300000,  // 5分钟 API 请求超时
          apiKey: apiKey,
        });
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * 检查是否为 Git 仓库
   */
  private checkIsGitRepo(dir: string): boolean {
    try {
      const fs = require('fs');
      const path = require('path');
      let currentDir = dir;
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, '.git'))) {
          return true;
        }
        currentDir = path.dirname(currentDir);
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 更新提示词上下文
   */
  updateContext(updates: Partial<PromptContext>): void {
    this.promptContext = { ...this.promptContext, ...updates };
  }

  async processMessage(userInput: string): Promise<string> {
    // 使用工作目录上下文包裹整个消息处理过程
    // 确保所有工具执行都在正确的工作目录上下文中
    return runWithCwd(this.promptContext.workingDir, async () => {
      return this.processMessageInternal(userInput);
    });
  }

  /**
   * 内部消息处理逻辑（在工作目录上下文中执行）
   */
  private async processMessageInternal(userInput: string): Promise<string> {
    // 确保认证已完成（处理 OAuth API Key 创建）
    await this.ensureAuthenticated();

    // 添加用户消息
    this.session.addMessage({
      role: 'user',
      content: userInput,
    });

    let turns = 0;
    const maxTurns = this.options.maxTurns || 50;
    let finalResponse = '';

    // 解析模型别名（在循环外部，避免重复解析）
    const resolvedModel = modelConfig.resolveAlias(this.options.model || 'sonnet');

    // 构建系统提示词
    let systemPrompt: string;
    let promptBlocks: Array<{ text: string; cacheScope: 'global' | 'org' | null }> | undefined;
    if (this.options.systemPrompt) {
      // 如果提供了自定义系统提示词，直接使用
      systemPrompt = this.options.systemPrompt;
    } else {
      // 使用动态构建器生成
      try {
        const buildResult = await this.promptBuilder.build(this.promptContext);
        systemPrompt = buildResult.content;
        promptBlocks = buildResult.blocks;

        if (this.options.verbose) {
          console.log(chalk.gray(`[SystemPrompt] Built in ${buildResult.buildTimeMs}ms, ${buildResult.hashInfo.estimatedTokens} tokens`));
        }
      } catch (error) {
        console.warn('Failed to build system prompt, using default:', error);
        systemPrompt = this.getDefaultSystemPrompt();
      }
    }

    // Agent 笔记本：每轮刷新笔记本内容到 promptContext
    // 确保 agent 在对话中写入的笔记能在下一轮 system prompt 中体现
    try {
      const nbMgr = getNotebookManager();
      if (nbMgr) {
        const freshSummary = nbMgr.getNotebookSummaryForPrompt();
        if (freshSummary) {
          this.promptContext.notebookSummary = freshSummary;
        }
      }
    } catch {
      // 笔记本加载失败不影响主流程
    }

    while (turns < maxTurns) {
      turns++;

      // 在发送请求前清理旧的持久化输出（第一层 microcompact）
      // 使用智能触发机制（环境变量 + token 阈值 + 最小节省）
      let messages = this.session.getMessages();
      messages = cleanOldPersistedOutputs(messages);

      // v2.1.7 修复：验证并修复孤立的 tool_result
      // 确保每个 tool_use 都有对应的 tool_result
      messages = validateToolResults(messages);

      // 尝试自动压缩（第二+三层）
      const compactResult = await autoCompact(messages, resolvedModel, this.client, this.session);
      if (compactResult.wasCompacted) {
        messages = compactResult.messages;
        // 更新会话中的消息（压缩成功后替换整个消息列表）
        // 对齐官方实现：直接替换会话中的消息列表，确保后续请求使用压缩后的消息
        this.session.setMessages(messages);
        // 如果有边界标记 UUID，保存到会话状态（用于下次增量压缩）
        if (compactResult.boundaryUuid) {
          this.session.setLastCompactedUuid(compactResult.boundaryUuid);
        }
      }

      // v2.1.34: 每次请求前动态过滤工具列表
      // 根据消息历史中已发现的 MCP 工具决定传哪些工具 schema 给 API
      const filteredTools = this.filterToolsForRequest(messages);

      let response;
      try {
        response = await this.client.createMessage(
          messages,
          filteredTools,
          systemPrompt,
          {
            enableThinking: this.options.thinking?.enabled,
            thinkingBudget: this.options.thinking?.budgetTokens,
            promptBlocks,
            toolSearchEnabled: this.toolSearchEnabled,
          }
        );
      } catch (apiError: any) {
        console.error(chalk.red(`[Loop] API call failed: ${apiError.message}`));
        if (this.options.debug || this.options.verbose) {
          console.error(chalk.red('[Loop] Full error:'), apiError);
        }
        throw apiError;
      }

      // 处理 Extended Thinking 结果
      if (response.thinking) {
        if (this.options.thinking?.showThinking || this.options.verbose) {
          console.log(chalk.gray('\n[Extended Thinking]'));
          console.log(chalk.gray(response.thinking.thinking));
          console.log(chalk.gray(`[Thinking tokens: ${response.thinking.thinkingTokens}, time: ${response.thinking.thinkingTimeMs}ms]`));
        }
      }

      // 处理响应内容
      const assistantContent: ContentBlock[] = [];
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      // 收集所有工具返回的 newMessages（对齐官网实现）
      const allNewMessages: Array<{ role: 'user'; content: any[] }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          assistantContent.push(block);
          finalResponse += block.text || '';
          if (this.options.verbose) {
            process.stdout.write(block.text || '');
          }
        } else if (block.type === 'server_tool_use') {
          // Server Tool (如 web_search) - 由 Anthropic 服务器执行
          // 不需要客户端执行，只记录日志
          assistantContent.push(block);
          const serverToolBlock = block as any;
          if (this.options.verbose) {
            console.log(chalk.cyan(`\n[Server Tool: ${serverToolBlock.name}]`));
            console.log(chalk.gray('(executed by Anthropic servers)'));
          }
          // Server Tool 不需要返回 tool_result，结果由服务器自动提供
        } else if (block.type === 'web_search_tool_result') {
          // Web Search 结果 - 由 Anthropic 服务器返回
          assistantContent.push(block);
          const searchResultBlock = block as any;
          if (this.options.verbose) {
            console.log(chalk.cyan(`\n[Web Search Results]`));
            // 显示搜索结果摘要
            if (Array.isArray(searchResultBlock.content)) {
              const results = searchResultBlock.content;
              console.log(chalk.gray(`Found ${results.length} results`));
              for (const result of results.slice(0, 3)) {
                if (result.type === 'web_search_result') {
                  console.log(chalk.gray(`  - ${result.title}: ${result.url}`));
                }
              }
            } else if (searchResultBlock.content?.type === 'web_search_tool_result_error') {
              console.log(chalk.red(`Search error: ${searchResultBlock.content.error_code}`));
            }
          }
          // Web Search 结果已经是完整的，不需要额外的 tool_result
        } else if (block.type === 'tool_use') {
          assistantContent.push(block);

          // 执行工具
          const toolName = block.name || '';
          const toolInput = block.input || {};
          const toolId = block.id || '';

          if (this.options.verbose) {
            console.log(chalk.cyan(`\n[Tool: ${toolName}]`));
          }

          // 执行工具（带权限检查和回调）
          const result = await toolRegistry.execute(
            toolName,
            toolInput,
            // 权限请求回调函数
            async (name, input, message) => {
              return await this.handlePermissionRequest(name, input, message);
            }
          );

          if (this.options.verbose) {
            console.log(chalk.gray(result.output || result.error || ''));
          }

          // v2.1.27: 记录工具执行失败到调试日志
          if (!result.success && result.error) {
            logToolFailed(toolName, result.error, toolInput, this.session.sessionId);
          }

          // 使用格式化函数处理工具结果
          const formattedContent = formatToolResult(toolName, result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: formattedContent,
          });

          // 收集 newMessages（对齐官网实现）
          if (result.newMessages && result.newMessages.length > 0) {
            allNewMessages.push(...result.newMessages);
          }
        }
      }

      // v2.1.30: 修复 phantom "(no content)" 文本块
      // 当 assistant content 为空数组时，API 会返回 400 错误
      // 对应官方实现：空 content 时插入 {type:"text", text:"(no content)"} 占位
      let fixedAssistantContent = assistantContent;
      if (Array.isArray(assistantContent) && assistantContent.length === 0) {
        fixedAssistantContent = [{ type: 'text' as const, text: '(no content)' }];
      }

      // 添加助手消息
      this.session.addMessage({
        role: 'assistant',
        content: fixedAssistantContent,
      });

      // 如果有工具调用，添加结果并继续
      if (toolResults.length > 0) {
        this.session.addMessage({
          role: 'user',
          content: toolResults,
        });

        // 添加 newMessages（对齐官网实现：skill 内容作为独立的 user 消息）
        // 官网 Ch4: metadata 消息无 isMeta，skill 内容消息 isMeta: true
        for (const newMsg of allNewMessages) {
          const msg: Message = {
            role: newMsg.role,
            content: newMsg.content,
          };
          if ('isMeta' in newMsg && newMsg.isMeta) {
            msg.isMeta = true;
          }
          this.session.addMessage(msg);
        }
      }

      // 检查是否应该停止
      if (response.stopReason === 'end_turn' && toolResults.length === 0) {
        break;
      }

      // 更新使用统计
      this.session.updateUsage(
        resolvedModel,
        {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadInputTokens: response.usage.cacheReadTokens || 0,
          cacheCreationInputTokens: response.usage.cacheCreationTokens || 0,
          webSearchRequests: 0,
        },
        modelConfig.calculateCost(resolvedModel, {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheCreationTokens: response.usage.cacheCreationTokens,
          thinkingTokens: response.usage.thinkingTokens,
        }),
        0,
        0
      );
    }

    // 自动保存会话
    this.autoSave();

    return finalResponse;
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `You are Claude, an AI assistant made by Anthropic. You are an expert software engineer.

You have access to tools to help complete tasks. Use them as needed.

Guidelines:
- Be concise and direct
- Use tools to gather information before answering
- Prefer editing existing files over creating new ones
- Always verify your work`;
  }

  // 自动保存会话
  private autoSave(): void {
    try {
      this.session.save();
    } catch (err) {
      // 静默失败，不影响对话
      if (this.options.verbose) {
        console.error('Failed to auto-save session:', err);
      }
    }
  }

  /**
   * 流式处理用户消息
   * @param userInput 用户输入（文本或多模态内容数组）
   */
  async *processMessageStream(userInput: string | AnyContentBlock[]): AsyncGenerator<{
    type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'interrupted';
    content?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResult?: string;
    toolError?: string;
  }> {
    // 使用工作目录上下文包裹整个流式处理过程
    // 注意：AsyncLocalStorage.run() 不能跨 generator 边界传播上下文
    // 使用 runGeneratorWithCwd 确保每次迭代都在正确的上下文中执行
    yield* runGeneratorWithCwd(
      this.promptContext.workingDir,
      this.processMessageStreamInternal(userInput)
    );
  }

  /**
   * 内部流式消息处理逻辑（在工作目录上下文中执行）
   * @param userInput 用户输入（文本或多模态内容数组）
   */
  private async *processMessageStreamInternal(userInput: string | AnyContentBlock[]): AsyncGenerator<{
    type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'interrupted';
    content?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResult?: string;
    toolError?: string;
  }> {
    // 确保认证已完成（处理 OAuth API Key 创建）
    await this.ensureAuthenticated();

    // 创建新的 AbortController 用于此次请求
    this.abortController = new AbortController();

    this.session.addMessage({
      role: 'user',
      content: userInput,
    });

    let turns = 0;
    const maxTurns = this.options.maxTurns || 50;
    let streamRetryCount = 0;        // v9.1: 流式错误连续重试计数
    const maxStreamRetries = 3;      // v9.1: 最大流式错误重试次数

    // 解析模型别名（在循环外部，避免重复解析）
    const resolvedModel = modelConfig.resolveAlias(this.options.model || 'sonnet');

    while (turns < maxTurns) {
      // 官方 v2.1.2: 每个 turn 开始时更新 promptContext 中的权限模式
      // 使用响应式状态获取最新的权限模式
      const currentMode = this.getCurrentPermissionMode();
      this.promptContext.permissionMode = currentMode;

      // 每个 turn 重新构建系统提示词 - 支持运行时权限模式切换 (官方 v2.1.2 Shift+Tab)
      let systemPrompt: string;
      let promptBlocks: Array<{ text: string; cacheScope: 'global' | 'org' | null }> | undefined;
      if (this.options.systemPrompt) {
        systemPrompt = this.options.systemPrompt;
      } else {
        try {
          const buildResult = await this.promptBuilder.build(this.promptContext);
          systemPrompt = buildResult.content;
          promptBlocks = buildResult.blocks;
        } catch {
          systemPrompt = this.getDefaultSystemPrompt();
        }
      }
      // 检查是否已被中断
      if (this.abortController?.signal.aborted) {
        yield { type: 'interrupted', content: 'Request interrupted by user' };
        break;
      }

      turns++;

      // 在发送请求前清理旧的持久化输出（第一层 microcompact）
      // 使用智能触发机制（环境变量 + token 阈值 + 最小节省）
      let messages = this.session.getMessages();
      messages = cleanOldPersistedOutputs(messages);

      // v2.1.7 修复：验证并修复孤立的 tool_result
      // 确保每个 tool_use 都有对应的 tool_result
      messages = validateToolResults(messages);

      // 尝试自动压缩（第二+三层）
      const compactResult = await autoCompact(messages, resolvedModel, this.client, this.session);
      if (compactResult.wasCompacted) {
        messages = compactResult.messages;
        // 更新会话中的消息（压缩成功后替换整个消息列表）
        // 对齐官方实现：直接替换会话中的消息列表，确保后续请求使用压缩后的消息
        this.session.setMessages(messages);
        // 如果有边界标记 UUID，保存到会话状态（用于下次增量压缩）
        if (compactResult.boundaryUuid) {
          this.session.setLastCompactedUuid(compactResult.boundaryUuid);
        }
      }

      const assistantContent: ContentBlock[] = [];
      const toolCalls: Map<string, { name: string; input: string; isServerTool: boolean }> = new Map();
      // 存储 web_search_tool_result（用于在 tool_end 中传递搜索结果摘要给 UI）
      const webSearchResults: Map<string, any> = new Map();
      let currentToolId = '';
      let streamStopReason: string = 'end_turn';

      // v2.1.34: 流式 API 也使用动态过滤
      const streamFilteredTools = this.filterToolsForRequest(messages);

      try {
        for await (const event of this.client.createMessageStream(
          messages,
          streamFilteredTools,
          systemPrompt,
          {
            enableThinking: this.options.thinking?.enabled,
            thinkingBudget: this.options.thinking?.budgetTokens,
            signal: this.abortController?.signal,
            promptBlocks,
            toolSearchEnabled: this.toolSearchEnabled,
          }
        )) {
          // 检查是否已被中断
          if (this.abortController?.signal.aborted) {
            yield { type: 'interrupted', content: 'Request interrupted by user' };
            break;
          }

          if (event.type === 'text') {
            yield { type: 'text', content: event.text };
            assistantContent.push({ type: 'text', text: event.text });
          } else if (event.type === 'thinking') {
            // v2.1.33: Extended Thinking content
            // 将 thinking block 加入 assistantContent，确保中断时能正确保存
            // normalizeAssistantContent 会在需要时移除尾部孤立的 thinking block
            if (event.thinking) {
              assistantContent.push({ type: 'thinking', thinking: event.thinking });
            }
            if (this.options.thinking?.showThinking || this.options.verbose) {
              yield { type: 'text', content: `[Thinking: ${event.thinking}]` };
            }
          } else if (event.type === 'tool_use_start') {
            currentToolId = event.id || '';
            toolCalls.set(currentToolId, { name: event.name || '', input: '', isServerTool: false });
            // v3.6: 移除此处的 tool_start 事件，只在工具执行前发送（带完整参数）
            // 之前在这里发送空参数的 tool_start 会导致日志中出现两次事件
          } else if (event.type === 'server_tool_use_start') {
            // Server Tool (如 web_search) - 由 Anthropic 服务器执行
            // 不需要客户端执行，只记录
            currentToolId = event.id || '';
            const serverToolInput = event.input || '';
            toolCalls.set(currentToolId, { name: event.name || '', input: serverToolInput, isServerTool: true });
            // Server Tool 立即发送事件，传递 input（如 web_search 的 query）
            let parsedInput: Record<string, unknown> | undefined;
            try { parsedInput = JSON.parse(serverToolInput); } catch { /* ignore */ }
            yield { type: 'tool_start', toolName: `[Server] ${event.name}`, toolInput: parsedInput };
          } else if (event.type === 'tool_use_delta') {
            const tool = toolCalls.get(currentToolId);
            if (tool && !tool.isServerTool) {
              tool.input += event.input || '';
            }
          } else if (event.type === 'web_search_result') {
            // web_search_tool_result 从 finalMessage 中提取，收集搜索结果
            const resultBlock = (event as any).data;
            if (resultBlock) {
              assistantContent.push(resultBlock);
              // 关联到对应的 server_tool_use（通过 tool_use_id）
              const toolUseId = resultBlock.tool_use_id;
              if (toolUseId) {
                webSearchResults.set(toolUseId, resultBlock);
              }
            }
          } else if (event.type === 'response_headers') {
            // v2.1.6: 处理响应头中的速率限制信息
            if (event.headers) {
              updateRateLimitStatus(event.headers, this.options.verbose);
            }
          } else if (event.type === 'stop') {
            // v4.3: 跟踪流式响应的 stopReason
            // 对齐官方实现：当 stopReason 为 max_tokens 时，响应被截断，循环应继续
            streamStopReason = (event as any).stopReason || 'end_turn';
          } else if (event.type === 'error') {
            console.error(chalk.red(`[Loop] Stream error: ${event.error}`));
            yield { type: 'tool_end', toolError: event.error };
            break;
          }
        }
      } catch (streamError: any) {
        // 检查是否是因为中断导致的错误
        if (this.abortController?.signal.aborted || streamError.name === 'AbortError') {
          // 保存已收集的 assistant 内容（如果有）
          if (assistantContent.length > 0) {
            const normalizedContent = this.normalizeAssistantContent(assistantContent);
            this.session.addMessage({
              role: 'assistant',
              content: normalizedContent,
            });
          }
          yield { type: 'interrupted', content: 'Request interrupted by user' };
          break;
        }

        // v9.1: 判断是否为可重试的网络错误（暂时性故障）
        const errMsg = streamError.message || '';
        const errCode = streamError.code || streamError.type || '';
        const isRetryableStreamError = [
          'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
          'network error', 'fetch failed', 'Connection error', 'connection error',
          'overloaded_error', 'rate_limit_error', 'api_error', 'timeout',
        ].some(e => errMsg.includes(e) || errCode.includes(e))
          || [429, 500, 502, 503, 504, 529].includes(streamError.status || streamError.statusCode || 0);

        if (isRetryableStreamError && streamRetryCount < maxStreamRetries) {
          streamRetryCount++;
          const delay = 1000 * Math.pow(2, streamRetryCount - 1); // 指数退避: 1s, 2s, 4s
          console.warn(chalk.yellow(`[Loop] 流式请求失败 (${errCode || errMsg.substring(0, 50)}), ${delay}ms 后重试 (${streamRetryCount}/${maxStreamRetries})...`));
          await new Promise(r => setTimeout(r, delay));
          // 重新创建 AbortController（旧的可能已被污染）
          this.abortController = new AbortController();
          // 不增加 turns 计数，不 break，直接 continue 重试当前 turn
          continue;
        }

        console.error(chalk.red(`[Loop] Stream failed: ${streamError.message}`));
        if (this.options.debug) {
          console.error(chalk.red('[Loop] Full error:'), streamError);
        }
        yield { type: 'tool_end', toolError: streamError.message };
        break;
      }

      // v9.1: 流式请求成功完成（无异常），重置重试计数器
      streamRetryCount = 0;

      // 如果被中断，保存已收集的内容后跳出循环
      // 关键修复：中断时需要保存 assistantContent，否则恢复会话时无法显示
      if (this.abortController?.signal.aborted) {
        // 保存已收集的 assistant 内容（如果有）
        if (assistantContent.length > 0) {
          const normalizedContent = this.normalizeAssistantContent(assistantContent);
          this.session.addMessage({
            role: 'assistant',
            content: normalizedContent,
          });
        }
        break;
      }

      // 执行所有工具调用
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      // 收集所有工具返回的 newMessages（对齐官网实现）
      const allNewMessages: Array<{ role: 'user'; content: any[] }> = [];

      for (const [id, tool] of toolCalls) {
        // 跳过 Server Tool（由 Anthropic 服务器执行，不需要客户端处理）
        if (tool.isServerTool) {
          // Server Tool 的结果会自动包含在 API 响应中
          // 只需要记录到 assistantContent 中
          assistantContent.push({
            type: 'server_tool_use' as any,
            id,
            name: tool.name,
            input: {},
          });

          // 生成搜索结果摘要（对齐官方 "Did N searches in Xs" 格式）
          let toolResult = '(executed by Anthropic servers)';
          const searchResult = webSearchResults.get(id);
          if (searchResult && tool.name === 'web_search') {
            if (Array.isArray(searchResult.content)) {
              const results = searchResult.content.filter((r: any) => r.type === 'web_search_result');
              toolResult = JSON.stringify({
                type: 'web_search_summary',
                searchCount: results.length,
                results: results.slice(0, 5).map((r: any) => ({
                  title: r.title,
                  url: r.url,
                })),
              });
            } else if (searchResult.content?.type === 'web_search_tool_result_error') {
              toolResult = `Search error: ${searchResult.content.error_code}`;
            }
          }

          yield {
            type: 'tool_end',
            toolName: `[Server] ${tool.name}`,
            toolInput: undefined,
            toolResult,
            toolError: undefined,
          };
          continue;
        }

        try {
          const input = JSON.parse(tool.input || '{}');

          // v3.5: 在工具执行前发送带完整 toolInput 的 tool_start
          // 这样前端可以在长时间运行的工具（如 Bash）执行期间显示输入参数
          yield { type: 'tool_start', toolName: tool.name, toolInput: input };

          let result: ToolResult;

          // v4.2: AskUserQuestion 工具拦截 - 使用自定义处理器
          if (tool.name === 'AskUserQuestion' && this.options.askUserHandler) {
            try {
              const handlerResult = await this.options.askUserHandler({
                questions: input.questions || [],
              });

              if (handlerResult.cancelled) {
                result = {
                  success: false,
                  error: 'User cancelled the question dialog',
                };
              } else {
                // 使用官方格式返回结果
                const formattedAnswers = Object.entries(handlerResult.answers)
                  .map(([header, answer]) => `"${header}"="${answer}"`)
                  .join(', ');
                result = {
                  success: true,
                  output: `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`,
                };
              }
            } catch (err) {
              result = {
                success: false,
                error: `AskUserQuestion handler error: ${err instanceof Error ? err.message : String(err)}`,
              };
            }
          } else {
            // 正常执行工具（带权限检查和回调）
            result = await toolRegistry.execute(
              tool.name,
              input,
              // 权限请求回调函数
              async (name, toolInput, message) => {
                return await this.handlePermissionRequest(name, toolInput, message);
              }
            );
          }

          yield {
            type: 'tool_end',
            toolName: tool.name,
            toolInput: input,
            toolResult: result.success ? result.output : undefined,
            toolError: result.success ? undefined : result.error,
          };

          // v2.1.27: 记录工具执行失败到调试日志
          if (!result.success && result.error) {
            logToolFailed(tool.name, result.error, input, this.session.sessionId);
          }

          assistantContent.push({
            type: 'tool_use',
            id,
            name: tool.name,
            input,
          });

          // 使用格式化函数处理工具结果
          const formattedContent = formatToolResult(tool.name, result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: formattedContent,
          });

          // 收集 newMessages（对齐官网实现）
          if (result.newMessages && result.newMessages.length > 0) {
            allNewMessages.push(...result.newMessages);
          }
        } catch (err) {
          yield {
            type: 'tool_end',
            toolName: tool.name,
            toolInput: undefined,
            toolResult: undefined,
            toolError: `Parse error: ${err}`,
          };
        }
      }

      // v2.1.33: 规范化 assistant 内容，修复 abort 时 whitespace+thinking block 导致的 API 错误
      // 对应官方 kQ1/rC4/_5z 函数：
      // 1. 过滤仅包含 whitespace 的 text block
      // 2. 移除尾部孤立的 thinking block
      // 3. 如果过滤后内容为空，添加一个空文本块避免 API 错误
      const normalizedContent = this.normalizeAssistantContent(assistantContent);

      this.session.addMessage({
        role: 'assistant',
        content: normalizedContent,
      });

      if (toolResults.length > 0) {
        this.session.addMessage({
          role: 'user',
          content: toolResults,
        });

        // 添加 newMessages（对齐官网实现：skill 内容作为独立的 user 消息）
        // 官网 Ch4: metadata 消息无 isMeta，skill 内容消息 isMeta: true
        for (const newMsg of allNewMessages) {
          const msg: Message = {
            role: newMsg.role,
            content: newMsg.content,
          };
          if ('isMeta' in newMsg && newMsg.isMeta) {
            msg.isMeta = true;
          }
          this.session.addMessage(msg);
        }
      } else if (streamStopReason === 'max_tokens') {
        // v4.3: 响应被截断（max_tokens），追加提醒让模型继续
        // 对齐官方实现：当 LLM 返回数据不稳定/被截断时，不应该退出循环
        // 这修复了 issue #84 中描述的问题
        this.session.addMessage({
          role: 'user',
          content: '[system: Your response was truncated due to token limits. Please continue where you left off and complete the task using tools.]',
        });
      } else if (this.options.isSubAgent && turns === 1) {
        // v3.4: Worker 子任务模式下，第一轮没有工具调用时不直接退出
        // 模型可能只是在"思考"或"规划"，追加提醒让它使用工具执行
        this.session.addMessage({
          role: 'user',
          content: '你必须使用工具来完成任务（如 Read、Write、Edit、Bash 等），不能只输出文本。请立即开始使用工具执行任务。',
        });
      } else {
        break;
      }
    }

    // 自动保存会话
    this.autoSave();

    yield { type: 'done' };
  }

  getSession(): Session {
    return this.session;
  }

  setSession(session: Session): void {
    this.session = session;
    // v2.1.27: 设置全局会话 ID 以供工具使用（如 gh pr create 自动链接）
    setCurrentSessionId(session.sessionId);
  }

  /**
   * 设置模型
   * @param model 模型名称或别名
   */
  setModel(model: string): void {
    const resolvedModel = modelConfig.resolveAlias(model);
    this.client.setModel(resolvedModel);
    this.options.model = model; // 保存原始别名
  }

  /**
   * 获取当前模型
   * @returns 当前模型 ID
   */
  getModel(): string {
    return this.client.getModel();
  }

  /**
   * 获取调试信息（探针功能）
   * 返回当前 ConversationLoop 的系统提示词、消息列表、工具列表和模型信息
   */
  getDebugInfo(): { systemPrompt: string; messages: unknown[]; tools: unknown[]; model: string; messageCount: number } {
    return {
      systemPrompt: this.options.systemPrompt || '(动态构建)',
      messages: this.session.getMessages(),
      tools: this.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      model: this.getModel(),
      messageCount: this.session.getMessages().length,
    };
  }

  /**
   * 中断当前正在进行的请求
   * ESC 键触发时调用此方法
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 获取当前的 AbortSignal（如果存在）
   * 用于检查是否正在处理请求
   */
  getAbortSignal(): AbortSignal | null {
    return this.abortController?.signal || null;
  }

  /**
   * 检查当前请求是否已被中断
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * 自动记忆：对话结束时自动提取值得记住的信息写入 Notebook
   *
   * 设计原理：
   * - Notebook 写入不能靠 Agent "自律"，必须在代码层面强制执行
   * - 对话结束时（退出/SIGINT）调用一次轻量 API，提取本次对话收获
   * - 使用 haiku 模型降低成本，只提取结构化信息
   * - 静默失败，不影响退出流程
   */
  async autoMemorize(): Promise<void> {
    try {
      const nbMgr = getNotebookManager();
      if (!nbMgr) return;

      const messages = this.session.getMessages();
      // 对话太短（少于4条消息 = 2轮对话），没什么可提取的
      if (messages.length < 4) return;

      // 读取当前笔记本内容
      const currentExperience = nbMgr.read('experience');
      const currentProject = nbMgr.read('project');

      // 构造提取 prompt
      const extractionPrompt = `你是一个记忆提取器。分析以下对话，提取值得跨会话记住的信息。

当前 experience 笔记本内容：
${currentExperience || '(空)'}

当前 project 笔记本内容：
${currentProject || '(空)'}

规则：
1. 只提取真正有长期价值的信息，忽略一次性的技术细节
2. experience 笔记本记录：用户偏好、工作模式、个人信息、跨项目经验教训
3. project 笔记本记录：项目特有的陷阱、隐藏依赖、重要架构决策、踩过的坑
4. 如果没有新信息值得记录，返回 NO_UPDATE
5. 如果有更新，返回完整的笔记本内容（不是增量，是完整替换）
6. experience 不超过 4000 tokens，project 不超过 8000 tokens
7. 保留原有内容，只追加或修改有变化的部分

输出格式（严格遵守）：
如果无需更新：
NO_UPDATE

如果需要更新 experience：
===EXPERIENCE===
(完整的 experience 笔记本内容)
===END_EXPERIENCE===

如果需要更新 project：
===PROJECT===
(完整的 project 笔记本内容)
===END_PROJECT===

可以同时更新两个，也可以只更新一个。`;

      // 将对话消息精简为文本摘要（只取用户和助手的文本内容，忽略工具调用细节）
      const conversationSummary = messages
        .filter((m: Message) => m.role === 'user' || m.role === 'assistant')
        .map((m: Message) => {
          const role = m.role === 'user' ? '用户' : '助手';
          if (typeof m.content === 'string') {
            return `${role}: ${m.content.substring(0, 500)}`;
          }
          if (Array.isArray(m.content)) {
            const textBlocks = m.content
              .filter((b: any) => b.type === 'text' && b.text)
              .map((b: any) => b.text.substring(0, 300));
            if (textBlocks.length > 0) {
              return `${role}: ${textBlocks.join(' ')}`;
            }
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      // 如果对话内容太少，跳过
      if (conversationSummary.length < 100) return;

      // 使用轻量模型调用 API
      const response = await this.client.createMessage(
        [
          { role: 'user', content: `${extractionPrompt}\n\n===对话内容===\n${conversationSummary.substring(0, 8000)}` },
        ],
        [], // 不需要工具
        '你是记忆提取器，只输出指定格式，不输出其他内容。',
      );

      // 解析响应
      const responseText = response.content
        .filter((b: ContentBlock) => b.type === 'text' && (b as any).text)
        .map((b: ContentBlock) => (b as any).text)
        .join('');

      if (!responseText || responseText.includes('NO_UPDATE')) return;

      // 提取并写入 experience
      const expMatch = responseText.match(/===EXPERIENCE===\n([\s\S]*?)\n===END_EXPERIENCE===/);
      if (expMatch && expMatch[1].trim()) {
        const result = nbMgr.write('experience', expMatch[1].trim());
        if (result.success) {
          console.error(chalk.gray('[AutoMemory] experience 笔记本已更新'));
        }
      }

      // 提取并写入 project
      const projMatch = responseText.match(/===PROJECT===\n([\s\S]*?)\n===END_PROJECT===/);
      if (projMatch && projMatch[1].trim()) {
        const result = nbMgr.write('project', projMatch[1].trim());
        if (result.success) {
          console.error(chalk.gray('[AutoMemory] project 笔记本已更新'));
        }
      }
    } catch {
      // 静默失败，不影响退出流程
    }
  }

  /**
   * v2.1.33: 规范化 assistant 消息内容
   *
   * 修复当 abort 中断流式响应时，whitespace 文本和 thinking block 组合
   * 绕过规范化导致无效 API 请求的问题。
   *
   * 对应官方 kQ1 函数逻辑：
   * 1. 过滤仅包含 whitespace 的 text block
   * 2. 移除尾部孤立的 thinking block（没有对应的 text/tool_use 跟随）
   * 3. 确保内容非空（至少有一个有效的 content block）
   */
  private normalizeAssistantContent(content: any[]): any[] {
    if (!content || content.length === 0) {
      return [{ type: 'text', text: '' }];
    }

    // Step 1: 过滤仅包含 whitespace 的 text block
    let filtered = content.filter((block: any) => {
      if (block.type === 'text') {
        // 保留非空 text block
        return block.text && block.text.trim().length > 0;
      }
      // 保留所有非 text block（tool_use, thinking 等）
      return true;
    });

    // Step 2: 移除尾部孤立的 thinking/redacted_thinking block
    while (filtered.length > 0) {
      const lastBlock = filtered[filtered.length - 1];
      if (lastBlock.type === 'thinking' || lastBlock.type === 'redacted_thinking') {
        filtered.pop();
      } else {
        break;
      }
    }

    // Step 3: 确保内容非空
    if (filtered.length === 0) {
      return [{ type: 'text', text: '' }];
    }

    return filtered;
  }
}
