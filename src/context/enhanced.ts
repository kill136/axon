/**
 * 增强的上下文管理功能
 * Enhanced context management features (T321-T332)
 *
 * 功能增强：
 * - T321: 精确的 token 计数（支持不同模型）
 * - T322: 动态上下文窗口管理
 * - T323-T326: 已在 index.ts 实现
 * - T327-T329: Prompt Caching 支持
 * - T330: MCP URI 管理
 * - T331: AXON.md 文件解析
 * - T332: @ 文件提及处理
 */

import type {
  Message,
  ContentBlock,
  AnyContentBlock,
  ToolReferenceBlock,
  TextBlock,
  TextBlockParam,
} from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { isPdfExtension, getPdfPageCount, formatBytes, PDF_LARGE_THRESHOLD, PDF_MAX_PAGES_PER_REQUEST } from '../media/index.js';
import { getResolvedModelContextWindow } from '../models/model-limits.js';

// ============ T321: Token 计数增强 ============

/**
 * 模型上下文窗口配置
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Claude 3.5 系列
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-haiku-20241022': 200000,

  // Claude 3.7 系列
  'claude-3-7-sonnet-20250219': 200000,

  // Claude 4.6 系列 (最新)
  'claude-opus-4-6': 1000000,

  // Claude 4.5 系列
  'claude-opus-4-5-20251101': 1000000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5-20251001': 200000,

  // Claude 4 系列
  'claude-4-0-sonnet-20250514': 200000,
  'claude-4-0-opus-20250514': 200000,

  // Claude 3 系列（旧版）
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,

  // 默认值
  'default': 200000,
};

/**
 * 获取模型的上下文窗口大小
 */
export function getModelContextWindow(modelId: string): number {
  const resolvedContextWindow = getResolvedModelContextWindow(modelId);
  if (resolvedContextWindow !== undefined) {
    return resolvedContextWindow;
  }

  // 精确匹配
  if (modelId in MODEL_CONTEXT_WINDOWS) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }

  // 模糊匹配（按前缀）
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelId.startsWith(key)) {
      return value;
    }
  }

  // 特殊处理：超大上下文模型（实验性）
  if (modelId.includes('[1m]')) {
    return 1000000;
  }

  return MODEL_CONTEXT_WINDOWS.default;
}

/**
 * Token 使用统计（支持缓存）
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number; // T328: 缓存写入 tokens
  cache_read_input_tokens?: number;     // T329: 缓存读取 tokens
}

/**
 * 上下文窗口统计
 */
export interface ContextWindowStats {
  total_input_tokens: number;       // 累积输入 tokens
  total_output_tokens: number;      // 累积输出 tokens
  context_window_size: number;      // 上下文窗口大小
  current_usage: TokenUsage | null; // 最近一次 API 调用的使用情况
  // v2.1.6+ 状态行新增字段
  used_percentage: number | null;      // 上下文使用百分比 (0-100)
  remaining_percentage: number | null; // 上下文剩余百分比 (0-100)
}

/**
 * 上下文窗口管理器（T322）
 */
export class ContextWindowManager {
  private contextWindowSize: number;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalCacheCreationTokens: number = 0;
  private totalCacheReadTokens: number = 0;
  private currentUsage: TokenUsage | null = null;

  constructor(modelId: string) {
    this.contextWindowSize = getModelContextWindow(modelId);
  }

  /**
   * 更新模型（动态调整窗口大小）
   */
  updateModel(modelId: string): void {
    this.contextWindowSize = getModelContextWindow(modelId);
  }

  /**
   * 记录 API 调用的 token 使用
   */
  recordUsage(usage: TokenUsage): void {
    this.totalInputTokens += usage.input_tokens;
    this.totalOutputTokens += usage.output_tokens;

    if (usage.cache_creation_input_tokens) {
      this.totalCacheCreationTokens += usage.cache_creation_input_tokens;
    }

    if (usage.cache_read_input_tokens) {
      this.totalCacheReadTokens += usage.cache_read_input_tokens;
    }

    this.currentUsage = usage;
  }

  /**
   * 获取当前上下文使用率（百分比）
   */
  getUsagePercentage(): number {
    if (!this.currentUsage) return 0;

    const totalCurrent =
      this.currentUsage.input_tokens +
      (this.currentUsage.cache_creation_input_tokens || 0) +
      (this.currentUsage.cache_read_input_tokens || 0);

    return (totalCurrent / this.contextWindowSize) * 100;
  }

  /**
   * 检查是否接近上下文限制
   */
  isNearLimit(threshold: number = 0.8): boolean {
    return this.getUsagePercentage() >= threshold * 100;
  }

  /**
   * 获取统计信息
   */
  getStats(): ContextWindowStats {
    const usedPercentage = this.getUsagePercentage();
    return {
      total_input_tokens: this.totalInputTokens,
      total_output_tokens: this.totalOutputTokens,
      context_window_size: this.contextWindowSize,
      current_usage: this.currentUsage,
      // v2.1.6+ 状态行新增字段
      used_percentage: this.currentUsage ? Math.round(usedPercentage) : null,
      remaining_percentage: this.currentUsage ? Math.round(100 - usedPercentage) : null,
    };
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    total_cache_creation_tokens: number;
    total_cache_read_tokens: number;
    cache_hit_rate: number;
  } {
    const totalCacheableTokens = this.totalInputTokens;
    const cacheHitRate = totalCacheableTokens > 0
      ? this.totalCacheReadTokens / totalCacheableTokens
      : 0;

    return {
      total_cache_creation_tokens: this.totalCacheCreationTokens,
      total_cache_read_tokens: this.totalCacheReadTokens,
      cache_hit_rate: cacheHitRate,
    };
  }

  /**
   * 重置统计
   */
  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCacheCreationTokens = 0;
    this.totalCacheReadTokens = 0;
    this.currentUsage = null;
  }
}

// ============ T327-T329: Prompt Caching 支持 ============

/**
 * 缓存控制标记
 */
export interface CacheControl {
  type: 'ephemeral';
}

/**
 * 带缓存控制的文本块
 */
export interface CachedTextBlock extends TextBlock {
  cache_control?: CacheControl;
}

/**
 * 带缓存控制的工具结果块
 */
export interface CachedToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
  cache_control?: CacheControl;
}

/**
 * 为消息添加缓存控制标记
 *
 * 策略：
 * 1. 系统提示添加缓存（如果足够大）
 * 2. 工具定义添加缓存
 * 3. 最近的长消息添加缓存
 */
export function addCacheControl(
  messages: Message[],
  options: {
    minTokensForCache?: number;      // 最小 token 数才缓存
    cacheSystemPrompt?: boolean;      // 是否缓存系统提示
    cacheToolDefinitions?: boolean;   // 是否缓存工具定义
    cacheRecentMessages?: number;     // 缓存最近 N 条消息
  } = {}
): Message[] {
  const {
    minTokensForCache = 1024,        // Anthropic 建议至少 1024 tokens
    cacheSystemPrompt = true,
    cacheToolDefinitions = true,
    cacheRecentMessages = 3,
  } = options;

  // 简单实现：为最后几条消息添加缓存控制
  const result = [...messages];
  const start = Math.max(0, messages.length - cacheRecentMessages);

  for (let i = start; i < messages.length; i++) {
    const message = result[i];

    // 只为足够长的消息添加缓存
    if (Array.isArray(message.content)) {
      const modifiedContent = message.content.map((block, idx) => {
        // 为最后一个文本块添加缓存控制
        if (idx === message.content.length - 1 && block.type === 'text') {
          return {
            ...block,
            cache_control: { type: 'ephemeral' as const },
          };
        }
        return block;
      });

      result[i] = {
        ...message,
        content: modifiedContent,
      };
    }
  }

  return result;
}

/**
 * 计算缓存成本节省
 *
 * Anthropic 定价：
 * - 缓存写入：25% 额外成本
 * - 缓存读取：90% 折扣
 */
export function calculateCacheSavings(usage: TokenUsage): {
  baseCost: number;
  cacheCost: number;
  savings: number;
} {
  // 假设价格（每百万 tokens，单位：美元）
  const baseInputPrice = 3.0;  // 基础输入价格
  const cacheWritePrice = baseInputPrice * 1.25;  // 缓存写入价格
  const cacheReadPrice = baseInputPrice * 0.1;    // 缓存读取价格

  const baseCost = (usage.input_tokens / 1000000) * baseInputPrice;

  const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / 1000000) * cacheWritePrice;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1000000) * cacheReadPrice;

  const totalCost = baseCost + cacheWriteCost + cacheReadCost;

  // 如果没有使用缓存，成本会是多少
  const totalTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  const wouldBeCost = (totalTokens / 1000000) * baseInputPrice;

  return {
    baseCost: totalCost,
    cacheCost: cacheWriteCost + cacheReadCost,
    savings: wouldBeCost - totalCost,
  };
}

// ============ T324: 消息优先级排序 ============

/**
 * 消息重要性等级
 */
export enum MessagePriority {
  CRITICAL = 5,    // 关键消息（系统提示、错误等）
  HIGH = 4,        // 重要消息（最近对话、工具调用）
  MEDIUM = 3,      // 普通消息
  LOW = 2,         // 低优先级（旧对话）
  MINIMAL = 1,     // 最低优先级（可压缩）
}

/**
 * 带优先级的消息
 */
export interface PrioritizedMessage {
  message: Message;
  priority: MessagePriority;
  timestamp: number;
  tokens: number;
}

/**
 * 评估消息的重要性
 */
export function evaluateMessagePriority(
  message: Message,
  index: number,
  totalMessages: number
): MessagePriority {
  // 系统消息最高优先级
  if (message.role === 'user' && typeof message.content === 'string' &&
      message.content.includes('===') && message.content.includes('Summary')) {
    return MessagePriority.CRITICAL;
  }

  // 最近的消息高优先级
  const recencyFactor = index / totalMessages;
  if (recencyFactor >= 0.8) {
    return MessagePriority.HIGH;
  }

  // 包含工具调用的消息
  if (Array.isArray(message.content)) {
    const hasToolUse = message.content.some(
      (block) => block.type === 'tool_use' || block.type === 'tool_result'
    );
    if (hasToolUse) {
      return MessagePriority.HIGH;
    }
  }

  // 中等优先级
  if (recencyFactor >= 0.5) {
    return MessagePriority.MEDIUM;
  }

  // 低优先级
  return MessagePriority.LOW;
}

/**
 * 根据优先级排序消息
 */
export function sortMessagesByPriority(
  messages: Message[],
  estimateTokens: (msg: Message) => number
): PrioritizedMessage[] {
  return messages
    .map((message, index) => ({
      message,
      priority: evaluateMessagePriority(message, index, messages.length),
      timestamp: Date.now() - (messages.length - index) * 1000,
      tokens: estimateTokens(message),
    }))
    .sort((a, b) => {
      // 首先按优先级排序
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 相同优先级按时间排序
      return b.timestamp - a.timestamp;
    });
}

// ============ T325: Tool Reference 折叠 ============

/**
 * 检测是否是 tool reference
 */
export function isToolReference(block: AnyContentBlock): block is ToolReferenceBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_reference'
  );
}

/**
 * 折叠工具引用（替换为占位符）
 */
export function collapseToolReferences(message: Message): Message {
  if (typeof message.content === 'string') {
    return message;
  }

  const filteredContent = message.content.filter((block) => !isToolReference(block));

  // 如果所有内容都是引用，添加占位符
  if (filteredContent.length === 0) {
    return {
      ...message,
      content: [
        {
          type: 'text',
          text: '[tool references]',
        },
      ],
    };
  }

  // 如果移除了一些引用
  if (filteredContent.length !== message.content.length) {
    return {
      ...message,
      content: filteredContent,
    };
  }

  return message;
}

// ============ T331: AXON.md 文件解析 ============

/**
 * AXON.md 配置
 */
export interface ClaudeMdConfig {
  content: string;
  files: string[];  // 引用的文件列表
}

/**
 * 解析 AXON.md 文件
 */
export async function parseClaudeMd(cwd: string): Promise<ClaudeMdConfig | null> {
  const possiblePaths = [
    path.join(cwd, 'AXON.md'),
    path.join(cwd, '.axon', 'AXON.md'),
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const files = extractFileReferences(content, cwd);

      return {
        content,
        files,
      };
    }
  }

  return null;
}

/**
 * 从文本中提取文件引用
 */
function extractFileReferences(text: string, cwd: string): string[] {
  const files: string[] = [];

  // 匹配 Markdown 链接 [text](path)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    const linkPath = match[2];

    // 跳过 URL
    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
      continue;
    }

    // 解析相对路径
    const absolutePath = path.resolve(cwd, linkPath);
    if (fs.existsSync(absolutePath)) {
      files.push(absolutePath);
    }
  }

  // 匹配代码块中的路径
  const codeBlockRegex = /```[\w]*\n([^`]+)```/g;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1];
    const pathRegex = /(?:^|\s)((?:\.\/|\.\.\/|\/)[\w\-/]+\.[\w]+)/gm;
    let pathMatch;

    while ((pathMatch = pathRegex.exec(content)) !== null) {
      const filePath = pathMatch[1];
      const absolutePath = path.resolve(cwd, filePath);
      if (fs.existsSync(absolutePath) && !files.includes(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

/**
 * 注入 AXON.md 到系统提示
 */
export async function injectClaudeMd(
  systemPrompt: string,
  cwd: string
): Promise<string> {
  const config = await parseClaudeMd(cwd);

  if (!config) {
    return systemPrompt;
  }

  const parts = [systemPrompt];

  parts.push('\n\n## Project-Specific Instructions (AXON.md)\n');
  parts.push(config.content);

  // 如果有引用的文件，读取并添加
  if (config.files.length > 0) {
    parts.push('\n\n## Referenced Files\n');

    for (const filePath of config.files.slice(0, 5)) {  // 最多 5 个文件
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(cwd, filePath);
        parts.push(`\n### ${relativePath}\n`);
        parts.push('```\n');
        parts.push(content.slice(0, 5000));  // 限制大小
        if (content.length > 5000) {
          parts.push('\n... (truncated)');
        }
        parts.push('\n```\n');
      } catch (error) {
        // 忽略读取失败的文件
      }
    }
  }

  return parts.join('');
}

// ============ T332: @ 文件提及处理 ============

/**
 * 检测用户输入中的 @ 文件提及
 */
export function parseAtMentions(text: string): string[] {
  const mentions: string[] = [];

  // 匹配 @filename 或 @path/to/file
  const regex = /@([\w\-./]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

/**
 * 解析 @ 提及并读取文件内容
 * v2.1.30: 大 PDF（>10页）返回轻量引用（pdf_reference）而不是内联内容
 */
export async function resolveAtMentions(
  text: string,
  cwd: string
): Promise<{
  processedText: string;
  files: Array<{ path: string; content: string }>;
}> {
  const mentions = parseAtMentions(text);
  const files: Array<{ path: string; content: string }> = [];
  let processedText = text;

  for (const mention of mentions) {
    // 尝试解析文件路径
    const possiblePaths = [
      path.resolve(cwd, mention),
      path.resolve(cwd, mention + '.ts'),
      path.resolve(cwd, mention + '.js'),
      path.resolve(cwd, mention + '.md'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        try {
          const ext = path.extname(filePath).toLowerCase().slice(1);

          // v2.1.30: PDF 文件特殊处理
          if (isPdfExtension(ext)) {
            const stat = fs.statSync(filePath);
            const pageCount = await getPdfPageCount(filePath);

            // 大 PDF (>10 页) 使用轻量引用 (pdf_reference)
            if (pageCount !== null && pageCount > PDF_LARGE_THRESHOLD) {
              const filename = path.relative(cwd, filePath);
              const replacement = `\n\nPDF file: ${filename} (${pageCount} pages, ${formatBytes(stat.size)}). This PDF is too large to read all at once. You MUST use the Read tool with the pages parameter to read specific page ranges (e.g., pages: "1-5"). Do NOT call Read without the pages parameter or it will fail. Start by reading the first few pages to understand the structure, then read more as needed. Maximum ${PDF_MAX_PAGES_PER_REQUEST} pages per request.\n`;
              processedText = processedText.replace(`@${mention}`, replacement);
              files.push({
                path: path.relative(cwd, filePath),
                content: `[PDF Reference: ${pageCount} pages, ${formatBytes(stat.size)}]`,
              });
              break;
            }
            // 小 PDF 正常内联
            // (falls through to regular file handling below)
          }

          const content = fs.readFileSync(filePath, 'utf-8');
          files.push({
            path: path.relative(cwd, filePath),
            content,
          });

          // 替换 @mention 为文件内容引用
          const replacement = `\n\n[File: ${path.relative(cwd, filePath)}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`\n`;
          processedText = processedText.replace(`@${mention}`, replacement);
          break;
        } catch (error) {
          // 读取失败，跳过
        }
      }
    }
  }

  return {
    processedText,
    files,
  };
}

// ============ T330: MCP URI 管理 ============

/**
 * MCP 资源 URI
 */
export interface McpResourceUri {
  server: string;
  uri: string;
  content?: string;
}

/**
 * MCP 资源块
 */
export interface McpResourceBlock {
  type: 'mcp_resource';
  server: string;
  uri: string;
  content?: string;
}

/**
 * 解析 MCP URI
 */
export function parseMcpUri(uri: string): { server: string; path: string } | null {
  // MCP URI 格式：mcp://server/path
  const match = uri.match(/^mcp:\/\/([^/]+)(\/.*)?$/);

  if (!match) {
    return null;
  }

  return {
    server: match[1],
    path: match[2] || '/',
  };
}

/**
 * 格式化 MCP 资源为消息块
 */
export function formatMcpResource(resource: McpResourceUri): ContentBlock {
  if (!resource.content || resource.content.length === 0) {
    return {
      type: 'text',
      text: `<mcp-resource server="${resource.server}" uri="${resource.uri}">(No content)</mcp-resource>`,
    };
  }

  return {
    type: 'text',
    text: `<mcp-resource server="${resource.server}" uri="${resource.uri}">
${resource.content}
</mcp-resource>`,
  };
}

// ============ 导出 ============

export interface EnhancedContextManager {
  windowManager: ContextWindowManager;

  // Token 管理
  getModelContextWindow: typeof getModelContextWindow;
  recordUsage: (usage: TokenUsage) => void;

  // 缓存管理
  addCacheControl: typeof addCacheControl;
  calculateCacheSavings: typeof calculateCacheSavings;

  // 优先级管理
  sortMessagesByPriority: typeof sortMessagesByPriority;

  // 引用折叠
  collapseToolReferences: typeof collapseToolReferences;

  // AXON.md
  injectClaudeMd: typeof injectClaudeMd;

  // @ 提及
  resolveAtMentions: typeof resolveAtMentions;

  // MCP
  formatMcpResource: typeof formatMcpResource;
}

/**
 * 创建增强的上下文管理器
 */
export function createEnhancedContextManager(modelId: string): EnhancedContextManager {
  const windowManager = new ContextWindowManager(modelId);

  return {
    windowManager,
    getModelContextWindow,
    recordUsage: (usage) => windowManager.recordUsage(usage),
    addCacheControl,
    calculateCacheSavings,
    sortMessagesByPriority,
    collapseToolReferences,
    injectClaudeMd,
    resolveAtMentions,
    formatMcpResource,
  };
}
