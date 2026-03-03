/**
 * Telegram Bot 适配器
 *
 * 使用 grammY 库连接 Telegram Bot API。
 * 参考 OpenClaw extensions/telegram/ 的设计，但大幅简化：
 * - 只处理文本和图片消息
 * - 只支持 Long Polling（不搞 Webhook）
 * - 白名单通过 allowList 配置
 */

import type { ChannelAdapter, ChannelConfig, ChannelStatus, InboundMessage, SendOptions } from '../types.js';

// grammY 类型（动态导入，避免未安装时报错）
type BotType = import('grammy').Bot;
type ContextType = import('grammy').Context;

export class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram';
  readonly name = 'Telegram';

  private bot: BotType | null = null;
  private status: ChannelStatus = 'disconnected';
  private config: ChannelConfig | null = null;
  private onMessage: ((msg: InboundMessage) => void) | null = null;
  /** Bot 自己的 username（用于群消息 @mention 检测） */
  private botUsername: string = '';

  async start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void> {
    const botToken = config.credentials?.botToken;
    if (!botToken) {
      throw new Error('Telegram Bot Token is required. Set channels.telegram.credentials.botToken in settings.');
    }

    this.config = config;
    this.onMessage = onMessage;
    this.status = 'connecting';

    try {
      // 动态导入 grammY（用户可能没装）
      const grammy = await import('grammy');
      this.bot = new grammy.Bot(botToken);

      // 获取 Bot 信息
      const me = await this.bot.api.getMe();
      this.botUsername = me.username || '';
      console.log(`[Telegram] Bot connected: @${this.botUsername} (${me.first_name})`);

      // 注册消息处理器
      this.registerHandlers();

      // 启动 Long Polling（不阻塞，在后台运行）
      this.bot.start({
        onStart: () => {
          this.status = 'connected';
          console.log('[Telegram] Long polling started');
        },
      });

      // bot.start() 是非阻塞的（grammY v1 行为），但错误处理需要 catch
      this.bot.catch((err) => {
        console.error('[Telegram] Bot error:', err.message || err);
        // 不改状态为 error，grammY 会自动重试
      });

    } catch (error) {
      this.status = 'error';
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Cannot find package 'grammy'") || msg.includes('ERR_MODULE_NOT_FOUND')) {
        throw new Error(
          'grammy package is not installed. Run: npm install grammy'
        );
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
    this.status = 'disconnected';
    console.log('[Telegram] Bot stopped');
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot not started');

    const sendOpts: Record<string, any> = {};

    // 解析模式
    if (options?.parseMode === 'Markdown') {
      sendOpts.parse_mode = 'Markdown';
    } else if (options?.parseMode === 'HTML') {
      sendOpts.parse_mode = 'HTML';
    }

    // 回复
    if (options?.replyToMessageId) {
      sendOpts.reply_parameters = { message_id: Number(options.replyToMessageId) };
    }

    try {
      await this.bot.api.sendMessage(Number(chatId), text, sendOpts);
    } catch (error: any) {
      // Markdown 解析失败，降级为纯文本
      if (error?.description?.includes("can't parse")) {
        await this.bot.api.sendMessage(Number(chatId), text, {
          ...sendOpts,
          parse_mode: undefined,
        });
      } else {
        throw error;
      }
    }
  }

  async sendImage(chatId: string, imageData: Buffer, mimeType: string, caption?: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot not started');
    const file = new (await import('grammy')).InputFile(imageData, `image.${mimeType.split('/')[1] || 'png'}`);
    await this.bot.api.sendPhoto(Number(chatId), file, { caption });
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  // ==========================================================================
  // 消息处理
  // ==========================================================================

  private registerHandlers(): void {
    if (!this.bot) return;

    // 文本消息
    this.bot.on('message:text', (ctx) => {
      this.handleMessage(ctx, ctx.message.text);
    });

    // 图片消息（带可选 caption）
    this.bot.on('message:photo', async (ctx) => {
      const caption = ctx.message.caption || '';
      // 获取最大分辨率的图片
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];

      try {
        const file = await ctx.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config?.credentials?.botToken}/${file.file_path}`;

        // 下载图片转 base64
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = buffer.toString('base64');

        this.handleMessage(ctx, caption || 'Please analyze this image', [
          { data: base64, mimeType: 'image/jpeg' },
        ]);
      } catch (error) {
        console.error('[Telegram] Failed to download photo:', error);
        this.handleMessage(ctx, caption || '(photo)');
      }
    });
  }

  private handleMessage(
    ctx: ContextType,
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): void {
    if (!ctx.from || !ctx.chat || !this.onMessage) return;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const senderId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);

    // 白名单检查
    if (!this.isAllowed(senderId, ctx.from.username, chatId, isGroup)) {
      return;
    }

    // 群组消息处理
    if (isGroup) {
      if (!this.config?.allowGroups) return;

      const trigger = this.config.groupTrigger || 'mention';

      if (trigger === 'mention') {
        // 检查是否 @了机器人
        const isMentioned = this.checkMention(text, ctx);
        if (!isMentioned) return;
        // 去掉 @mention 文本
        text = this.removeMention(text);
      }
      // trigger === 'always' 时所有消息都处理
      // trigger === 'keyword' 暂不实现
    }

    // 忽略空消息
    if (!text.trim() && (!images || images.length === 0)) return;

    const msg: InboundMessage = {
      channel: 'telegram',
      senderId,
      senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      chatId,
      text: text.trim(),
      isGroup,
      isMentioned: isGroup,
      messageId: String(ctx.message?.message_id || ''),
      images,
      timestamp: (ctx.message?.date || Math.floor(Date.now() / 1000)) * 1000,
    };

    this.onMessage(msg);
  }

  // ==========================================================================
  // 权限检查
  // ==========================================================================

  private isAllowed(senderId: string, username: string | undefined, chatId: string, isGroup: boolean): boolean {
    const allowList = this.config?.allowList;

    // 没有白名单 = 全部拒绝（安全默认值）
    if (!allowList || allowList.length === 0) {
      return false;
    }

    // '*' = 全部放行
    if (allowList.includes('*')) return true;

    // 检查 senderId
    if (allowList.includes(senderId)) return true;

    // 检查 username（不带 @）
    if (username && allowList.includes(username)) return true;

    // 群组：检查 chatId
    if (isGroup && allowList.includes(chatId)) return true;

    return false;
  }

  private checkMention(text: string, ctx: ContextType): boolean {
    // 方式 1：消息中包含 @botUsername
    if (this.botUsername && text.includes(`@${this.botUsername}`)) {
      return true;
    }

    // 方式 2：回复机器人的消息
    const replyTo = (ctx.message as any)?.reply_to_message;
    if (replyTo?.from?.is_bot && replyTo?.from?.username === this.botUsername) {
      return true;
    }

    return false;
  }

  private removeMention(text: string): string {
    if (!this.botUsername) return text;
    return text.replace(new RegExp(`@${this.botUsername}\\b`, 'gi'), '').trim();
  }
}
