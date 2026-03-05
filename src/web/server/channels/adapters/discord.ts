/**
 * Discord Bot 适配器
 *
 * 使用 discord.js 的 Gateway WebSocket 连接 Discord。
 * - 无需公网 URL，直接连接 Discord Gateway
 * - 支持私聊（DM）和服务器频道消息
 * - @mention 检测
 */

import type { ChannelAdapter, ChannelConfig, ChannelStatus, InboundMessage, SendOptions } from '../types.js';

// discord.js 类型（动态导入）
type DiscordClient = import('discord.js').Client;
type DiscordMessage = import('discord.js').Message;

/** Discord 消息长度限制 */
const DISCORD_TEXT_LIMIT = 2000;

export class DiscordAdapter implements ChannelAdapter {
  readonly id = 'discord';
  readonly name = 'Discord';

  private client: DiscordClient | null = null;
  private status: ChannelStatus = 'disconnected';
  private config: ChannelConfig | null = null;
  private onMessage: ((msg: InboundMessage) => void) | null = null;
  /** Bot 自己的 User ID（用于过滤自己的消息和 @mention 检测） */
  private botUserId: string = '';

  async start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void> {
    const botToken = config.credentials?.botToken;

    if (!botToken) {
      throw new Error('Discord Bot Token is required. Get it from Discord Developer Portal → Your App → Bot → Token.');
    }

    this.config = config;
    this.onMessage = onMessage;
    this.status = 'connecting';

    try {
      const { Client, GatewayIntentBits, Partials } = await import('discord.js');

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      // 先注册消息事件处理器（必须在 login 之前，防止竞争条件）
      this.registerHandlers();

      // 把 login()、ready 事件、error 事件、超时全部纳入同一个 Promise
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const timeout = setTimeout(() => {
          // 不在此处调用 destroy()：discord.js 取消内部 ws 监听后再收到 error 会崩溃
          // ready 事件若在超时后才触发，由 ready 处理器负责销毁僵尸连接
          settle(() => reject(new Error('Discord login timeout (30s). Check your bot token and network.')));
        }, 30000);

        this.client!.once('ready', () => {
          clearTimeout(timeout);
          if (settled) {
            // 超时已触发，ready 迟到 → 销毁僵尸连接
            this.client!.destroy();
            return;
          }
          settle(() => resolve());
        });

        // login() 自身的 rejection 映射到外层 Promise
        this.client!.login(botToken).catch((err) => {
          clearTimeout(timeout);
          settle(() => reject(err));
        });
      });

      this.botUserId = this.client.user?.id || '';
      console.log(`[Discord] Bot connected: ${this.client.user?.tag}`);
      this.status = 'connected';

    } catch (error) {
      this.status = 'error';
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Cannot find package 'discord.js'") || msg.includes('ERR_MODULE_NOT_FOUND')) {
        throw new Error("discord.js is not installed. Run: npm install discord.js");
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.status = 'disconnected';
    console.log('[Discord] Bot stopped');
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<string | void> {
    if (!this.client) throw new Error('Discord bot not started');

    // 截断超长消息
    const truncated = text.length > DISCORD_TEXT_LIMIT
      ? text.slice(0, DISCORD_TEXT_LIMIT - 3) + '...'
      : text;

    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel || !('send' in channel)) {
        throw new Error(`Channel ${chatId} is not a text channel`);
      }
      const sent = await (channel as any).send({ content: truncated });
      return sent.id;
    } catch (error) {
      console.error('[Discord] sendText failed:', error);
      throw error;
    }
  }

  async editText(chatId: string, messageId: string, text: string, _options?: SendOptions): Promise<boolean> {
    if (!this.client) return false;

    const truncated = text.length > DISCORD_TEXT_LIMIT
      ? text.slice(0, DISCORD_TEXT_LIMIT - 3) + '...'
      : text;

    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel || !('messages' in channel)) return false;
      const message = await (channel as any).messages.fetch(messageId);
      await message.edit({ content: truncated });
      return true;
    } catch (error: any) {
      console.error('[Discord] editText failed:', error?.message || error);
      return false;
    }
  }

  async sendImage(chatId: string, imageData: Buffer, mimeType: string, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Discord bot not started');

    const ext = mimeType.split('/')[1] || 'png';
    const filename = `image.${ext}`;

    try {
      const { AttachmentBuilder } = await import('discord.js');
      const channel = await this.client.channels.fetch(chatId);
      if (!channel || !('send' in channel)) {
        throw new Error(`Channel ${chatId} is not a text channel`);
      }
      const attachment = new AttachmentBuilder(imageData, { name: filename });
      await (channel as any).send({ content: caption || '', files: [attachment] });
    } catch (error) {
      console.error('[Discord] sendImage failed:', error);
      throw error;
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  // ==========================================================================
  // 消息处理
  // ==========================================================================

  private registerHandlers(): void {
    if (!this.client) return;

    this.client.on('messageCreate', async (message: DiscordMessage) => {
      // 忽略 Bot 自己和其他 Bot 的消息
      if (message.author.bot) return;

      const isGuildMessage = !!message.guild;
      const chatId = message.channel.id;
      const senderId = message.author.id;

      // 白名单检查
      if (!this.isAllowed(senderId, chatId, isGuildMessage)) return;

      // 服务器消息处理
      if (isGuildMessage) {
        if (!this.config?.allowGroups) return;

        const trigger = this.config.groupTrigger || 'mention';
        const isMentioned = this.botUserId ? message.mentions.has(this.botUserId) : false;

        if (trigger === 'mention' && !isMentioned) return;

        this.emitMessage(message, true, isMentioned);
      } else {
        // DM 消息
        this.emitMessage(message, false, false);
      }
    });

    this.client.on('error', (error) => {
      console.error('[Discord] Client error:', error);
      this.status = 'error';
    });
  }

  private emitMessage(message: DiscordMessage, isGroup: boolean, isMentioned: boolean): void {
    if (!this.onMessage) return;

    let text = message.content || '';

    // 去掉 @mention
    if (isMentioned && this.botUserId) {
      text = text.replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '').trim();
    }

    // 忽略空消息
    if (!text.trim() && message.attachments.size === 0) return;

    const inbound: InboundMessage = {
      channel: 'discord',
      senderId: message.author.id,
      senderName: message.author.username,
      chatId: message.channel.id,
      text: text.trim(),
      isGroup,
      isMentioned,
      messageId: message.id,
      timestamp: message.createdTimestamp,
    };

    // 处理图片附件
    if (message.attachments.size > 0) {
      // 只取第一个图片附件（简化处理）
      const attachment = message.attachments.first();
      if (attachment && attachment.contentType?.startsWith('image/')) {
        // Discord 附件已是 URL，不预下载，先发文字
        if (!inbound.text) {
          inbound.text = attachment.url;
        }
      }
    }

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

    // 检查 senderId（Discord User ID）
    if (allowList.includes(senderId)) return true;

    // 群组：检查 chatId（频道 ID）
    if (isGroup && allowList.includes(chatId)) return true;

    return false;
  }
}
