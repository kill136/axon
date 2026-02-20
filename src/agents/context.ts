/**
 * 代理上下文继承机制
 * 实现代理间的上下文传递、过滤、压缩和隔离
 *
 * 功能：
 * 1. 上下文传递 - 传递对话历史、文件上下文和工具结果
 * 2. 上下文过滤 - 选择性传递和敏感信息过滤
 * 3. 上下文压缩 - 自动摘要和 Token 优化
 * 4. 上下文隔离 - 代理间隔离和沙箱环境
 */

import type { Message, ToolResult as BaseToolResult } from '../types/index.js';
import {
  estimateMessageTokens,
  estimateTotalTokens,
  estimateTokens,
  compressMessage,
  createSummary,
  type ConversationTurn,
} from '../context/index.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ==================== 类型定义 ====================

/**
 * 文件上下文
 */
export interface FileContext {
  filePath: string;
  content?: string;
  contentSummary?: string;
  lastModified?: Date;
  size?: number;
  encoding?: string;
  metadata?: Record<string, any>;
}
/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  toolName: string;
  toolUseId: string;
  input: any;
  output: string | object;
  success: boolean;
  error?: string;
  timestamp: Date;
  duration?: number;
  compressed?: boolean;
}

/**
 * 代理上下文
 */
export interface AgentContext {
  // 上下文标识
  contextId: string;
  agentId?: string;
  parentContextId?: string;

  // 对话历史
  conversationHistory: Message[];
  conversationSummary?: string;

  // 文件上下文
  fileContext: FileContext[];

  // 工具结果
  toolResults: ToolExecutionResult[];

  // 系统提示
  systemPrompt?: string;

  // 环境信息
  workingDirectory: string;
  environment: Record<string, string>;

  // 元数据
  metadata: {
    createdAt: Date;
    inheritedFrom?: string;
    inheritanceType?: ContextInheritanceType;
    tokenCount?: number;
    compressionRatio?: number;
    [key: string]: any;
  };
}

/**
 * 上下文继承类型
 */
export type ContextInheritanceType = 'full' | 'summary' | 'minimal' | 'isolated';

/**
 * 上下文继承配置
 */
export interface ContextInheritanceConfig {
  // 继承选项
  inheritConversation: boolean;
  inheritFiles: boolean;
  inheritToolResults: boolean;
  inheritEnvironment: boolean;

  // 历史长度限制
  maxHistoryLength?: number;
  maxFileContexts?: number;
  maxToolResults?: number;

  // 过滤选项
  filterSensitive: boolean;
  sensitivePatterns?: RegExp[];

  // 压缩选项
  compressContext: boolean;
  targetTokens?: number;
  compressionRatio?: number;

  // 继承类型
  inheritanceType?: ContextInheritanceType;

  // 自定义过滤器
  customFilter?: (context: AgentContext) => AgentContext;
}

/**
 * 上下文过滤器
 */
export interface ContextFilter {
  includeConversation?: boolean;
  includeFiles?: boolean;
  includeToolResults?: boolean;

  conversationFilter?: (messages: Message[]) => Message[];
  fileFilter?: (files: FileContext[]) => FileContext[];
  toolResultFilter?: (results: ToolExecutionResult[]) => ToolExecutionResult[];

  tokenLimit?: number;
  timeRange?: { start?: Date; end?: Date };
}

/**
 * 沙箱上下文
 */
export interface SandboxedContext {
  sandboxId: string;
  agentId: string;
  context: AgentContext;

  // 沙箱限制
  restrictions: {
    maxTokens: number;
    maxFiles: number;
    maxToolResults: number;
    allowedTools?: string[];
    deniedTools?: string[];
  };

  // 沙箱状态
  state: 'active' | 'suspended' | 'terminated';
  createdAt: Date;
  expiresAt?: Date;

  // 资源追踪
  resources: {
    tokenUsage: number;
    fileAccess: string[];
    toolCalls: string[];
  };
}

/**
 * 上下文压缩结果
 */
export interface ContextCompressionResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  savedTokens: number;
  method: 'summary' | 'truncate' | 'intelligent' | 'none';
}

// ==================== 常量定义 ====================

const DEFAULT_INHERITANCE_CONFIG: ContextInheritanceConfig = {
  inheritConversation: true,
  inheritFiles: true,
  inheritToolResults: true,
  inheritEnvironment: true,
  maxHistoryLength: 50,
  maxFileContexts: 20,
  maxToolResults: 30,
  filterSensitive: true,
  compressContext: true,
  inheritanceType: 'summary',
};

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /token/i,
  /credentials?/i,
  /auth/i,
  /bearer/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
];

const SENSITIVE_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  'credentials.json',
  'secrets.yaml',
  'private_key.pem',
  'id_rsa',
  '.ssh/id_rsa',
];

const CONTEXT_STORAGE_DIR = path.join(os.homedir(), '.claude', 'agent-contexts');

// ==================== 辅助函数 ====================

/**
 * 确保上下文存储目录存在
 */
function ensureContextStorageDir(): void {
  if (!fs.existsSync(CONTEXT_STORAGE_DIR)) {
    fs.mkdirSync(CONTEXT_STORAGE_DIR, { recursive: true });
  }
}

/**
 * 检测敏感数据
 */
function containsSensitiveData(text: string, patterns: RegExp[] = SENSITIVE_PATTERNS): boolean {
  return patterns.some(pattern => pattern.test(text));
}

/**
 * 检测敏感文件
 */
function isSensitiveFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return SENSITIVE_FILES.some(sf => fileName === sf || filePath.includes(sf));
}

/**
 * 过滤敏感数据
 */
export function filterSensitiveData(context: AgentContext): AgentContext {
  const filtered: AgentContext = {
    ...context,
    conversationHistory: [],
    fileContext: [],
    toolResults: [],
    environment: {},
  };

  // 过滤对话历史中的敏感数据
  filtered.conversationHistory = context.conversationHistory.map(msg => {
    if (typeof msg.content === 'string') {
      if (containsSensitiveData(msg.content)) {
        return {
          ...msg,
          content: '[Sensitive content filtered]',
        };
      }
      return msg;
    }

    // 处理数组内容
    const filteredBlocks = msg.content.map(block => {
      if (block.type === 'text' && block.text && containsSensitiveData(block.text)) {
        return {
          ...block,
          text: '[Sensitive content filtered]',
        };
      }
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);
        if (containsSensitiveData(content)) {
          return {
            ...block,
            content: '[Sensitive output filtered]',
          };
        }
      }
      return block;
    });

    return {
      ...msg,
      content: filteredBlocks,
    };
  });

  // 过滤敏感文件
  filtered.fileContext = context.fileContext.filter(fc => !isSensitiveFile(fc.filePath));

  // 过滤工具结果中的敏感数据
  filtered.toolResults = context.toolResults.map(result => {
    const outputStr = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);

    if (containsSensitiveData(outputStr) || containsSensitiveData(JSON.stringify(result.input))) {
      return {
        ...result,
        output: '[Sensitive output filtered]',
        input: '[Sensitive input filtered]',
      };
    }
    return result;
  });

  // 过滤环境变量中的敏感数据
  for (const [key, value] of Object.entries(context.environment)) {
    if (!containsSensitiveData(key) && !containsSensitiveData(value)) {
      filtered.environment[key] = value;
    }
  }

  return filtered;
}

/**
 * 估算上下文 Token 数
 */
export function estimateContextTokens(context: AgentContext): number {
  let total = 0;

  // 对话历史
  total += estimateTotalTokens(context.conversationHistory);

  // 对话摘要
  if (context.conversationSummary) {
    total += estimateTokens(context.conversationSummary);
  }

  // 文件上下文
  for (const file of context.fileContext) {
    if (file.content) {
      total += estimateTokens(file.content);
    } else if (file.contentSummary) {
      total += estimateTokens(file.contentSummary);
    }
  }

  // 工具结果
  for (const result of context.toolResults) {
    const outputStr = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);
    total += estimateTokens(outputStr);
    total += estimateTokens(JSON.stringify(result.input));
  }

  // 系统提示
  if (context.systemPrompt) {
    total += estimateTokens(context.systemPrompt);
  }

  return total;
}

/**
 * 摘要对话历史
 */
export function summarizeConversation(messages: Message[], maxTokens: number): Message[] {
  const currentTokens = estimateTotalTokens(messages);

  if (currentTokens <= maxTokens) {
    return messages;
  }

  // 保留最近的消息
  const keepRecent = 10;
  const recentMessages = messages.slice(-keepRecent);
  const recentTokens = estimateTotalTokens(recentMessages);

  if (recentTokens >= maxTokens) {
    // 即使最近的消息也超过限制，只保留最后几条
    return messages.slice(-Math.max(5, Math.floor(keepRecent / 2)));
  }

  // 对旧消息进行摘要
  const oldMessages = messages.slice(0, -keepRecent);

  // 创建摘要消息
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < oldMessages.length - 1; i += 2) {
    if (oldMessages[i].role === 'user' && oldMessages[i + 1]?.role === 'assistant') {
      turns.push({
        user: oldMessages[i],
        assistant: oldMessages[i + 1],
        timestamp: Date.now(),
        tokenEstimate: estimateMessageTokens(oldMessages[i]) + estimateMessageTokens(oldMessages[i + 1]),
        originalTokens: estimateMessageTokens(oldMessages[i]) + estimateMessageTokens(oldMessages[i + 1]),
      });
    }
  }

  const summary = createSummary(turns);
  const summaryMessage: Message = {
    role: 'user',
    content: summary,
  };

  return [summaryMessage, ...recentMessages];
}

/**
 * 压缩文件上下文
 */
function compressFileContexts(files: FileContext[], targetCount: number): FileContext[] {
  if (files.length <= targetCount) {
    return files;
  }

  // 保留最近修改的文件
  const sorted = [...files].sort((a, b) => {
    const timeA = a.lastModified?.getTime() || 0;
    const timeB = b.lastModified?.getTime() || 0;
    return timeB - timeA;
  });

  return sorted.slice(0, targetCount).map(file => ({
    ...file,
    content: undefined, // 移除内容，只保留元数据
    contentSummary: file.contentSummary || `File: ${file.filePath} (${file.size || 0} bytes)`,
  }));
}

/**
 * 压缩工具结果
 */
function compressToolResults(results: ToolExecutionResult[], targetCount: number): ToolExecutionResult[] {
  if (results.length <= targetCount) {
    return results;
  }

  // 保留最近的结果
  const sorted = [...results].sort((a, b) =>
    b.timestamp.getTime() - a.timestamp.getTime()
  );

  return sorted.slice(0, targetCount).map(result => {
    const outputStr = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);

    // 如果输出太长，截断
    const maxLength = 500;
    const truncated = outputStr.length > maxLength
      ? outputStr.substring(0, maxLength) + '...[truncated]'
      : outputStr;

    return {
      ...result,
      output: truncated,
      compressed: outputStr.length > maxLength,
    };
  });
}

// ==================== AgentContextManager ====================

/**
 * 代理上下文管理器
 */
export class AgentContextManager {
  private contexts: Map<string, AgentContext> = new Map();

  constructor() {
    ensureContextStorageDir();
    this.loadPersistedContexts();
  }

  /**
   * 创建新的代理上下文
   */
  createContext(parent?: AgentContext, config?: ContextInheritanceConfig): AgentContext {
    const contextId = uuidv4();
    const mergedConfig = { ...DEFAULT_INHERITANCE_CONFIG, ...config };

    let newContext: AgentContext;

    if (parent && mergedConfig.inheritConversation) {
      // 继承父上下文
      newContext = this.inherit(parent, mergedConfig);
      newContext.contextId = contextId;
      newContext.parentContextId = parent.contextId;
      newContext.metadata.inheritedFrom = parent.contextId;
    } else {
      // 创建新上下文
      newContext = {
        contextId,
        conversationHistory: [],
        fileContext: [],
        toolResults: [],
        workingDirectory: process.cwd(),
        environment: { ...process.env } as Record<string, string>,
        metadata: {
          createdAt: new Date(),
          inheritanceType: 'isolated',
        },
      };
    }

    this.contexts.set(contextId, newContext);
    this.persistContext(newContext);

    return newContext;
  }

  /**
   * 继承父上下文
   */
  inherit(parentContext: AgentContext, config: ContextInheritanceConfig): AgentContext {
    let inherited: AgentContext = {
      contextId: uuidv4(),
      parentContextId: parentContext.contextId,
      conversationHistory: [],
      fileContext: [],
      toolResults: [],
      workingDirectory: parentContext.workingDirectory,
      environment: {},
      metadata: {
        createdAt: new Date(),
        inheritedFrom: parentContext.contextId,
        inheritanceType: config.inheritanceType || 'summary',
      },
    };

    // 继承对话历史
    if (config.inheritConversation) {
      inherited.conversationHistory = [...parentContext.conversationHistory];
      if (config.maxHistoryLength && inherited.conversationHistory.length > config.maxHistoryLength) {
        inherited.conversationHistory = inherited.conversationHistory.slice(-config.maxHistoryLength);
      }

      if (parentContext.conversationSummary) {
        inherited.conversationSummary = parentContext.conversationSummary;
      }
    }

    // 继承文件上下文
    if (config.inheritFiles) {
      inherited.fileContext = [...parentContext.fileContext];
      if (config.maxFileContexts && inherited.fileContext.length > config.maxFileContexts) {
        inherited.fileContext = compressFileContexts(inherited.fileContext, config.maxFileContexts);
      }
    }

    // 继承工具结果
    if (config.inheritToolResults) {
      inherited.toolResults = [...parentContext.toolResults];
      if (config.maxToolResults && inherited.toolResults.length > config.maxToolResults) {
        inherited.toolResults = compressToolResults(inherited.toolResults, config.maxToolResults);
      }
    }

    // 继承环境变量
    if (config.inheritEnvironment) {
      inherited.environment = { ...parentContext.environment };
    }

    // 继承系统提示
    if (parentContext.systemPrompt) {
      inherited.systemPrompt = parentContext.systemPrompt;
    }

    // 应用过滤
    if (config.filterSensitive) {
      inherited = filterSensitiveData(inherited);
    }

    // 应用压缩
    if (config.compressContext) {
      const result = this.compress(inherited, config.targetTokens || 50000);
      inherited = result.context;
      inherited.metadata.compressionRatio = result.compressionRatio;
    }

    // 应用自定义过滤器
    if (config.customFilter) {
      inherited = config.customFilter(inherited);
    }

    // 计算 token 数
    inherited.metadata.tokenCount = estimateContextTokens(inherited);

    return inherited;
  }

  /**
   * 压缩上下文
   */
  compress(context: AgentContext, targetTokens: number): {
    context: AgentContext;
    compressionRatio: number;
    savedTokens: number;
  } {
    const originalTokens = estimateContextTokens(context);

    if (originalTokens <= targetTokens) {
      return {
        context,
        compressionRatio: 1,
        savedTokens: 0,
      };
    }

    const compressed: AgentContext = { ...context };

    // 1. 压缩对话历史
    compressed.conversationHistory = summarizeConversation(
      context.conversationHistory,
      Math.floor(targetTokens * 0.6)
    );

    // 2. 压缩文件上下文
    const fileTokenTarget = Math.floor(targetTokens * 0.2);
    let fileTokens = 0;
    compressed.fileContext = [];

    for (const file of context.fileContext) {
      const fileTokenEstimate = file.content
        ? estimateTokens(file.content)
        : (file.contentSummary ? estimateTokens(file.contentSummary) : 100);

      if (fileTokens + fileTokenEstimate <= fileTokenTarget) {
        compressed.fileContext.push(file);
        fileTokens += fileTokenEstimate;
      } else if (file.content) {
        // 只保留摘要
        compressed.fileContext.push({
          ...file,
          content: undefined,
          contentSummary: `File: ${file.filePath} (content omitted, ${file.size || 0} bytes)`,
        });
        fileTokens += 50;
      }
    }

    // 3. 压缩工具结果
    const toolTokenTarget = Math.floor(targetTokens * 0.2);
    compressed.toolResults = compressToolResults(
      context.toolResults,
      Math.floor(toolTokenTarget / 100)
    );

    const compressedTokens = estimateContextTokens(compressed);

    return {
      context: compressed,
      compressionRatio: compressedTokens / originalTokens,
      savedTokens: originalTokens - compressedTokens,
    };
  }

  /**
   * 过滤上下文
   */
  filter(context: AgentContext, filter: ContextFilter): AgentContext {
    const filtered: AgentContext = {
      ...context,
      conversationHistory: [],
      fileContext: [],
      toolResults: [],
    };

    // 过滤对话历史
    if (filter.includeConversation !== false) {
      filtered.conversationHistory = filter.conversationFilter
        ? filter.conversationFilter(context.conversationHistory)
        : context.conversationHistory;
    }

    // 过滤文件上下文
    if (filter.includeFiles !== false) {
      filtered.fileContext = filter.fileFilter
        ? filter.fileFilter(context.fileContext)
        : context.fileContext;
    }

    // 过滤工具结果
    if (filter.includeToolResults !== false) {
      filtered.toolResults = filter.toolResultFilter
        ? filter.toolResultFilter(context.toolResults)
        : context.toolResults;
    }

    // 应用时间范围过滤
    if (filter.timeRange) {
      filtered.toolResults = filtered.toolResults.filter(result => {
        const timestamp = result.timestamp.getTime();
        const afterStart = !filter.timeRange?.start || timestamp >= filter.timeRange.start.getTime();
        const beforeEnd = !filter.timeRange?.end || timestamp <= filter.timeRange.end.getTime();
        return afterStart && beforeEnd;
      });
    }

    // 应用 token 限制
    if (filter.tokenLimit) {
      const compressed = this.compress(filtered, filter.tokenLimit);
      return compressed.context;
    }

    return filtered;
  }

  /**
   * 合并多个上下文
   */
  merge(contexts: AgentContext[]): AgentContext {
    if (contexts.length === 0) {
      throw new Error('Cannot merge empty context array');
    }

    if (contexts.length === 1) {
      return contexts[0];
    }

    const merged: AgentContext = {
      contextId: uuidv4(),
      conversationHistory: [],
      fileContext: [],
      toolResults: [],
      workingDirectory: contexts[0].workingDirectory,
      environment: {},
      metadata: {
        createdAt: new Date(),
        inheritanceType: 'full',
        mergedFrom: contexts.map(c => c.contextId),
      },
    };

    // 合并对话历史（按时间排序）
    const allMessages: Array<{ message: Message; contextId: string }> = [];
    for (const ctx of contexts) {
      for (const msg of ctx.conversationHistory) {
        allMessages.push({ message: msg, contextId: ctx.contextId });
      }
    }
    // 注意：这里简化处理，实际应该根据时间戳排序
    merged.conversationHistory = allMessages.map(m => m.message);

    // 合并文件上下文（去重）
    const fileMap = new Map<string, FileContext>();
    for (const ctx of contexts) {
      for (const file of ctx.fileContext) {
        if (!fileMap.has(file.filePath) ||
            (file.lastModified && file.lastModified > (fileMap.get(file.filePath)?.lastModified || new Date(0)))) {
          fileMap.set(file.filePath, file);
        }
      }
    }
    merged.fileContext = Array.from(fileMap.values());

    // 合并工具结果（按时间排序）
    const allResults: ToolExecutionResult[] = [];
    for (const ctx of contexts) {
      allResults.push(...ctx.toolResults);
    }
    merged.toolResults = allResults.sort((a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime()
    );

    // 合并环境变量
    for (const ctx of contexts) {
      merged.environment = { ...merged.environment, ...ctx.environment };
    }

    // 使用第一个上下文的系统提示
    merged.systemPrompt = contexts[0].systemPrompt;

    return merged;
  }

  /**
   * 获取上下文
   */
  getContext(contextId: string): AgentContext | undefined {
    return this.contexts.get(contextId);
  }

  /**
   * 更新上下文
   */
  updateContext(contextId: string, updates: Partial<AgentContext>): void {
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Context ${contextId} not found`);
    }

    const updated = { ...context, ...updates, contextId };
    this.contexts.set(contextId, updated);
    this.persistContext(updated);
  }

  /**
   * 删除上下文
   */
  deleteContext(contextId: string): boolean {
    const deleted = this.contexts.delete(contextId);
    if (deleted) {
      this.removePersistedContext(contextId);
    }
    return deleted;
  }

  /**
   * 持久化上下文
   */
  private persistContext(context: AgentContext): void {
    try {
      const filePath = path.join(CONTEXT_STORAGE_DIR, `${context.contextId}.json`);
      const data = {
        ...context,
        metadata: {
          ...context.metadata,
          createdAt: context.metadata.createdAt.toISOString(),
        },
        toolResults: context.toolResults.map(result => ({
          ...result,
          timestamp: result.timestamp.toISOString(),
        })),
        fileContext: context.fileContext.map(file => ({
          ...file,
          lastModified: file.lastModified?.toISOString(),
        })),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to persist context ${context.contextId}:`, error);
    }
  }

  /**
   * 加载持久化的上下文
   */
  private loadPersistedContexts(): void {
    try {
      if (!fs.existsSync(CONTEXT_STORAGE_DIR)) {
        return;
      }

      const files = fs.readdirSync(CONTEXT_STORAGE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(CONTEXT_STORAGE_DIR, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            const context: AgentContext = {
              ...data,
              metadata: {
                ...data.metadata,
                createdAt: new Date(data.metadata.createdAt),
              },
              toolResults: data.toolResults.map((result: any) => ({
                ...result,
                timestamp: new Date(result.timestamp),
              })),
              fileContext: data.fileContext.map((file: any) => ({
                ...file,
                lastModified: file.lastModified ? new Date(file.lastModified) : undefined,
              })),
            };

            this.contexts.set(context.contextId, context);
          } catch (error) {
            console.error(`Failed to load context from ${file}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load persisted contexts:', error);
    }
  }

  /**
   * 移除持久化的上下文
   */
  private removePersistedContext(contextId: string): void {
    try {
      const filePath = path.join(CONTEXT_STORAGE_DIR, `${contextId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to remove persisted context ${contextId}:`, error);
    }
  }

  /**
   * 清理过期上下文
   */
  cleanupExpired(maxAgeDays: number = 7): number {
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [contextId, context] of Array.from(this.contexts.entries())) {
      const age = now - context.metadata.createdAt.getTime();
      if (age > maxAge) {
        this.deleteContext(contextId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 获取所有上下文
   */
  getAllContexts(): AgentContext[] {
    return Array.from(this.contexts.values());
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalContexts: number;
    totalTokens: number;
    averageTokens: number;
    contextsByType: Record<string, number>;
  } {
    const contexts = this.getAllContexts();
    const totalTokens = contexts.reduce((sum, ctx) =>
      sum + (ctx.metadata.tokenCount || estimateContextTokens(ctx)), 0
    );

    const contextsByType: Record<string, number> = {};
    for (const ctx of contexts) {
      const type = ctx.metadata.inheritanceType || 'unknown';
      contextsByType[type] = (contextsByType[type] || 0) + 1;
    }

    return {
      totalContexts: contexts.length,
      totalTokens,
      averageTokens: contexts.length > 0 ? totalTokens / contexts.length : 0,
      contextsByType,
    };
  }
}

// ==================== ContextIsolation ====================

/**
 * 上下文隔离管理器
 */
export class ContextIsolation {
  private sandboxes: Map<string, SandboxedContext> = new Map();
  private agentSandboxes: Map<string, string> = new Map(); // agentId -> sandboxId

  constructor() {}

  /**
   * 创建沙箱上下文
   */
  createSandbox(
    context: AgentContext,
    agentId?: string,
    restrictions?: Partial<SandboxedContext['restrictions']>
  ): SandboxedContext {
    const sandboxId = uuidv4();
    const effectiveAgentId = agentId || context.agentId || uuidv4();

    const sandbox: SandboxedContext = {
      sandboxId,
      agentId: effectiveAgentId,
      context: { ...context },
      restrictions: {
        maxTokens: restrictions?.maxTokens || 100000,
        maxFiles: restrictions?.maxFiles || 50,
        maxToolResults: restrictions?.maxToolResults || 100,
        allowedTools: restrictions?.allowedTools,
        deniedTools: restrictions?.deniedTools,
      },
      state: 'active',
      createdAt: new Date(),
      expiresAt: restrictions?.maxTokens
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
        : undefined,
      resources: {
        tokenUsage: estimateContextTokens(context),
        fileAccess: context.fileContext.map(f => f.filePath),
        toolCalls: context.toolResults.map(r => r.toolName),
      },
    };

    this.sandboxes.set(sandboxId, sandbox);
    this.agentSandboxes.set(effectiveAgentId, sandboxId);

    return sandbox;
  }

  /**
   * 获取沙箱上下文
   */
  getSandbox(sandboxId: string): SandboxedContext | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * 获取代理的隔离上下文
   */
  getIsolatedContext(agentId: string): AgentContext | null {
    const sandboxId = this.agentSandboxes.get(agentId);
    if (!sandboxId) {
      return null;
    }

    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.state !== 'active') {
      return null;
    }

    return sandbox.context;
  }

  /**
   * 更新沙箱上下文
   */
  updateSandbox(sandboxId: string, updates: Partial<AgentContext>): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    if (sandbox.state !== 'active') {
      throw new Error(`Sandbox ${sandboxId} is not active`);
    }

    sandbox.context = { ...sandbox.context, ...updates };

    // 更新资源使用
    sandbox.resources.tokenUsage = estimateContextTokens(sandbox.context);
    sandbox.resources.fileAccess = sandbox.context.fileContext.map(f => f.filePath);
    sandbox.resources.toolCalls = sandbox.context.toolResults.map(r => r.toolName);

    // 检查限制
    if (sandbox.resources.tokenUsage > sandbox.restrictions.maxTokens) {
      sandbox.state = 'suspended';
      throw new Error(`Sandbox ${sandboxId} exceeded token limit`);
    }

    if (sandbox.context.fileContext.length > sandbox.restrictions.maxFiles) {
      sandbox.state = 'suspended';
      throw new Error(`Sandbox ${sandboxId} exceeded file limit`);
    }

    if (sandbox.context.toolResults.length > sandbox.restrictions.maxToolResults) {
      sandbox.state = 'suspended';
      throw new Error(`Sandbox ${sandboxId} exceeded tool result limit`);
    }
  }

  /**
   * 清理沙箱
   */
  cleanup(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.state = 'terminated';
      this.agentSandboxes.delete(sandbox.agentId);
      this.sandboxes.delete(sandboxId);
    }
  }

  /**
   * 清理代理的沙箱
   */
  cleanupAgent(agentId: string): void {
    const sandboxId = this.agentSandboxes.get(agentId);
    if (sandboxId) {
      this.cleanup(sandboxId);
    }
  }

  /**
   * 清理过期沙箱
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sandboxId, sandbox] of Array.from(this.sandboxes.entries())) {
      if (sandbox.expiresAt && sandbox.expiresAt.getTime() < now) {
        this.cleanup(sandboxId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 挂起沙箱
   */
  suspend(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox && sandbox.state === 'active') {
      sandbox.state = 'suspended';
    }
  }

  /**
   * 恢复沙箱
   */
  resume(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox && sandbox.state === 'suspended') {
      sandbox.state = 'active';
    }
  }

  /**
   * 检查工具是否允许
   */
  isToolAllowed(sandboxId: string, toolName: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }

    // 检查拒绝列表
    if (sandbox.restrictions.deniedTools?.includes(toolName)) {
      return false;
    }

    // 检查允许列表
    if (sandbox.restrictions.allowedTools) {
      return sandbox.restrictions.allowedTools.includes(toolName);
    }

    // 默认允许
    return true;
  }

  /**
   * 获取沙箱统计
   */
  getStats(): {
    totalSandboxes: number;
    activeSandboxes: number;
    suspendedSandboxes: number;
    terminatedSandboxes: number;
    totalTokenUsage: number;
  } {
    let active = 0;
    let suspended = 0;
    let terminated = 0;
    let totalTokenUsage = 0;

    for (const sandbox of Array.from(this.sandboxes.values())) {
      switch (sandbox.state) {
        case 'active':
          active++;
          break;
        case 'suspended':
          suspended++;
          break;
        case 'terminated':
          terminated++;
          break;
      }
      totalTokenUsage += sandbox.resources.tokenUsage;
    }

    return {
      totalSandboxes: this.sandboxes.size,
      activeSandboxes: active,
      suspendedSandboxes: suspended,
      terminatedSandboxes: terminated,
      totalTokenUsage,
    };
  }
}

// ==================== 导出默认实例 ====================

export const contextManager = new AgentContextManager();
export const contextIsolation = new ContextIsolation();

// ==================== 工具函数 ====================

/**
 * 创建默认上下文
 */
export function createDefaultContext(agentId?: string): AgentContext {
  return {
    contextId: uuidv4(),
    agentId,
    conversationHistory: [],
    fileContext: [],
    toolResults: [],
    workingDirectory: process.cwd(),
    environment: { ...process.env } as Record<string, string>,
    metadata: {
      createdAt: new Date(),
      inheritanceType: 'isolated',
    },
  };
}

/**
 * 从对话历史创建上下文
 */
export function createContextFromMessages(
  messages: Message[],
  agentId?: string
): AgentContext {
  const context = createDefaultContext(agentId);
  context.conversationHistory = messages;
  context.metadata.tokenCount = estimateContextTokens(context);
  return context;
}

/**
 * 快速创建继承上下文（使用预设配置）
 */
export function createInheritedContext(
  parent: AgentContext,
  type: ContextInheritanceType = 'summary'
): AgentContext {
  const configs: Record<ContextInheritanceType, ContextInheritanceConfig> = {
    full: {
      inheritConversation: true,
      inheritFiles: true,
      inheritToolResults: true,
      inheritEnvironment: true,
      filterSensitive: true,
      compressContext: false,
      inheritanceType: 'full',
    },
    summary: {
      inheritConversation: true,
      inheritFiles: true,
      inheritToolResults: true,
      inheritEnvironment: true,
      maxHistoryLength: 20,
      maxFileContexts: 10,
      maxToolResults: 15,
      filterSensitive: true,
      compressContext: true,
      targetTokens: 30000,
      inheritanceType: 'summary',
    },
    minimal: {
      inheritConversation: true,
      inheritFiles: false,
      inheritToolResults: false,
      inheritEnvironment: false,
      maxHistoryLength: 5,
      filterSensitive: true,
      compressContext: true,
      targetTokens: 10000,
      inheritanceType: 'minimal',
    },
    isolated: {
      inheritConversation: false,
      inheritFiles: false,
      inheritToolResults: false,
      inheritEnvironment: false,
      filterSensitive: false,
      compressContext: false,
      inheritanceType: 'isolated',
    },
  };

  return contextManager.inherit(parent, configs[type]);
}
