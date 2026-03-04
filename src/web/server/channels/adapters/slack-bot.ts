/**
 * Slack Bot 适配器
 *
 * 使用 @slack/bolt 的 Socket Mode 连接 Slack。
 * 参考 OpenClaw extensions/slack/ 的设计，但大幅精简：
 * - 只支持 Socket Mode（无需公网 URL）
 * - 只处理文本和图片消息
 * - 白名单通过 allowList 配置
 */

import type { ChannelAdapter, ChannelConfig, ChannelStatus, InboundMessage, SendOptions } from '../types.js';

// Slack SDK 类型（动态导入）
type SlackApp = import('@slack/bolt').App;

/** Slack 消息长度限制 */
const SLACK_TEXT_LIMIT = 4000;

export class SlackBotAdapter implements ChannelAdapter {
  readonly id = 'slack-bot';
  readonly name = 'Slack Bot';

  private app: SlackApp | null = null;
  private status: ChannelStatus = 'disconnected';
  private config: ChannelConfig | null = null;
  private onMessage: ((msg: InboundMessage) => void) | null = null;
  /** Bot 自己的 User ID（用于过滤自己的消息） */
  private botUserId: string = '';

  async start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void> {
    const botToken = config.credentials?.botToken;
    const appToken = config.credentials?.appToken;

    if (!botToken) {
      throw new Error('Slack Bot Token (xoxb-) is required. Set channels.slack-bot.credentials.botToken in settings.');
    }
    if (!appToken) {
      throw new Error('Slack App Token (xapp-) is required for Socket Mode. Set channels.slack-bot.credentials.appToken in settings.');
    }

    this.config = config;
    this.onMessage = onMessage;
    this.status = 'connecting';

    try {
      const { App } = await import('@slack/bolt');

      this.app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      // 获取 Bot 信息
      const authResult = await this.app.client.auth.test({ token: botToken });
      this.botUserId = authResult.user_id || '';
      console.log(`[Slack] Bot connected: @${authResult.user} (team: ${authResult.team})`);

      // 注册消息事件处理器
      this.registerHandlers();

      // 启动 Socket Mode
      await this.app.start();
      this.status = 'connected';
      console.log('[Slack] Socket Mode started');

    } catch (error) {
      this.status = 'error';
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Cannot find package '@slack/bolt'") || msg.includes('ERR_MODULE_NOT_FOUND')) {
        throw new Error('@slack/bolt is not installed. Run: npm install @slack/bolt');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.status = 'disconnected';
    console.log('[Slack] Bot stopped');
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<string | void> {
    if (!this.app) throw new Error('Slack bot not started');

    const result = await this.app.client.chat.postMessage({
      channel: chatId,
      text,
      mrkdwn: options?.parseMode === 'Markdown',
      ...(options?.replyToMessageId ? { thread_ts: options.replyToMessageId } : {}),
    });
    return result.ts; // Slack 用时间戳作消息 ID
  }

  async editText(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<boolean> {
    if (!this.app) return false;

    try {
      await this.app.client.chat.update({
        channel: chatId,
        ts: messageId,
        text,
      });
      return true;
    } catch (error: any) {
      // "message_not_found" 或 "cant_update_message" 不算致命错误
      console.error('[Slack] editText failed:', error?.data?.error || error?.message || error);
      return false;
    }
  }

  async sendImage(chatId: string, imageData: Buffer, mimeType: string, caption?: string): Promise<void> {
    if (!this.app) throw new Error('Slack bot not started');

    // Slack 新版文件上传 3 步流程
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `image.${ext}`;

    // 1. 获取上传 URL
    const uploadResult = await this.app.client.files.getUploadURLExternal({
      filename,
      length: imageData.length,
    });

    if (!uploadResult.upload_url || !uploadResult.file_id) {
      throw new Error('Failed to get Slack upload URL');
    }

    // 2. 上传文件
    await fetch(uploadResult.upload_url, {
      method: 'POST',
      body: imageData,
      headers: { 'Content-Type': mimeType },
    });

    // 3. 完成上传并分享到频道
    await this.app.client.files.completeUploadExternal({
      files: [{ id: uploadResult.file_id, title: caption || filename }],
      channel_id: chatId,
      initial_comment: caption,
    });
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  // ==========================================================================
  // 消息处理
  // ==========================================================================

  private registerHandlers(): void {
    if (!this.app) return;

    // 普通消息事件（私聊 + 频道消息）
    this.app.message(async ({ message, say }) => {
      // 类型守卫：只处理标准消息
      const msg = message as any;
      if (msg.subtype) return; // 忽略系统消息、编辑等

      // 忽略 Bot 自己的消息
      if (msg.user === this.botUserId) return;
      if (msg.bot_id) return;

      const channelType = msg.channel_type;
      const isGroup = channelType === 'channel' || channelType === 'group' || channelType === 'mpim';
      const chatId = msg.channel;
      const senderId = msg.user || '';

      // 白名单检查
      if (!this.isAllowed(senderId, chatId, isGroup)) return;

      // 群组消息处理
      if (isGroup) {
        if (!this.config?.allowGroups) return;

        const trigger = this.config.groupTrigger || 'mention';
        if (trigger === 'mention') {
          // 普通 message 事件不是 @mention，跳过（@mention 由 app_mention 处理）
          return;
        }
        // trigger === 'always' 时处理所有消息
      }

      this.emitMessage(msg, isGroup, false);
    });

    // @mention 事件（群组中 @机器人）
    this.app.event('app_mention', async ({ event }) => {
      const msg = event as any;

      // 忽略 DM 中的 app_mention（和 message 事件重复）
      if (msg.channel_type === 'im') return;

      const chatId = msg.channel;
      const senderId = msg.user || '';
      const isGroup = true;

      // 白名单检查
      if (!this.isAllowed(senderId, chatId, isGroup)) return;

      // 群组必须允许
      if (!this.config?.allowGroups) return;

      this.emitMessage(msg, isGroup, true);
    });
  }

  private emitMessage(msg: any, isGroup: boolean, isMentioned: boolean): void {
    if (!this.onMessage) return;

    let text = msg.text || '';

    // 去掉 @mention
    if (isMentioned && this.botUserId) {
      text = text.replace(new RegExp(`<@${this.botUserId}>`, 'g'), '').trim();
    }

    // 忽略空消息
    if (!text.trim()) return;

    const inbound: InboundMessage = {
      channel: 'slack-bot',
      senderId: msg.user || '',
      senderName: msg.user || 'Unknown',
      chatId: msg.channel,
      text: text.trim(),
      isGroup,
      isMentioned,
      messageId: msg.ts, // Slack 用时间戳作消息 ID
      timestamp: msg.ts ? Math.floor(parseFloat(msg.ts) * 1000) : Date.now(),
    };

    this.onMessage(inbound);
  }

  // ==========================================================================
  // 权限检查
  // ==========================================================================

  private isAllowed(senderId: string, chatId: string, isGroup: boolean): boolean {
    const allowList = this.config?.allowList;

    // 没有白名单 = 全部拒绝（安全默认值）
    if (!allowList || allowList.length === 0) {
      return false;
    }

    // '*' = 全部放行
    if (allowList.includes('*')) return true;

    // 检查 senderId (U开头)
    if (allowList.includes(senderId)) return true;

    // 群组：检查 chatId (C/G/D 开头)
    if (isGroup && allowList.includes(chatId)) return true;

    return false;
  }
}
