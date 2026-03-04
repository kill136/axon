/**
 * 飞书 (Feishu/Lark) Bot 适配器
 *
 * 使用 @larksuiteoapi/node-sdk 官方 SDK。
 * 参考 OpenClaw extensions/feishu/ 的设计，但大幅精简：
 * - WebSocket 长连接模式（无需公网 URL）
 * - 只处理文本和图片消息
 * - 白名单通过 allowList 配置
 */

import type { ChannelAdapter, ChannelConfig, ChannelStatus, InboundMessage, SendOptions } from '../types.js';

// SDK 类型（动态导入）
type LarkClient = import('@larksuiteoapi/node-sdk').Client;
type LarkWSClient = import('@larksuiteoapi/node-sdk').WSClient;
type LarkEventDispatcher = import('@larksuiteoapi/node-sdk').EventDispatcher;

/**
 * 飞书消息事件数据结构
 * 来自 im.message.receive_v1 事件
 */
interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu';
  readonly name = 'Feishu';

  private client: LarkClient | null = null;
  private wsClient: LarkWSClient | null = null;
  private status: ChannelStatus = 'disconnected';
  private config: ChannelConfig | null = null;
  private onMessage: ((msg: InboundMessage) => void) | null = null;
  /** Bot 自己的 open_id（用于群消息 @mention 检测） */
  private botOpenId: string = '';

  async start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void> {
    const appId = config.credentials?.appId;
    const appSecret = config.credentials?.appSecret;

    if (!appId || !appSecret) {
      throw new Error('Feishu App ID and App Secret are required. Set channels.feishu.credentials.appId and appSecret in settings.');
    }

    this.config = config;
    this.onMessage = onMessage;
    this.status = 'connecting';

    try {
      const Lark = await import('@larksuiteoapi/node-sdk');

      // 解析 domain
      const domainStr = config.credentials?.domain || 'feishu';
      const domain = domainStr === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;

      // 创建 API Client（用于发送消息）
      this.client = new Lark.Client({
        appId,
        appSecret,
        appType: Lark.AppType.SelfBuild,
        domain,
      });

      // 创建事件分发器
      const eventDispatcher: LarkEventDispatcher = new Lark.EventDispatcher({
        encryptKey: config.credentials?.encryptKey,
        verificationToken: config.credentials?.verificationToken,
      });

      // 注册消息事件处理器
      eventDispatcher.register({
        'im.message.receive_v1': async (data: unknown) => {
          try {
            await this.handleMessageEvent(data as FeishuMessageEvent);
          } catch (error) {
            console.error('[Feishu] Error handling message event:', error);
          }
        },
      });

      // 创建 WebSocket 长连接客户端
      this.wsClient = new Lark.WSClient({
        appId,
        appSecret,
        domain,
        loggerLevel: Lark.LoggerLevel.warn,
      });

      // 启动 WebSocket 连接
      this.wsClient.start({ eventDispatcher });
      this.status = 'connected';
      console.log(`[Feishu] WebSocket connected (domain: ${domainStr})`);

    } catch (error) {
      this.status = 'error';
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Cannot find package '@larksuiteoapi/node-sdk'") || msg.includes('ERR_MODULE_NOT_FOUND')) {
        throw new Error('@larksuiteoapi/node-sdk is not installed. Run: npm install @larksuiteoapi/node-sdk');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    // WSClient 没有显式的 stop 方法，但它内部会在 GC 时清理
    // 置空引用让 GC 回收
    this.wsClient = null;
    this.client = null;
    this.status = 'disconnected';
    console.log('[Feishu] Bot stopped');
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<string | void> {
    if (!this.client) throw new Error('Feishu client not started');

    const receiveIdType = this.resolveIdType(chatId);

    // 使用 post 格式发送（支持 Markdown）
    if (options?.parseMode === 'Markdown') {
      const content = JSON.stringify({
        zh_cn: {
          content: [[{ tag: 'md', text }]],
        },
      });

      if (options?.replyToMessageId) {
        try {
          const res = await (this.client as any).im.message.reply({
            path: { message_id: options.replyToMessageId },
            data: { content, msg_type: 'post' },
          });
          return res?.data?.message_id;
        } catch {
          // 如果回复失败（消息已撤回），降级为直接发送
        }
      }

      const res = await (this.client as any).im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: chatId,
          content,
          msg_type: 'post',
        },
      });
      return res?.data?.message_id;
    } else {
      // 纯文本
      const content = JSON.stringify({ text });

      if (options?.replyToMessageId) {
        try {
          const res = await (this.client as any).im.message.reply({
            path: { message_id: options.replyToMessageId },
            data: { content, msg_type: 'text' },
          });
          return res?.data?.message_id;
        } catch {
          // 降级为直接发送
        }
      }

      const res = await (this.client as any).im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: chatId,
          content,
          msg_type: 'text',
        },
      });
      return res?.data?.message_id;
    }
  }

  async editText(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<boolean> {
    if (!this.client) return false;

    try {
      if (options?.parseMode === 'Markdown') {
        const content = JSON.stringify({
          zh_cn: {
            content: [[{ tag: 'md', text }]],
          },
        });
        await (this.client as any).im.message.update({
          path: { message_id: messageId },
          data: { content, msg_type: 'post' },
        });
      } else {
        const content = JSON.stringify({ text });
        await (this.client as any).im.message.update({
          path: { message_id: messageId },
          data: { content, msg_type: 'text' },
        });
      }
      return true;
    } catch (error: any) {
      // 飞书只允许编辑 24 小时内的消息
      console.error('[Feishu] editText failed:', error?.msg || error?.message || error);
      return false;
    }
  }

  async sendImage(chatId: string, imageData: Buffer, _mimeType: string, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Feishu client not started');

    const receiveIdType = this.resolveIdType(chatId);

    // 1. 上传图片
    const uploadRes = await (this.client as any).im.image.create({
      data: {
        image_type: 'message',
        image: imageData,
      },
    });

    const imageKey = uploadRes?.data?.image_key;
    if (!imageKey) {
      throw new Error('Failed to upload image to Feishu');
    }

    // 2. 发送图片消息
    await (this.client as any).im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      },
    });

    // 3. 如果有 caption，额外发一条文本
    if (caption) {
      await this.sendText(chatId, caption);
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  // ==========================================================================
  // 消息事件处理
  // ==========================================================================

  private async handleMessageEvent(event: FeishuMessageEvent): Promise<void> {
    if (!this.onMessage) return;

    const sender = event.sender;
    const message = event.message;

    // 忽略机器人自己的消息
    if (sender.sender_type === 'app') return;

    const senderId = sender.sender_id.open_id;
    const chatId = message.chat_id;
    const isGroup = message.chat_type === 'group';

    // 白名单检查
    if (!this.isAllowed(senderId, chatId, isGroup)) return;

    // 群组消息处理
    let isMentioned = false;
    if (isGroup) {
      if (!this.config?.allowGroups) return;

      const trigger = this.config.groupTrigger || 'mention';
      if (trigger === 'mention') {
        isMentioned = this.checkBotMentioned(message);
        if (!isMentioned) return;
      }
    }

    // 解析消息内容
    let text = '';
    let images: Array<{ data: string; mimeType: string }> | undefined;

    switch (message.message_type) {
      case 'text': {
        text = this.parseTextContent(message.content);
        break;
      }
      case 'post': {
        text = this.parsePostContent(message.content);
        break;
      }
      case 'image': {
        const imageKey = this.parseImageKey(message.content);
        if (imageKey) {
          try {
            const imgData = await this.downloadImage(message.message_id, imageKey);
            images = [imgData];
            text = 'Please analyze this image';
          } catch (error) {
            console.error('[Feishu] Failed to download image:', error);
            text = '(image)';
          }
        }
        break;
      }
      default:
        // 不支持的消息类型，忽略
        return;
    }

    // 去掉 @mention 文本
    if (isMentioned && message.mentions) {
      text = this.removeMentions(text, message.mentions);
    }

    // 忽略空消息
    if (!text.trim() && (!images || images.length === 0)) return;

    // 发送者名称：从 mentions 中找或用 open_id
    const senderName = this.resolveSenderName(senderId, message.mentions);

    const msg: InboundMessage = {
      channel: 'feishu',
      senderId,
      senderName,
      chatId,
      text: text.trim(),
      isGroup,
      isMentioned,
      messageId: message.message_id,
      images,
      timestamp: parseInt(message.create_time, 10) || Date.now(),
    };

    this.onMessage(msg);
  }

  // ==========================================================================
  // 内容解析
  // ==========================================================================

  private parseTextContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return typeof parsed.text === 'string' ? parsed.text : '';
    } catch {
      return content;
    }
  }

  private parsePostContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      // Post 格式: { zh_cn: { content: [[{ tag, text }]] } }
      // 尝试多语言 key
      const langContent = parsed.zh_cn || parsed.en_us || parsed[Object.keys(parsed)[0]];
      if (!langContent?.content) return '';

      const texts: string[] = [];
      for (const paragraph of langContent.content) {
        if (!Array.isArray(paragraph)) continue;
        for (const element of paragraph) {
          if (element.tag === 'text' || element.tag === 'md') {
            texts.push(element.text || '');
          } else if (element.tag === 'a') {
            texts.push(element.text || element.href || '');
          } else if (element.tag === 'at') {
            // 跳过 @mention，在 removeMentions 中处理
            texts.push(element.user_name || '');
          }
        }
        texts.push('\n');
      }
      return texts.join('').trim();
    } catch {
      return '';
    }
  }

  private parseImageKey(content: string): string | null {
    try {
      const parsed = JSON.parse(content);
      return parsed.image_key || null;
    } catch {
      return null;
    }
  }

  private async downloadImage(messageId: string, imageKey: string): Promise<{ data: string; mimeType: string }> {
    if (!this.client) throw new Error('Feishu client not started');

    // 使用 messageResource API 下载消息中的图片
    const response = await (this.client as any).im.messageResource.get({
      path: {
        message_id: messageId,
        file_key: imageKey,
      },
      params: { type: 'image' },
    });

    // 响应是 Buffer
    const buffer = Buffer.isBuffer(response) ? response : Buffer.from(response);
    return {
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    };
  }

  // ==========================================================================
  // @Mention 检测
  // ==========================================================================

  private checkBotMentioned(message: FeishuMessageEvent['message']): boolean {
    if (!message.mentions) return false;

    // 方式 1：mentions 中包含 bot（sender_type 检测不到，用 key 前缀检测）
    // 飞书 @机器人 时会在 mentions 列表中，且 open_id 就是机器人的 open_id
    // 但我们可能不知道 bot 的 open_id，所以用替代方式
    for (const mention of message.mentions) {
      // 如果缓存了 botOpenId，直接比较
      if (this.botOpenId && mention.id.open_id === this.botOpenId) {
        return true;
      }
      // 飞书机器人的 mention.key 通常是 @_user_N 格式
      // 名称匹配（不太可靠，但作为 fallback）
    }

    // 方式 2：如果文本中包含 @_all（@所有人）
    // 暂不处理

    // 方式 3：默认放行（如果 mentions 列表不为空，说明有 @，可能是 @机器人）
    // 在飞书中，只有群组成员才能收到消息事件，如果机器人收到了群消息，
    // 且有 mentions，大概率是 @了机器人（或者开了接收所有群消息的权限）
    // 这里采用宽松策略：群组消息只要有 mentions 就处理
    return message.mentions.length > 0;
  }

  private removeMentions(text: string, mentions: FeishuMessageEvent['message']['mentions']): string {
    if (!mentions) return text;
    let result = text;
    for (const mention of mentions) {
      // 飞书消息中 @mention 显示为 @_user_N 占位符
      if (mention.key) {
        result = result.replace(new RegExp(mention.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      }
    }
    return result.trim();
  }

  private resolveSenderName(senderId: string, mentions?: FeishuMessageEvent['message']['mentions']): string {
    // 从 mentions 中寻找发送者名称
    if (mentions) {
      for (const m of mentions) {
        if (m.id.open_id === senderId && m.name) {
          return m.name;
        }
      }
    }
    // 回退到 open_id
    return senderId;
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

    // 检查 senderId (open_id)
    if (allowList.includes(senderId)) return true;

    // 群组：检查 chatId
    if (isGroup && allowList.includes(chatId)) return true;

    return false;
  }

  // ==========================================================================
  // ID 类型推断
  // ==========================================================================

  private resolveIdType(id: string): string {
    if (id.startsWith('oc_')) return 'chat_id';
    if (id.startsWith('ou_')) return 'open_id';
    // 默认用 chat_id（群组场景更常见）
    return 'chat_id';
  }
}
