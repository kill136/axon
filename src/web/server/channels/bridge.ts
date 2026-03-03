/**
 * IM ↔ ConversationManager 桥接层
 *
 * 核心职责：
 * 1. 将 IM 入站消息转为 ConversationManager.chat() 调用
 * 2. 将 AI 的流式回复累积后发回 IM
 * 3. 管理 IM 用户到会话的映射
 *
 * 设计原则：不修改 ConversationManager，完全通过公共 API 交互。
 */

import type { ConversationManager, StreamCallbacks } from '../conversation.js';
import type { ChannelAdapter, InboundMessage, ChannelServerMessage } from './types.js';

// ============================================================================
// 回复累积器
// ============================================================================

/**
 * 回复缓冲区：累积 AI 的流式输出，避免逐 token 发送到 IM（触发限流）
 */
interface ReplyBuffer {
  text: string;
  /** flush 定时器（防止消息堆积太久不发） */
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/** 自动 flush 间隔（毫秒）。太短触发 IM 限流，太长用户等太久 */
const AUTO_FLUSH_INTERVAL = 3000;

/** IM 平台通常的单条消息长度限制 */
const MAX_MESSAGE_LENGTH: Record<string, number> = {
  telegram: 4096,
  feishu: 30000,
  'slack-bot': 40000,
};

const DEFAULT_MAX_LENGTH = 4096;

// ============================================================================
// IMBridge
// ============================================================================

export class IMBridge {
  private replyBuffers = new Map<string, ReplyBuffer>();
  /** 正在处理的会话（防止并发） */
  private processing = new Set<string>();

  constructor(
    private conversationManager: ConversationManager,
    private getAdapter: (channelId: string) => ChannelAdapter | undefined,
    private broadcast?: (msg: ChannelServerMessage) => void,
    private defaultModel: string = 'sonnet',
    private cwd: string = process.cwd(),
  ) {}

  /**
   * 处理来自 IM 的入站消息
   */
  async handleInboundMessage(msg: InboundMessage): Promise<void> {
    const sessionId = this.buildSessionId(msg.channel, msg.chatId);

    // 广播 IM 消息到 Web UI（可选，用于实时监控）
    this.broadcast?.({
      type: 'channel:message',
      payload: {
        channel: msg.channel,
        direction: 'inbound',
        senderName: msg.senderName,
        text: msg.text.length > 200 ? msg.text.slice(0, 200) + '...' : msg.text,
        timestamp: msg.timestamp,
      },
    });

    // 如果该会话正在处理，排队等待（简单互斥）
    if (this.processing.has(sessionId)) {
      const adapter = this.getAdapter(msg.channel);
      if (adapter) {
        await adapter.sendText(msg.chatId, '⏳ 上一条消息还在处理中，请稍候...');
      }
      return;
    }

    this.processing.add(sessionId);

    try {
      await this.processMessage(msg, sessionId);
    } catch (error) {
      console.error(`[IMBridge] Error processing message from ${msg.channel}:${msg.chatId}:`, error);
      const adapter = this.getAdapter(msg.channel);
      if (adapter) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await adapter.sendText(msg.chatId, `❌ Error: ${errMsg}`).catch(() => {});
      }
    } finally {
      this.processing.delete(sessionId);
    }
  }

  /**
   * 实际处理消息
   */
  private async processMessage(msg: InboundMessage, sessionId: string): Promise<void> {
    const adapter = this.getAdapter(msg.channel);
    if (!adapter) {
      console.error(`[IMBridge] No adapter for channel: ${msg.channel}`);
      return;
    }

    // 初始化回复缓冲区
    this.initBuffer(sessionId);

    // 工具使用状态追踪
    let currentToolName = '';
    let toolNotified = false;

    // 构建 StreamCallbacks —— 关键：回复发到 IM 而不是 WebSocket
    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        this.appendToBuffer(sessionId, text);
      },

      onToolUseStart: (_toolUseId: string, toolName: string, _input: unknown) => {
        currentToolName = toolName;
        toolNotified = false;
      },

      onToolResult: (_toolUseId: string, success: boolean, _output?: string, error?: string) => {
        // 工具执行完成，发一个简短的状态通知
        if (!toolNotified && currentToolName) {
          const status = success ? '✓' : `✗ ${error?.slice(0, 100) || 'failed'}`;
          this.appendToBuffer(sessionId, `\n[${currentToolName}: ${status}]\n`);
          toolNotified = true;
        }
      },

      onComplete: async (_stopReason: string | null, _usage?: { inputTokens: number; outputTokens: number }) => {
        // 对话完成，flush 所有累积的文本
        const fullText = this.flushBuffer(sessionId);
        if (fullText.trim()) {
          await this.sendToIM(adapter, msg.chatId, msg.channel, fullText, msg.messageId);
        }
      },

      onError: async (error: Error) => {
        this.clearBuffer(sessionId);
        await adapter.sendText(msg.chatId, `❌ ${error.message}`).catch(() => {});
      },
    };

    // 构建图片附件（如果有）
    const mediaAttachments = msg.images?.map(img => ({
      data: img.data,
      mimeType: img.mimeType,
      type: 'image' as const,
    }));

    // 获取通道特定模型或使用默认
    const model = this.defaultModel;

    // 调用 ConversationManager.chat() —— 完全复用现有的 AI 能力
    await this.conversationManager.chat(
      sessionId,
      msg.text,
      mediaAttachments?.length ? mediaAttachments : undefined,
      model,
      callbacks,
      this.cwd,    // projectPath
      undefined,    // ws - IM 通道不需要 WebSocket
      undefined,    // permissionMode - 使用默认
    );
  }

  // ==========================================================================
  // 缓冲区管理
  // ==========================================================================

  private initBuffer(sessionId: string): void {
    this.clearBuffer(sessionId);
    this.replyBuffers.set(sessionId, { text: '', flushTimer: null });
  }

  private appendToBuffer(sessionId: string, text: string): void {
    const buffer = this.replyBuffers.get(sessionId);
    if (!buffer) return;
    buffer.text += text;

    // 设置自动 flush 定时器（如果还没有）
    if (!buffer.flushTimer) {
      buffer.flushTimer = setTimeout(() => {
        buffer.flushTimer = null;
        // 定时器到了但对话还在进行，暂不 flush
        // flush 只在 onComplete 或缓冲区溢出时触发
      }, AUTO_FLUSH_INTERVAL);
    }
  }

  private flushBuffer(sessionId: string): string {
    const buffer = this.replyBuffers.get(sessionId);
    if (!buffer) return '';
    if (buffer.flushTimer) {
      clearTimeout(buffer.flushTimer);
      buffer.flushTimer = null;
    }
    const text = buffer.text;
    buffer.text = '';
    return text;
  }

  private clearBuffer(sessionId: string): void {
    const buffer = this.replyBuffers.get(sessionId);
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    this.replyBuffers.delete(sessionId);
  }

  // ==========================================================================
  // 消息发送
  // ==========================================================================

  /**
   * 将文本发送到 IM，自动分块处理超长消息
   */
  private async sendToIM(
    adapter: ChannelAdapter,
    chatId: string,
    channelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const maxLen = MAX_MESSAGE_LENGTH[channelId] || DEFAULT_MAX_LENGTH;
    const chunks = this.splitMessage(text, maxLen);

    for (let i = 0; i < chunks.length; i++) {
      try {
        await adapter.sendText(chatId, chunks[i], {
          replyToMessageId: i === 0 ? replyToMessageId : undefined,
          parseMode: 'Markdown',
        });
        // IM 平台限流保护：每条消息间隔 50ms
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (error) {
        console.error(`[IMBridge] Failed to send message chunk ${i + 1}/${chunks.length}:`, error);
        // 如果 Markdown 解析失败，降级为纯文本重试
        try {
          await adapter.sendText(chatId, chunks[i], { parseMode: 'plain' });
        } catch {
          // 放弃这个 chunk
        }
      }
    }

    // 广播到 Web UI
    this.broadcast?.({
      type: 'channel:message',
      payload: {
        channel: channelId,
        direction: 'outbound',
        senderName: 'AI',
        text: text.length > 200 ? text.slice(0, 200) + '...' : text,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * 分割超长消息，优先在换行符处断开
   */
  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      // 优先在换行符处断开
      let cutoff = remaining.lastIndexOf('\n', maxLen);
      if (cutoff < maxLen * 0.3) {
        // 换行符太靠前，在空格处断开
        cutoff = remaining.lastIndexOf(' ', maxLen);
      }
      if (cutoff < maxLen * 0.3) {
        // 都找不到好的断开点，硬切
        cutoff = maxLen;
      }

      chunks.push(remaining.slice(0, cutoff));
      remaining = remaining.slice(cutoff).trimStart();
    }

    return chunks;
  }

  // ==========================================================================
  // 会话 ID
  // ==========================================================================

  /**
   * 构建 IM 通道的会话 ID
   * 格式：im:{channel}:{chatId}
   * 确保与 Web UI 会话完全隔离
   */
  private buildSessionId(channel: string, chatId: string): string {
    return `im:${channel}:${chatId}`;
  }
}
