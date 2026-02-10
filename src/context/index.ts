/**
 * 上下文管理系统
 * 处理对话历史、上下文窗口和自动摘要
 *
 * 功能：
 * 1. 智能消息摘要（使用 Claude 生成摘要）
 * 2. 保留最近 N 条消息不压缩
 * 3. 工具调用结果智能压缩
 * 4. 代码块智能保留
 * 5. 文件内容引用压缩
 * 6. 精确的压缩比计算
 * 7. 增量压缩支持
 */

import type { Message, ContentBlock, AnyContentBlock } from '../types/index.js';

// Token 估算常量
const CHARS_PER_TOKEN = 3.5; // 更精确的估算（英文约4，中文约2）
const MAX_CONTEXT_TOKENS = 180000; // Claude 3.5 的上下文窗口
const RESERVE_TOKENS = 32000; // 保留给输出

// 压缩配置常量
const CODE_BLOCK_MAX_LINES = 50; // 代码块最大保留行数
const TOOL_OUTPUT_MAX_CHARS = 2000; // 工具输出最大字符数
const FILE_CONTENT_MAX_CHARS = 1500; // 文件内容最大字符数
const SUMMARY_TARGET_RATIO = 0.3; // 摘要目标压缩比

export interface ContextConfig {
  maxTokens?: number;
  reserveTokens?: number;
  summarizeThreshold?: number; // 何时开始摘要（占用比例）
  keepRecentMessages?: number; // 保留最近多少条消息不压缩
  enableAISummary?: boolean; // 是否使用 AI 生成摘要
  codeBlockMaxLines?: number; // 代码块最大保留行数
  toolOutputMaxChars?: number; // 工具输出最大字符数
  enableIncrementalCompression?: boolean; // 是否启用增量压缩
}

export interface ContextStats {
  totalMessages: number; // 总消息数
  estimatedTokens: number; // 当前估算 token 数
  summarizedMessages: number; // 已摘要消息数
  compressionRatio: number; // 压缩比（当前/原始）
  savedTokens: number; // 节省的 token 数
  compressionCount: number; // 压缩执行次数
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  thinkingTokens?: number;
}

export interface ConversationTurn {
  user: Message;
  assistant: Message;
  timestamp: number;
  tokenEstimate: number; // 后备 token 估算
  originalTokens: number; // 记录原始大小
  summarized?: boolean;
  summary?: string;
  compressed?: boolean; // 是否已压缩工具输出
  compressionMetadata?: {
    originalSize: number;
    compressedSize: number;
    method: 'truncate' | 'ai_summary' | 'code_extract' | 'file_ref';
  };
  // ✅ 添加真实 API usage
  apiUsage?: TokenUsage;
}

export interface CompressionResult {
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  method: string;
}

/**
 * 估算文本 token 数（更精确的算法）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 检测文本类型
  const hasAsian = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/.test(text);
  const hasCode = /^```|function |class |const |let |var |import |export /.test(text);

  // 根据内容类型调整估算
  let charsPerToken = CHARS_PER_TOKEN;

  if (hasAsian) {
    charsPerToken = 2.0; // 中日韩字符
  } else if (hasCode) {
    charsPerToken = 3.0; // 代码通常更密集
  }

  // 计算基础 token
  let tokens = text.length / charsPerToken;

  // 为特殊字符添加权重
  const specialChars = (text.match(/[{}[\]().,;:!?<>]/g) || []).length;
  tokens += specialChars * 0.1; // 特殊字符略微增加 token

  // 换行符也会占用 token
  const newlines = (text.match(/\n/g) || []).length;
  tokens += newlines * 0.5;

  return Math.ceil(tokens);
}

/**
 * 估算消息 token 数
 */
export function estimateMessageTokens(message: Message): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content) + 10; // 额外的消息开销
  }

  let total = 10; // 消息开销

  for (const block of message.content) {
    if (block.type === 'text') {
      total += estimateTokens(block.text || '');
    } else if (block.type === 'tool_use') {
      total += estimateTokens(block.name || '') + estimateTokens(JSON.stringify(block.input));
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
      total += estimateTokens(content);
    } else if (block.type === 'image') {
      // 图片按固定大小估算
      total += 1000;
    }
  }

  return total;
}

/**
 * 估算消息数组的总 token 数
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * 检测代码块
 */
function extractCodeBlocks(text: string): Array<{ code: string; language?: string; start: number; end: number }> {
  const blocks: Array<{ code: string; language?: string; start: number; end: number }> = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1],
      code: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return blocks;
}

/**
 * 压缩代码块（保留关键部分）
 */
function compressCodeBlock(code: string, maxLines: number = CODE_BLOCK_MAX_LINES): string {
  const lines = code.split('\n');

  if (lines.length <= maxLines) {
    return code;
  }

  // 保留开头和结尾
  const keepHead = Math.floor(maxLines * 0.6);
  const keepTail = Math.floor(maxLines * 0.4);

  const head = lines.slice(0, keepHead).join('\n');
  const tail = lines.slice(-keepTail).join('\n');
  const omitted = lines.length - maxLines;

  return `${head}\n\n... [${omitted} lines omitted] ...\n\n${tail}`;
}

/**
 * 压缩工具输出
 */
function compressToolOutput(content: string, maxChars: number = TOOL_OUTPUT_MAX_CHARS): string {
  if (content.length <= maxChars) {
    return content;
  }

  // 检测是否包含代码块
  const codeBlocks = extractCodeBlocks(content);

  if (codeBlocks.length > 0) {
    // 如果有代码块，优先保留代码
    let result = content;

    for (const block of codeBlocks) {
      const compressed = compressCodeBlock(block.code);
      const marker = block.language ? `\`\`\`${block.language}` : '```';
      result = result.replace(
        `${marker}\n${block.code}\`\`\``,
        `${marker}\n${compressed}\`\`\``
      );
    }

    if (result.length <= maxChars) {
      return result;
    }
  }

  // 检测是否是文件内容
  if (content.includes('→') || /^\s*\d+\s*[│|]/.test(content)) {
    // 看起来是文件列表或文件内容，保留头尾
    const lines = content.split('\n');
    const keepHead = 20;
    const keepTail = 10;

    if (lines.length > keepHead + keepTail) {
      const head = lines.slice(0, keepHead).join('\n');
      const tail = lines.slice(-keepTail).join('\n');
      const omitted = lines.length - keepHead - keepTail;
      return `${head}\n... [${omitted} lines omitted] ...\n${tail}`;
    }
  }

  // 默认：简单截断
  const keepHead = Math.floor(maxChars * 0.7);
  const keepTail = Math.floor(maxChars * 0.3);
  const head = content.slice(0, keepHead);
  const tail = content.slice(-keepTail);
  const omitted = content.length - maxChars;

  return `${head}\n\n... [~${omitted} chars omitted] ...\n\n${tail}`;
}

/**
 * 检测文件路径引用
 */
function extractFileReferences(text: string): string[] {
  // 匹配绝对路径（Unix 和 Windows）
  // Unix: /path/to/file.ext
  // Windows: C:\path\to\file.ext 或 C:/path/to/file.ext
  const pathRegex = /(?:(?:\/[\w\-_.]+)+\.\w+|[A-Za-z]:[\\/](?:[\w\-_.]+[\\/])*[\w\-_.]+\.\w+)/g;
  const matches = text.match(pathRegex);

  if (!matches) {
    return [];
  }

  // 去重
  const seen = new Set<string>();
  const refs: string[] = [];

  for (const match of matches) {
    if (!seen.has(match)) {
      seen.add(match);
      refs.push(match);
    }
  }

  return refs;
}

/**
 * 提取消息的核心内容用于摘要
 */
function extractMessageCore(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  const parts: string[] = [];

  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push(block.text || '');
    } else if (block.type === 'tool_use') {
      const inputStr = JSON.stringify(block.input, null, 2);
      parts.push(`[Tool: ${block.name || 'unknown'}]\nInput: ${inputStr.slice(0, 200)}`);
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);

      // 智能压缩工具输出
      const compressed = compressToolOutput(content, 300);
      parts.push(`[Result: ${block.tool_use_id || 'unknown'}]\n${compressed}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 创建对话摘要（简单版本，不使用 AI）
 */
export function createSummary(turns: ConversationTurn[]): string {
  const summaryParts: string[] = ['=== Previous Conversation Summary ===\n'];

  for (const turn of turns) {
    const userContent = extractMessageCore(turn.user);
    const assistantContent = extractMessageCore(turn.assistant);

    // 提取关键信息
    const userSummary = userContent.slice(0, 300);
    const assistantSummary = assistantContent.slice(0, 400);

    // 提取文件引用
    const fileRefs = [
      ...extractFileReferences(userContent),
      ...extractFileReferences(assistantContent),
    ];

    const timestamp = new Date(turn.timestamp).toLocaleTimeString();

    summaryParts.push(`[${timestamp}]`);
    summaryParts.push(`User: ${userSummary}${userContent.length > 300 ? '...' : ''}`);
    summaryParts.push(`Assistant: ${assistantSummary}${assistantContent.length > 400 ? '...' : ''}`);

    if (fileRefs.length > 0) {
      summaryParts.push(`Files: ${fileRefs.slice(0, 5).join(', ')}`);
    }

    summaryParts.push(''); // 空行分隔
  }

  summaryParts.push('=== End of Summary ===\n');

  return summaryParts.join('\n');
}

/**
 * 使用 AI 生成智能摘要（需要 API 客户端）
 */
export async function createAISummary(
  turns: ConversationTurn[],
  apiClient?: any
): Promise<string> {
  if (!apiClient) {
    return createSummary(turns);
  }

  try {
    // 构建摘要请求
    const conversationText = turns.map((turn) => {
      const user = extractMessageCore(turn.user);
      const assistant = extractMessageCore(turn.assistant);
      return `User: ${user}\n\nAssistant: ${assistant}`;
    }).join('\n\n---\n\n');

    // 调用 API 生成摘要
    const response = await apiClient.createMessage(
      [{
        role: 'user',
        content: `Please create a concise summary of the following conversation, preserving key information, decisions made, and important code/file references. Focus on what matters for future context:\n\n${conversationText}\n\nProvide a structured summary in 3-5 bullet points.`,
      }],
      undefined,
      'You are a helpful assistant that creates concise conversation summaries.'
    );

    // 提取文本内容
    const summaryText = response.content
      .filter((block: ContentBlock) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return `=== AI-Generated Summary ===\n\n${summaryText}\n\n=== End of Summary ===`;
  } catch (error) {
    console.warn('Failed to generate AI summary, falling back to simple summary:', error);
    return createSummary(turns);
  }
}

/**
 * 压缩消息内容（应用于单个消息）
 */
export function compressMessage(message: Message, config?: ContextConfig): Message {
  if (typeof message.content === 'string') {
    // 简单字符串内容，直接压缩
    const maxChars = config?.toolOutputMaxChars || TOOL_OUTPUT_MAX_CHARS;
    if (message.content.length > maxChars) {
      return {
        ...message,
        content: compressToolOutput(message.content, maxChars),
      };
    }
    return message;
  }

  // 压缩数组内容中的每个块
  const compressedBlocks: AnyContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);

      const maxChars = config?.toolOutputMaxChars || TOOL_OUTPUT_MAX_CHARS;

      if (content.length > maxChars) {
        const compressed = compressToolOutput(content, maxChars);
        compressedBlocks.push({
          ...block,
          content: compressed,
        });
      } else {
        compressedBlocks.push(block);
      }
    } else if (block.type === 'text') {
      // 压缩文本块中的代码
      const text = block.text || '';
      const codeBlocks = extractCodeBlocks(text);

      if (codeBlocks.length > 0) {
        let compressed = text;
        const maxLines = config?.codeBlockMaxLines || CODE_BLOCK_MAX_LINES;

        for (const cb of codeBlocks) {
          const compressedCode = compressCodeBlock(cb.code, maxLines);
          const marker = cb.language ? `\`\`\`${cb.language}` : '```';
          compressed = compressed.replace(
            `${marker}\n${cb.code}\`\`\``,
            `${marker}\n${compressedCode}\`\`\``
          );
        }

        compressedBlocks.push({
          ...block,
          text: compressed,
        });
      } else {
        compressedBlocks.push(block);
      }
    } else {
      compressedBlocks.push(block);
    }
  }

  return {
    ...message,
    content: compressedBlocks,
  };
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private config: Required<ContextConfig>;
  private turns: ConversationTurn[] = [];
  private systemPrompt: string = '';
  private compressionCount: number = 0;
  private savedTokens: number = 0;
  private apiClient?: any; // 用于 AI 摘要的 API 客户端

  constructor(config: ContextConfig = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? MAX_CONTEXT_TOKENS,
      reserveTokens: config.reserveTokens ?? RESERVE_TOKENS,
      summarizeThreshold: config.summarizeThreshold ?? 0.7, // 70% 时开始摘要
      keepRecentMessages: config.keepRecentMessages ?? 10,
      enableAISummary: config.enableAISummary ?? false,
      codeBlockMaxLines: config.codeBlockMaxLines ?? CODE_BLOCK_MAX_LINES,
      toolOutputMaxChars: config.toolOutputMaxChars ?? TOOL_OUTPUT_MAX_CHARS,
      enableIncrementalCompression: config.enableIncrementalCompression ?? true,
    };
  }

  /**
   * 设置 API 客户端（用于 AI 摘要）
   */
  setApiClient(client: any): void {
    this.apiClient = client;
  }

  /**
   * 设置系统提示
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 添加对话轮次（支持真实 API usage）
   */
  addTurn(user: Message, assistant: Message, apiUsage?: TokenUsage): void {
    const originalUserTokens = estimateMessageTokens(user);
    const originalAssistantTokens = estimateMessageTokens(assistant);
    const originalTokens = originalUserTokens + originalAssistantTokens;

    // 应用增量压缩（如果启用）
    let processedUser = user;
    let processedAssistant = assistant;
    let compressed = false;

    if (this.config.enableIncrementalCompression) {
      processedUser = compressMessage(user, this.config);
      processedAssistant = compressMessage(assistant, this.config);

      const compressedUserTokens = estimateMessageTokens(processedUser);
      const compressedAssistantTokens = estimateMessageTokens(processedAssistant);
      const compressedTokens = compressedUserTokens + compressedAssistantTokens;

      if (compressedTokens < originalTokens) {
        compressed = true;
        this.savedTokens += originalTokens - compressedTokens;
      }
    }

    const tokenEstimate = estimateMessageTokens(processedUser) + estimateMessageTokens(processedAssistant);

    this.turns.push({
      user: processedUser,
      assistant: processedAssistant,
      timestamp: Date.now(),
      tokenEstimate,
      originalTokens,
      compressed,
      apiUsage, // ✅ 保存真实 API usage
    });

    // 检查是否需要摘要压缩
    this.maybeCompress();
  }

  /**
   * 获取当前上下文的消息
   */
  getMessages(): Message[] {
    const messages: Message[] = [];

    // 添加摘要消息（如果有）
    const summarizedTurns = this.turns.filter((t) => t.summarized);
    if (summarizedTurns.length > 0) {
      const summary = createSummary(summarizedTurns);
      messages.push({
        role: 'user',
        content: summary,
      });
      messages.push({
        role: 'assistant',
        content: 'I understand. I\'ll keep this context in mind.',
      });
    }

    // 添加非摘要的消息
    const recentTurns = this.turns.filter((t) => !t.summarized);
    for (const turn of recentTurns) {
      messages.push(turn.user);
      messages.push(turn.assistant);
    }

    return messages;
  }

  /**
   * 获取可用的 token 数
   */
  getAvailableTokens(): number {
    const used = this.getUsedTokens();
    return this.config.maxTokens - this.config.reserveTokens - used;
  }

  /**
   * 获取已使用的 token 数（优先使用真实 API usage）
   */
  getUsedTokens(): number {
    let total = estimateTokens(this.systemPrompt);

    for (const turn of this.turns) {
      if (turn.summarized && turn.summary) {
        // 已摘要的消息使用摘要 tokens
        total += estimateTokens(turn.summary);
      } else if (turn.apiUsage) {
        // ✅ 优先使用真实 API tokens
        total +=
          turn.apiUsage.inputTokens +
          (turn.apiUsage.cacheCreationTokens ?? 0) +
          (turn.apiUsage.cacheReadTokens ?? 0) +
          turn.apiUsage.outputTokens +
          (turn.apiUsage.thinkingTokens ?? 0);
      } else {
        // 后备估算
        total += turn.tokenEstimate;
      }
    }

    return total;
  }

  /**
   * 检查并执行压缩
   */
  private async maybeCompress(): Promise<void> {
    const threshold = this.config.maxTokens * this.config.summarizeThreshold;
    const used = this.getUsedTokens();

    if (used < threshold) {
      return;
    }

    // 标记旧消息为需要摘要
    const recentCount = this.config.keepRecentMessages;
    const toSummarize = this.turns.slice(0, -recentCount);

    if (toSummarize.length === 0) {
      return;
    }

    const beforeTokens = toSummarize.reduce((sum, t) => sum + t.tokenEstimate, 0);

    // 生成摘要
    let summary: string;
    if (this.config.enableAISummary && this.apiClient) {
      try {
        summary = await createAISummary(toSummarize, this.apiClient);
      } catch (error) {
        console.warn('AI summary failed, using simple summary:', error);
        summary = createSummary(toSummarize);
      }
    } else {
      summary = createSummary(toSummarize);
    }

    // 标记为已摘要
    for (const turn of toSummarize) {
      if (!turn.summarized) {
        turn.summarized = true;
        turn.summary = summary;
      }
    }

    const afterTokens = estimateTokens(summary);
    this.savedTokens += beforeTokens - afterTokens;
    this.compressionCount++;
  }

  /**
   * 强制压缩
   */
  async compact(): Promise<void> {
    const recentCount = this.config.keepRecentMessages;

    if (this.turns.length <= recentCount) {
      return;
    }

    const toSummarize = this.turns.slice(0, -recentCount);

    if (toSummarize.length === 0) {
      return;
    }

    const beforeTokens = toSummarize.reduce((sum, t) => sum + t.tokenEstimate, 0);

    // 生成摘要
    let summary: string;
    if (this.config.enableAISummary && this.apiClient) {
      try {
        summary = await createAISummary(toSummarize, this.apiClient);
      } catch (error) {
        console.warn('AI summary failed, using simple summary:', error);
        summary = createSummary(toSummarize);
      }
    } else {
      summary = createSummary(toSummarize);
    }

    for (const turn of toSummarize) {
      if (!turn.summarized) {
        turn.summarized = true;
        turn.summary = summary;
      }
    }

    const afterTokens = estimateTokens(summary);
    this.savedTokens += beforeTokens - afterTokens;
    this.compressionCount++;
  }

  /**
   * v2.1.32: Summarize from here - 从指定消息开始的部分对话摘要
   * 对齐官方 "Summarize from here" 功能
   *
   * @param fromMessage 起始消息（之前的消息将被摘要）
   * @param additionalContext 可选的额外上下文
   */
  async summarizeFromHere(fromMessage: Message, additionalContext?: string): Promise<{
    preCompactTokenCount: number;
    postCompactTokenCount: number;
    messagesKept: number;
    messagesSummarized: number;
  }> {
    // 找到消息在 turns 中的位置
    let splitIndex = -1;
    for (let i = 0; i < this.turns.length; i++) {
      const turn = this.turns[i];
      if (turn.user === fromMessage || turn.assistant === fromMessage) {
        splitIndex = i;
        break;
      }
    }

    if (splitIndex <= 0) {
      // 如果没找到或在开头，对所有历史进行摘要
      splitIndex = Math.max(1, this.turns.length - (this.config.keepRecentMessages || 5));
    }

    const toSummarize = this.turns.slice(0, splitIndex);
    const toKeep = this.turns.slice(splitIndex);

    if (toSummarize.length === 0) {
      return {
        preCompactTokenCount: this.getUsedTokens(),
        postCompactTokenCount: this.getUsedTokens(),
        messagesKept: toKeep.length,
        messagesSummarized: 0,
      };
    }

    const preCompactTokenCount = this.getUsedTokens();

    // 生成摘要
    let summary: string;
    const contextSuffix = additionalContext ? `\n\nAdditional context: ${additionalContext}` : '';

    if (this.config.enableAISummary && this.apiClient) {
      try {
        summary = await createAISummary(toSummarize, this.apiClient) + contextSuffix;
      } catch {
        summary = createSummary(toSummarize) + contextSuffix;
      }
    } else {
      summary = createSummary(toSummarize) + contextSuffix;
    }

    // 标记已摘要的 turns
    for (const turn of toSummarize) {
      turn.summarized = true;
      turn.summary = summary;
    }

    const postCompactTokenCount = this.getUsedTokens();

    this.savedTokens += preCompactTokenCount - postCompactTokenCount;
    this.compressionCount++;

    return {
      preCompactTokenCount,
      postCompactTokenCount,
      messagesKept: toKeep.length,
      messagesSummarized: toSummarize.length,
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): ContextStats {
    const summarized = this.turns.filter((t) => t.summarized).length;

    const originalTokens = this.turns.reduce((sum, t) => sum + t.originalTokens, 0);
    const currentTokens = this.getUsedTokens();

    return {
      totalMessages: this.turns.length * 2, // user + assistant
      estimatedTokens: currentTokens,
      summarizedMessages: summarized * 2,
      compressionRatio: originalTokens > 0 ? currentTokens / originalTokens : 1,
      savedTokens: this.savedTokens,
      compressionCount: this.compressionCount,
    };
  }

  /**
   * 获取压缩详情
   */
  getCompressionDetails(): {
    totalTurns: number;
    summarizedTurns: number;
    compressedTurns: number;
    recentTurns: number;
    compressionRatio: number;
    savedTokens: number;
  } {
    const summarized = this.turns.filter((t) => t.summarized).length;
    const compressed = this.turns.filter((t) => t.compressed).length;
    const recent = Math.min(this.config.keepRecentMessages, this.turns.length);

    const originalTokens = this.turns.reduce((sum, t) => sum + t.originalTokens, 0);
    const currentTokens = this.getUsedTokens();

    return {
      totalTurns: this.turns.length,
      summarizedTurns: summarized,
      compressedTurns: compressed,
      recentTurns: recent,
      compressionRatio: originalTokens > 0 ? currentTokens / originalTokens : 1,
      savedTokens: this.savedTokens,
    };
  }

  /**
   * 清除所有历史
   */
  clear(): void {
    this.turns = [];
    this.compressionCount = 0;
    this.savedTokens = 0;
  }

  /**
   * 导出为可序列化格式
   */
  export(): {
    systemPrompt: string;
    turns: ConversationTurn[];
    config: Required<ContextConfig>;
    compressionCount: number;
    savedTokens: number;
  } {
    return {
      systemPrompt: this.systemPrompt,
      turns: this.turns,
      config: this.config,
      compressionCount: this.compressionCount,
      savedTokens: this.savedTokens,
    };
  }

  /**
   * 从导出数据恢复
   */
  import(data: {
    systemPrompt: string;
    turns: ConversationTurn[];
    config?: ContextConfig;
    compressionCount?: number;
    savedTokens?: number;
  }): void {
    this.systemPrompt = data.systemPrompt;
    this.turns = data.turns;
    this.compressionCount = data.compressionCount ?? 0;
    this.savedTokens = data.savedTokens ?? 0;

    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }
  }

  /**
   * 分析压缩效果
   */
  analyzeCompression(): CompressionResult {
    const originalTokens = this.turns.reduce((sum, t) => sum + t.originalTokens, 0);
    const compressedTokens = this.getUsedTokens();

    return {
      originalTokens,
      compressedTokens,
      ratio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
      method: this.config.enableAISummary ? 'ai_summary' : 'simple_summary',
    };
  }

  /**
   * 获取上下文使用率
   */
  getContextUsage(): {
    used: number;
    available: number;
    total: number;
    percentage: number;
  } {
    const used = this.getUsedTokens();
    const total = this.config.maxTokens - this.config.reserveTokens;
    const available = total - used;

    return {
      used,
      available,
      total,
      percentage: (used / total) * 100,
    };
  }

  /**
   * 检查是否接近上下文限制
   */
  isNearLimit(): boolean {
    const usage = this.getContextUsage();
    return usage.percentage >= this.config.summarizeThreshold * 100;
  }

  /**
   * 获取格式化的统计报告
   */
  getFormattedReport(): string {
    const stats = this.getStats();
    const details = this.getCompressionDetails();
    const usage = this.getContextUsage();

    const lines = [
      '=== Context Manager Report ===',
      '',
      `Total Messages: ${stats.totalMessages}`,
      `Estimated Tokens: ${stats.estimatedTokens.toLocaleString()}`,
      `Context Usage: ${usage.percentage.toFixed(1)}% (${usage.used.toLocaleString()}/${usage.total.toLocaleString()})`,
      '',
      `Compression:`,
      `  - Summarized Turns: ${details.summarizedTurns}`,
      `  - Compressed Turns: ${details.compressedTurns}`,
      `  - Compression Ratio: ${(details.compressionRatio * 100).toFixed(1)}%`,
      `  - Saved Tokens: ${details.savedTokens.toLocaleString()}`,
      `  - Compression Count: ${stats.compressionCount}`,
      '',
      `Configuration:`,
      `  - Keep Recent Messages: ${this.config.keepRecentMessages}`,
      `  - Summarize Threshold: ${(this.config.summarizeThreshold * 100).toFixed(0)}%`,
      `  - AI Summary: ${this.config.enableAISummary ? 'Enabled' : 'Disabled'}`,
      `  - Incremental Compression: ${this.config.enableIncrementalCompression ? 'Enabled' : 'Disabled'}`,
      '',
      '==============================',
    ];

    return lines.join('\n');
  }
}

/**
 * 智能裁剪消息数组以适应 token 限制
 */
export function truncateMessages(
  messages: Message[],
  maxTokens: number,
  keepFirst: number = 2,
  keepLast: number = 10
): Message[] {
  let totalTokens = estimateTotalTokens(messages);

  if (totalTokens <= maxTokens) {
    return messages;
  }

  // 保护首尾消息
  const firstMessages = messages.slice(0, keepFirst);
  const lastMessages = messages.slice(-keepLast);
  const middleMessages = messages.slice(keepFirst, -keepLast);

  // 逐步移除中间消息
  const result = [...firstMessages];
  let currentTokens = estimateTotalTokens(firstMessages) + estimateTotalTokens(lastMessages);

  for (const msg of middleMessages) {
    const msgTokens = estimateMessageTokens(msg);
    if (currentTokens + msgTokens <= maxTokens) {
      result.push(msg);
      currentTokens += msgTokens;
    }
  }

  result.push(...lastMessages);
  return result;
}

/**
 * 智能压缩消息数组
 */
export function compressMessages(
  messages: Message[],
  config?: ContextConfig
): Message[] {
  return messages.map((msg) => compressMessage(msg, config));
}

/**
 * 裁剪单条消息的内容
 */
export function truncateMessageContent(
  message: Message,
  maxTokens: number
): Message {
  if (typeof message.content === 'string') {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (message.content.length <= maxChars) {
      return message;
    }
    return {
      ...message,
      content: message.content.slice(0, maxChars) + '\n[Content truncated...]',
    };
  }

  // 对于数组内容，裁剪每个块
  const truncatedBlocks: AnyContentBlock[] = [];
  let remainingTokens = maxTokens;

  for (const block of message.content) {
    if (remainingTokens <= 0) {
      break;
    }

    if (block.type === 'text') {
      const maxChars = remainingTokens * CHARS_PER_TOKEN;
      const blockText = block.text || '';
      if (blockText.length <= maxChars) {
        truncatedBlocks.push(block);
        remainingTokens -= estimateTokens(blockText);
      } else {
        truncatedBlocks.push({
          type: 'text',
          text: blockText.slice(0, maxChars) + '\n[Content truncated...]',
        });
        remainingTokens = 0;
      }
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
      const maxChars = remainingTokens * CHARS_PER_TOKEN;

      if (content.length <= maxChars) {
        truncatedBlocks.push(block);
        remainingTokens -= estimateTokens(content);
      } else {
        truncatedBlocks.push({
          ...block,
          content: content.slice(0, maxChars) + '\n[Output truncated...]',
        });
        remainingTokens = 0;
      }
    } else {
      // 保留其他类型的块
      truncatedBlocks.push(block);
      remainingTokens -= 100; // 估算
    }
  }

  return {
    ...message,
    content: truncatedBlocks,
  };
}

/**
 * 批量压缩工具输出
 */
export function batchCompressToolResults(
  messages: Message[],
  maxChars: number = TOOL_OUTPUT_MAX_CHARS
): Message[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return msg;
    }

    const compressedBlocks = msg.content.map((block) => {
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);

        if (content.length > maxChars) {
          return {
            ...block,
            content: compressToolOutput(content, maxChars),
          };
        }
      }
      return block;
    });

    return {
      ...msg,
      content: compressedBlocks,
    };
  });
}

/**
 * 计算消息数组的压缩比
 */
export function calculateCompressionRatio(
  originalMessages: Message[],
  compressedMessages: Message[]
): number {
  const originalTokens = estimateTotalTokens(originalMessages);
  const compressedTokens = estimateTotalTokens(compressedMessages);

  return originalTokens > 0 ? compressedTokens / originalTokens : 1;
}

/**
 * 优化上下文窗口（综合压缩策略）
 */
export function optimizeContext(
  messages: Message[],
  maxTokens: number,
  config?: ContextConfig
): {
  messages: Message[];
  compressionRatio: number;
  savedTokens: number;
} {
  const originalTokens = estimateTotalTokens(messages);

  if (originalTokens <= maxTokens) {
    return {
      messages,
      compressionRatio: 1,
      savedTokens: 0,
    };
  }

  // 步骤 1: 压缩工具输出
  let optimized = compressMessages(messages, config);
  let currentTokens = estimateTotalTokens(optimized);

  // 步骤 2: 如果仍然超限，裁剪消息
  if (currentTokens > maxTokens) {
    optimized = truncateMessages(optimized, maxTokens);
    currentTokens = estimateTotalTokens(optimized);
  }

  return {
    messages: optimized,
    compressionRatio: currentTokens / originalTokens,
    savedTokens: originalTokens - currentTokens,
  };
}

/**
 * 提取上下文关键信息
 */
export function extractContextKeyInfo(messages: Message[]): {
  files: string[];
  tools: string[];
  keywords: string[];
} {
  const files = new Set<string>();
  const tools = new Set<string>();
  const keywords = new Set<string>();

  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map((block) => {
          if (block.type === 'text') return block.text || '';
          if (block.type === 'tool_use') {
            tools.add(block.name || 'unknown');
            return JSON.stringify(block.input);
          }
          if (block.type === 'tool_result') {
            return typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          }
          return '';
        }).join(' ');

    // 提取文件路径
    const fileRefs = extractFileReferences(content);
    fileRefs.forEach((f) => files.add(f));

    // 提取关键词（简单实现）
    const words = content
      .split(/\s+/)
      .filter((w) => w.length > 5 && /^[a-zA-Z]/.test(w))
      .slice(0, 20);
    words.forEach((w) => keywords.add(w));
  }

  return {
    files: Array.from(files),
    tools: Array.from(tools),
    keywords: Array.from(keywords),
  };
}

// 默认实例
export const contextManager = new ContextManager();

// ============ 导出增强功能 ============
export * from './enhanced.js';

// ============ 导出新增模块 ============
export * from './summarizer.js';
export * from './window.js';
export * from './session-memory.js';
