/**
 * IM ↔ ConversationManager 桥接层
 *
 * 核心职责：
 * 1. 将 IM 入站消息转为 ConversationManager.chat() 调用
 * 2. 将 AI 的流式回复实时推送到 IM（通过编辑消息实现流式效果）
 * 3. 管理 IM 用户到会话的映射
 *
 * 流式输出设计（参考 OpenClaw draft-stream-loop）：
 * - onTextDelta 累积文本到 buffer
 * - 智能节流：基于上次发送时间动态计算（非固定延迟）
 * - 首次 flush 发送新消息，后续 flush 编辑同一条消息
 * - onComplete 时最终 flush
 *
 * 设计原则：不修改 ConversationManager，完全通过公共 API 交互。
 */

import * as crypto from 'crypto';
import type { ConversationManager, StreamCallbacks } from '../conversation.js';
import type { ChannelAdapter, ChannelConfig, InboundMessage, ChannelServerMessage, PairingRequest, SendOptions } from './types.js';
import type { UploadedImageAttachment } from '../image-attachments.js';

// ============================================================================
// Draft Stream Loop（智能节流流式发送循环）
// ============================================================================

/**
 * 流式发送状态：管理一次 AI 回复过程中的消息编辑
 */
interface StreamState {
  /** 累积的完整文本（每次 flush 发送全部） */
  fullText: string;
  /** 已发送到 IM 的消息 ID（用于编辑） */
  sentMessageId: string | null;
  /** 上次发送的时间戳 */
  lastSentAt: number;
  /** 节流定时器 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 是否有正在飞行的请求（防并发编辑冲突） */
  inFlight: boolean;
  /** 飞行中请求完成后是否需要再次 flush */
  pendingFlush: boolean;
}

/** 流式编辑的节流间隔（毫秒）。Telegram/Slack 限流约 1 req/s */
const STREAM_THROTTLE_MS = 1500;

/** 首次发送前的等待时间（累积一些文本再发，避免只发一两个字） */
const FIRST_SEND_DELAY_MS = 800;

/** 流式预览的后缀标记（表示还在生成中） */
const STREAMING_INDICATOR = ' ▍';

// ============================================================================
// 消息格式转换（参考 OpenClaw src/telegram/format.ts, src/slack/format.ts）
// ============================================================================

/** IM 平台的单条消息长度限制 */
const MAX_MESSAGE_LENGTH: Record<string, number> = {
  telegram: 4096,
  feishu: 30000,
  'slack-bot': 4000,
  whatsapp: 4096,
  discord: 2000,
};

const DEFAULT_MAX_LENGTH = 4096;

/**
 * Markdown → 各 IM 平台原生格式转换
 * Telegram: HTML（比 Markdown 更稳定，不需要转义 _ * 等）
 * Feishu: Markdown（飞书原生支持）
 * Slack: mrkdwn（Slack 变体）
 */
function convertMarkdown(text: string, channelId: string): { text: string; parseMode: SendOptions['parseMode'] } {
  switch (channelId) {
    case 'telegram':
      return { text: markdownToTelegramHtml(text), parseMode: 'HTML' };

    case 'feishu':
      // 飞书直接支持标准 Markdown
      return { text, parseMode: 'Markdown' };

    case 'slack-bot':
      return { text: markdownToSlackMrkdwn(text), parseMode: 'plain' };

    case 'whatsapp':
      // WhatsApp 不支持 Markdown/HTML 格式，直接发纯文本
      return { text: stripMarkdown(text), parseMode: 'plain' };

    case 'discord':
      // Discord 原生支持 Markdown（与标准 Markdown 基本兼容）
      return { text, parseMode: 'Markdown' };

    default:
      return { text, parseMode: 'Markdown' };
  }
}

// ============================================================================
// Telegram: Markdown → HTML
// 参考 OpenClaw src/telegram/format.ts 的 renderTelegramHtml
// ============================================================================

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 简化的 Markdown → Telegram HTML 转换。
 * 使用正则逐步转换，保护代码块/行内代码不被二次处理。
 */
function markdownToTelegramHtml(md: string): string {
  let result = md;

  // 1. 保护代码块（```...```）
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code.replace(/\n$/, ''));
    codeBlocks.push(`<pre><code>${escaped}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 2. 保护行内代码（`...`）
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 3. 转义 HTML 特殊字符（在保护区域外）
  result = escapeHtml(result);

  // 4. Markdown 样式 → HTML 标签
  // **bold** / __bold__
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');
  // *italic* / _italic_（避免匹配已转换的 <b> 标签内的内容）
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>');
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>');
  // ~~strikethrough~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // > blockquote（行首）
  result = result.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // 5. 恢复行内代码
  result = result.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i)]);
  // 6. 恢复代码块
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  return result;
}

// ============================================================================
// Slack: Markdown → mrkdwn
// 参考 OpenClaw src/slack/format.ts 的 escapeSlackMrkdwnContent
// ============================================================================

/** Slack angle-bracket token 正则 */
const SLACK_ANGLE_TOKEN_RE = /<[^>\n]+>/g;

/** 检查是否是合法的 Slack angle-bracket token（mention/link 等） */
function isSlackAngleToken(token: string): boolean {
  const inner = token.slice(1, -1);
  return (
    inner.startsWith('@') ||
    inner.startsWith('#') ||
    inner.startsWith('!') ||
    inner.startsWith('http://') ||
    inner.startsWith('https://') ||
    inner.startsWith('mailto:')
  );
}

/** 转义 Slack mrkdwn 中的特殊字符，保护已有的 angle-bracket token */
function escapeSlackMrkdwn(text: string): string {
  if (!text.includes('&') && !text.includes('<') && !text.includes('>')) {
    return text;
  }
  SLACK_ANGLE_TOKEN_RE.lastIndex = 0;
  const out: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLACK_ANGLE_TOKEN_RE.exec(text)) !== null) {
    const seg = text.slice(lastIndex, match.index);
    out.push(seg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    out.push(isSlackAngleToken(match[0]) ? match[0] : match[0].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    lastIndex = match.index + match[0].length;
  }
  out.push(text.slice(lastIndex).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return out.join('');
}

/**
 * 标准 Markdown → Slack mrkdwn 转换
 */
function markdownToSlackMrkdwn(md: string): string {
  let result = md;

  // 保护代码块（Slack 也用 ``` 所以不转换内容）
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 保护行内代码
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (match) => {
    inlineCodes.push(match);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 转义特殊字符
  result = escapeSlackMrkdwn(result);

  // **bold** → *bold*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // __bold__ → *bold*
  result = result.replace(/__(.+?)__/g, '*$1*');
  // ~~strike~~ → ~strike~
  result = result.replace(/~~(.+?)~~/g, '~$1~');
  // [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  // # heading → *heading*（Slack 没有标题，用粗体代替）
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // > blockquote
  result = result.replace(/^&gt; (.+)$/gm, '> $1');

  // 恢复行内代码
  result = result.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i)]);
  // 恢复代码块
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  return result;
}

// ============================================================================
// WhatsApp: Markdown → 纯文本
// WhatsApp Cloud API 的文本消息不支持 Markdown/HTML，只能发纯文本
// ============================================================================

/**
 * 去掉 Markdown 格式标记，保留可读文本
 */
function stripMarkdown(md: string): string {
  let result = md;

  // 代码块：保留内容，去掉 ``` 标记
  result = result.replace(/```\w*\n?([\s\S]*?)```/g, '$1');
  // 行内代码：保留内容
  result = result.replace(/`([^`\n]+)`/g, '$1');
  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  // 斜体
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '$1');
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '$1');
  // 删除线
  result = result.replace(/~~(.+?)~~/g, '$1');
  // 链接 [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // 标题 # → 去掉 #
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '$1');
  // 引用 > → 去掉 >
  result = result.replace(/^> (.+)$/gm, '$1');

  return result;
}

// ============================================================================
// IMBridge
// ============================================================================

// ============================================================================
// Pairing 配对（参考 OpenClaw src/pairing/）
// ============================================================================

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 0OI1
const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 小时

function generatePairingCode(): string {
  const bytes = crypto.randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

// ============================================================================
// IMBridge
// ============================================================================

export class IMBridge {
  /** 流式发送状态（每个会话一个） */
  private streams = new Map<string, StreamState>();
  /** 正在处理的会话（防止并发） */
  private processing = new Set<string>();
  /** 消息去重缓存（messageId → timestamp） */
  private seenMessages = new Map<string, number>();
  /** 已知会话（用于检测新会话，触发 Web UI 自动切换） */
  private knownSessions = new Set<string>();
  /** 配对请求（code → PairingRequest） */
  private pairingRequests = new Map<string, PairingRequest>();
  /** 获取通道配置 */
  private getChannelConfig: (channelId: string) => ChannelConfig | undefined;
  /** 更新 allowList 回调 */
  private updateAllowList: (channelId: string, allowList: string[]) => Promise<void>;

  constructor(
    private conversationManager: ConversationManager,
    private getAdapter: (channelId: string) => ChannelAdapter | undefined,
    private broadcast?: (msg: ChannelServerMessage) => void,
    private defaultModel: string = 'sonnet',
    private cwd: string = process.cwd(),
    getChannelConfig?: (channelId: string) => ChannelConfig | undefined,
    updateAllowList?: (channelId: string, allowList: string[]) => Promise<void>,
  ) {
    this.getChannelConfig = getChannelConfig || (() => undefined);
    this.updateAllowList = updateAllowList || (async () => {});
    // 定期清理过期的去重缓存（5 分钟过期）和过期配对请求
    setInterval(() => {
      this.cleanSeenMessages();
      this.cleanExpiredPairings();
    }, 60_000);
  }

  /**
   * 处理来自 IM 的入站消息
   */
  async handleInboundMessage(msg: InboundMessage): Promise<void> {
    // 消息去重
    if (msg.messageId && this.seenMessages.has(msg.messageId)) {
      return;
    }
    if (msg.messageId) {
      this.seenMessages.set(msg.messageId, Date.now());
    }

    // ---- 权限检查 + Pairing ----
    const allowed = this.checkAccess(msg);
    if (!allowed) return;

    const sessionId = this.buildSessionId(msg.channel, msg.chatId);

    // 检测新会话：首条消息时广播，让 Web UI 自动切换到该会话
    if (!this.knownSessions.has(sessionId)) {
      this.knownSessions.add(sessionId);
      this.broadcast?.({
        type: 'channel:new_session',
        payload: { sessionId, channel: msg.channel, senderName: msg.senderName },
      });
    }

    // 广播 IM 消息到 Web UI
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
      this.cleanupStream(sessionId);
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

    // 初始化流式状态
    this.initStream(sessionId);

    // 是否支持编辑消息（流式输出）
    const supportsEdit = typeof adapter.editText === 'function';

    // 工具使用状态追踪
    let currentToolName = '';
    let toolNotified = false;

    // 构建 StreamCallbacks
    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        const stream = this.streams.get(sessionId);
        if (!stream) return;
        stream.fullText += text;

        // 如果支持编辑，启动流式预览
        if (supportsEdit) {
          this.scheduleStreamFlush(sessionId, adapter, msg.chatId, msg.channel, msg.messageId);
        }
      },

      onToolUseStart: (_toolUseId: string, toolName: string, _input: unknown) => {
        currentToolName = toolName;
        toolNotified = false;
      },

      onToolResult: (_toolUseId: string, success: boolean, _output?: string, error?: string) => {
        if (!toolNotified && currentToolName) {
          const stream = this.streams.get(sessionId);
          if (stream) {
            const status = success ? '✓' : `✗ ${error?.slice(0, 100) || 'failed'}`;
            stream.fullText += `\n[${currentToolName}: ${status}]\n`;
            toolNotified = true;

            if (supportsEdit) {
              this.scheduleStreamFlush(sessionId, adapter, msg.chatId, msg.channel, msg.messageId);
            }
          }
        }
      },

      onComplete: async (_stopReason: string | null, _usage?: { inputTokens: number; outputTokens: number }) => {
        const stream = this.streams.get(sessionId);
        if (!stream) return;

        // 取消节流定时器
        if (stream.timer) {
          clearTimeout(stream.timer);
          stream.timer = null;
        }

        // 等待飞行中的请求完成
        if (stream.inFlight) {
          // 标记需要最终 flush
          stream.pendingFlush = true;
          // 等一下让 inFlight 完成
          await new Promise(r => setTimeout(r, 200));
        }

        const finalText = stream.fullText.trim();
        if (!finalText) return;

        if (stream.sentMessageId && supportsEdit) {
          // 最终编辑：去掉流式指示器
          const { text: formatted, parseMode } = convertMarkdown(finalText, msg.channel);
          await adapter.editText!(msg.chatId, stream.sentMessageId, formatted, { parseMode }).catch(() => {});
        } else if (!stream.sentMessageId) {
          // 从未发送过（非流式模式或文本太少）
          await this.sendToIM(adapter, msg.chatId, msg.channel, finalText, msg.messageId);
        }

        // 广播到 Web UI
        this.broadcast?.({
          type: 'channel:message',
          payload: {
            channel: msg.channel,
            direction: 'outbound',
            senderName: 'AI',
            text: finalText.length > 200 ? finalText.slice(0, 200) + '...' : finalText,
            timestamp: Date.now(),
          },
        });
      },

      onError: async (error: Error) => {
        this.cleanupStream(sessionId);
        await adapter.sendText(msg.chatId, `❌ ${error.message}`).catch(() => {});
      },
    };

    // 构建图片附件
    const mediaAttachments: UploadedImageAttachment[] | undefined = msg.images?.map((img, index) => ({
      name: `channel-image-${index + 1}.${img.mimeType.split('/')[1] || 'png'}`,
      data: img.data,
      mimeType: img.mimeType,
      type: 'image' as const,
    }));

    const model = this.defaultModel;

    await this.conversationManager.chat(
      sessionId,
      msg.text,
      mediaAttachments?.length ? mediaAttachments : undefined,
      model,
      callbacks,
      this.cwd,
      undefined,
      undefined,
    );
  }

  // ==========================================================================
  // Draft Stream Loop（流式发送核心逻辑）
  // ==========================================================================

  private initStream(sessionId: string): void {
    this.cleanupStream(sessionId);
    this.streams.set(sessionId, {
      fullText: '',
      sentMessageId: null,
      lastSentAt: 0,
      timer: null,
      inFlight: false,
      pendingFlush: false,
    });
  }

  private cleanupStream(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (stream?.timer) {
      clearTimeout(stream.timer);
    }
    this.streams.delete(sessionId);
  }

  /**
   * 智能调度流式 flush
   * 参考 OpenClaw draft-stream-loop.ts 的设计：
   * - 如果距上次发送已过节流窗口 → 立即 flush
   * - 否则 → 设置延时定时器
   */
  private scheduleStreamFlush(
    sessionId: string,
    adapter: ChannelAdapter,
    chatId: string,
    channelId: string,
    replyToMessageId?: string,
  ): void {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.inFlight) return;

    const now = Date.now();

    // 首次发送：等一下累积一些文本
    if (!stream.sentMessageId && stream.lastSentAt === 0) {
      if (!stream.timer) {
        stream.timer = setTimeout(() => {
          stream.timer = null;
          this.doStreamFlush(sessionId, adapter, chatId, channelId, replyToMessageId);
        }, FIRST_SEND_DELAY_MS);
      }
      return;
    }

    const elapsed = now - stream.lastSentAt;

    if (elapsed >= STREAM_THROTTLE_MS) {
      // 已过节流窗口，立即 flush
      this.doStreamFlush(sessionId, adapter, chatId, channelId, replyToMessageId);
    } else if (!stream.timer) {
      // 设置延时定时器
      stream.timer = setTimeout(() => {
        stream.timer = null;
        this.doStreamFlush(sessionId, adapter, chatId, channelId, replyToMessageId);
      }, STREAM_THROTTLE_MS - elapsed);
    }
  }

  /**
   * 实际执行一次流式 flush：发送新消息或编辑已有消息
   */
  private async doStreamFlush(
    sessionId: string,
    adapter: ChannelAdapter,
    chatId: string,
    channelId: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.inFlight) {
      if (stream) stream.pendingFlush = true;
      return;
    }

    const text = stream.fullText.trim();
    if (!text) return;

    // 添加流式指示器
    const displayText = text + STREAMING_INDICATOR;
    const { text: formatted, parseMode } = convertMarkdown(displayText, channelId);

    stream.inFlight = true;

    try {
      if (stream.sentMessageId && adapter.editText) {
        // 编辑已有消息
        const success = await adapter.editText(chatId, stream.sentMessageId, formatted, { parseMode });
        if (!success) {
          // 编辑失败（消息可能被删除），发新消息
          stream.sentMessageId = null;
        }
      }

      if (!stream.sentMessageId) {
        // 发送新消息
        const msgId = await adapter.sendText(chatId, formatted, {
          replyToMessageId,
          parseMode,
        });
        if (msgId) {
          stream.sentMessageId = String(msgId);
        }
      }

      stream.lastSentAt = Date.now();
    } catch (error) {
      console.error(`[IMBridge] Stream flush error:`, error);
    } finally {
      stream.inFlight = false;

      // 如果 flush 期间有新的文本到达，再次调度
      if (stream.pendingFlush) {
        stream.pendingFlush = false;
        this.scheduleStreamFlush(sessionId, adapter, chatId, channelId, replyToMessageId);
      }
    }
  }

  // ==========================================================================
  // 消息发送（非流式模式）
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
    const { text: formatted, parseMode } = convertMarkdown(text, channelId);
    const maxLen = MAX_MESSAGE_LENGTH[channelId] || DEFAULT_MAX_LENGTH;
    const chunks = this.splitMessage(formatted, maxLen);

    for (let i = 0; i < chunks.length; i++) {
      try {
        await adapter.sendText(chatId, chunks[i], {
          replyToMessageId: i === 0 ? replyToMessageId : undefined,
          parseMode,
        });
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (error) {
        console.error(`[IMBridge] Failed to send message chunk ${i + 1}/${chunks.length}:`, error);
        try {
          await adapter.sendText(chatId, chunks[i], { parseMode: 'plain' });
        } catch {
          // 放弃这个 chunk
        }
      }
    }
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

      let cutoff = remaining.lastIndexOf('\n', maxLen);
      if (cutoff < maxLen * 0.3) {
        cutoff = remaining.lastIndexOf(' ', maxLen);
      }
      if (cutoff < maxLen * 0.3) {
        cutoff = maxLen;
      }

      chunks.push(remaining.slice(0, cutoff));
      remaining = remaining.slice(cutoff).trimStart();
    }

    return chunks;
  }

  // ==========================================================================
  // 消息去重
  // ==========================================================================

  private cleanSeenMessages(): void {
    const now = Date.now();
    const TTL = 5 * 60 * 1000; // 5 分钟
    for (const [id, ts] of this.seenMessages) {
      if (now - ts > TTL) {
        this.seenMessages.delete(id);
      }
    }
  }

  // ==========================================================================
  // Pairing 配对机制
  // ==========================================================================

  /**
   * 检查发送者是否有权访问。
   * 返回 true 表示允许，false 表示已拦截（已回复配对码或静默拒绝）。
   */
  private checkAccess(msg: InboundMessage): boolean {
    const config = this.getChannelConfig(msg.channel);
    if (!config) return true; // 没有配置，放行（适配器层已做基本白名单检查）

    const dmPolicy = config.dmPolicy || 'allowlist';

    // open 模式：任何人都能用
    if (dmPolicy === 'open') return true;

    const allowList = config.allowList || [];

    // 检查白名单
    if (allowList.includes('*')) return true;
    if (allowList.includes(msg.senderId)) return true;

    // pairing 模式：未授权用户 → 发配对码
    if (dmPolicy === 'pairing') {
      this.issuePairingChallenge(msg);
      return false;
    }

    // allowlist 模式：未授权 → 静默拒绝
    return false;
  }

  /**
   * 发放配对码给未授权用户
   */
  private async issuePairingChallenge(msg: InboundMessage): Promise<void> {
    // 检查是否已经有这个用户的配对请求
    for (const req of this.pairingRequests.values()) {
      if (req.channel === msg.channel && req.senderId === msg.senderId) {
        // 已有请求，更新最后活跃时间但不重复发配对码
        req.lastSeenAt = Date.now();
        return;
      }
    }

    const code = generatePairingCode();
    const request: PairingRequest = {
      senderId: msg.senderId,
      senderName: msg.senderName,
      channel: msg.channel,
      code,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    this.pairingRequests.set(code, request);

    // 通知管理员（Web UI）
    this.broadcast?.({
      type: 'channel:pairing_new',
      payload: request,
    });

    // 回复用户
    const adapter = this.getAdapter(msg.channel);
    if (adapter) {
      const replyText = [
        'Access not configured.',
        '',
        `Sender: ${msg.senderName} (${msg.senderId})`,
        `Pairing code: ${code}`,
        '',
        'Ask the bot owner to approve your access in the Axon Web UI.',
      ].join('\n');

      await adapter.sendText(msg.chatId, replyText).catch(() => {});
    }

    console.log(`[IMBridge] Pairing challenge issued: channel=${msg.channel} sender=${msg.senderId} code=${code}`);
  }

  /**
   * 审批配对请求（管理员操作）
   */
  async approvePairing(code: string): Promise<{ success: boolean; error?: string }> {
    const request = this.pairingRequests.get(code);
    if (!request) {
      return { success: false, error: 'Pairing code not found or expired' };
    }

    this.pairingRequests.delete(code);

    // 将用户加入 allowList
    const config = this.getChannelConfig(request.channel);
    const allowList = [...(config?.allowList || [])];
    if (!allowList.includes(request.senderId)) {
      allowList.push(request.senderId);
    }
    await this.updateAllowList(request.channel, allowList);

    // 通知用户
    const adapter = this.getAdapter(request.channel);
    if (adapter) {
      await adapter.sendText(request.senderId, 'Access approved! You can now send messages to the AI.').catch(() => {});
    }

    console.log(`[IMBridge] Pairing approved: channel=${request.channel} sender=${request.senderId}`);
    return { success: true };
  }

  /**
   * 拒绝配对请求（管理员操作）
   */
  denyPairing(code: string): { success: boolean; error?: string } {
    const request = this.pairingRequests.get(code);
    if (!request) {
      return { success: false, error: 'Pairing code not found or expired' };
    }

    this.pairingRequests.delete(code);
    console.log(`[IMBridge] Pairing denied: channel=${request.channel} sender=${request.senderId}`);
    return { success: true };
  }

  /**
   * 获取所有待审批的配对请求
   */
  getPairingRequests(): PairingRequest[] {
    return Array.from(this.pairingRequests.values());
  }

  /**
   * 清理过期的配对请求
   */
  private cleanExpiredPairings(): void {
    const now = Date.now();
    for (const [code, req] of this.pairingRequests) {
      if (now - req.createdAt > PAIRING_TTL_MS) {
        this.pairingRequests.delete(code);
      }
    }
  }

  // ==========================================================================
  // 会话 ID
  // ==========================================================================

  private buildSessionId(channel: string, chatId: string): string {
    const fixed = this.getChannelConfig(channel)?.fixedSessionId;
    if (fixed) return fixed;
    return `im_${channel}_${chatId}`;
  }
}
