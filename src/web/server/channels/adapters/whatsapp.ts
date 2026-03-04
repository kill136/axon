/**
 * WhatsApp Cloud API 适配器
 *
 * 使用 Meta Graph API 连接 WhatsApp Business Platform。
 * 与其他适配器（Telegram/飞书/Slack）不同，WhatsApp 需要：
 * - 公网可访问的 HTTPS Webhook 端点来接收消息
 * - Meta 开发者账号 + WhatsApp Business 账号
 *
 * 收消息：Meta POST → /webhook/whatsapp（由 ChannelManager 挂载到 Express）
 * 发消息：POST → https://graph.facebook.com/v21.0/{phoneNumberId}/messages
 *
 * 限制：
 * - 不支持编辑已发送的消息（无 editText）
 * - 图片需要先上传到 Meta 获取 media_id
 */

import type { ChannelAdapter, ChannelConfig, ChannelStatus, InboundMessage, SendOptions } from '../types.js';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';

  private status: ChannelStatus = 'disconnected';
  private config: ChannelConfig | null = null;
  private onMessage: ((msg: InboundMessage) => void) | null = null;

  async start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void> {
    const accessToken = config.credentials?.accessToken;
    const phoneNumberId = config.credentials?.phoneNumberId;
    const verifyToken = config.credentials?.verifyToken;

    if (!accessToken || !phoneNumberId) {
      throw new Error(
        'WhatsApp Access Token and Phone Number ID are required. ' +
        'Set channels.whatsapp.credentials.accessToken and phoneNumberId in settings.'
      );
    }

    if (!verifyToken) {
      throw new Error(
        'WhatsApp Verify Token is required for webhook verification. ' +
        'Set channels.whatsapp.credentials.verifyToken in settings.'
      );
    }

    this.config = config;
    this.onMessage = onMessage;
    this.status = 'connected';

    console.log(`[WhatsApp] Adapter started (phoneNumberId: ${phoneNumberId})`);
    console.log(`[WhatsApp] Webhook endpoint: /webhook/whatsapp (ensure this is publicly accessible)`);
  }

  async stop(): Promise<void> {
    this.config = null;
    this.onMessage = null;
    this.status = 'disconnected';
    console.log('[WhatsApp] Adapter stopped');
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<string | void> {
    if (!this.config) throw new Error('WhatsApp adapter not started');

    const { accessToken, phoneNumberId } = this.config.credentials;

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: chatId,
      type: 'text',
      text: { body: text },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`WhatsApp API error (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    return data?.messages?.[0]?.id;
  }

  // WhatsApp 不支持编辑消息，所以不实现 editText

  async sendImage(chatId: string, imageData: Buffer, mimeType: string, caption?: string): Promise<void> {
    if (!this.config) throw new Error('WhatsApp adapter not started');

    const { accessToken, phoneNumberId } = this.config.credentials;

    // 1. 上传媒体文件到 WhatsApp
    const uploadUrl = `${GRAPH_API_BASE}/${phoneNumberId}/media`;

    const formData = new FormData();
    const blob = new Blob([imageData], { type: mimeType });
    formData.append('file', blob, `image.${mimeType.split('/')[1] || 'png'}`);
    formData.append('type', mimeType);
    formData.append('messaging_product', 'whatsapp');

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`WhatsApp media upload error (${uploadResponse.status}): ${errText}`);
    }

    const uploadData = await uploadResponse.json() as any;
    const mediaId = uploadData?.id;

    if (!mediaId) {
      throw new Error('Failed to upload image to WhatsApp');
    }

    // 2. 发送图片消息
    const msgUrl = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
    const body: Record<string, any> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: chatId,
      type: 'image',
      image: {
        id: mediaId,
        ...(caption ? { caption } : {}),
      },
    };

    const response = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`WhatsApp send image error (${response.status}): ${errText}`);
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  // ==========================================================================
  // Webhook 处理（由 ChannelManager 调用）
  // ==========================================================================

  /**
   * 处理 Webhook 验证请求（GET）
   * Meta 在配置 webhook 时会发一个 GET 请求验证 verify_token
   */
  handleWebhookVerify(query: Record<string, string>): { status: number; body: string } {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === this.config?.credentials?.verifyToken) {
      console.log('[WhatsApp] Webhook verified');
      return { status: 200, body: challenge || '' };
    }

    console.warn('[WhatsApp] Webhook verification failed');
    return { status: 403, body: 'Forbidden' };
  }

  /**
   * 处理入站 Webhook 消息（POST）
   * Meta 将消息事件 POST 到这个端点
   */
  handleWebhookMessage(body: any): void {
    if (!this.onMessage || !this.config) return;

    // WhatsApp Cloud API webhook payload 结构：
    // { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [...] } }] }] }
    if (body?.object !== 'whatsapp_business_account') return;

    const entries = body.entry;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const changes = entry.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value) continue;

        const contacts = value.contacts || [];
        const messages = value.messages || [];

        for (const message of messages) {
          this.processWhatsAppMessage(message, contacts);
        }
      }
    }
  }

  // ==========================================================================
  // 内部方法
  // ==========================================================================

  private processWhatsAppMessage(
    message: any,
    contacts: any[],
  ): void {
    if (!this.onMessage || !this.config) return;

    const from = message.from; // 发送者手机号
    if (!from) return;

    // 获取联系人信息
    const contact = contacts.find((c: any) => c.wa_id === from);
    const senderName = contact?.profile?.name || from;

    // 白名单检查
    if (!this.isAllowed(from)) return;

    let text = '';
    let images: Array<{ data: string; mimeType: string }> | undefined;

    switch (message.type) {
      case 'text':
        text = message.text?.body || '';
        break;

      case 'image':
        // 图片消息：需要下载媒体
        // 先发送文本描述，图片下载是异步的
        text = message.image?.caption || 'Please analyze this image';
        this.downloadAndForwardImage(message, from, senderName).catch(err => {
          console.error('[WhatsApp] Failed to download image:', err);
        });
        // 如果有 caption 就处理文本部分，没有就等图片下载完
        if (!message.image?.caption) return;
        break;

      case 'document':
        text = message.document?.caption || '(document)';
        break;

      case 'audio':
        text = '(audio message)';
        break;

      case 'video':
        text = message.video?.caption || '(video)';
        break;

      case 'location':
        const loc = message.location;
        text = `Location: ${loc?.latitude}, ${loc?.longitude}${loc?.name ? ` (${loc.name})` : ''}`;
        break;

      case 'reaction':
        // 忽略 reaction
        return;

      case 'sticker':
        // 忽略贴纸
        return;

      default:
        // 不支持的消息类型
        return;
    }

    if (!text.trim() && (!images || images.length === 0)) return;

    const msg: InboundMessage = {
      channel: 'whatsapp',
      senderId: from,
      senderName,
      chatId: from, // WhatsApp 私聊中 chatId 就是发送者手机号
      text: text.trim(),
      isGroup: false, // WhatsApp Cloud API 群组支持较复杂，暂时只支持私聊
      messageId: message.id,
      images,
      timestamp: parseInt(message.timestamp, 10) * 1000 || Date.now(),
    };

    this.onMessage(msg);
  }

  /**
   * 下载 WhatsApp 媒体文件并转发给 AI
   */
  private async downloadAndForwardImage(
    message: any,
    from: string,
    senderName: string,
  ): Promise<void> {
    if (!this.config || !this.onMessage) return;

    const { accessToken } = this.config.credentials;
    const mediaId = message.image?.id;
    if (!mediaId) return;

    // 1. 获取媒体 URL
    const mediaUrl = `${GRAPH_API_BASE}/${mediaId}`;
    const metaResponse = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!metaResponse.ok) return;
    const mediaData = await metaResponse.json() as any;
    const downloadUrl = mediaData?.url;
    if (!downloadUrl) return;

    // 2. 下载媒体文件
    const fileResponse = await fetch(downloadUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!fileResponse.ok) return;
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const base64 = buffer.toString('base64');
    const mimeType = mediaData?.mime_type || 'image/jpeg';

    // 3. 构造消息
    const msg: InboundMessage = {
      channel: 'whatsapp',
      senderId: from,
      senderName,
      chatId: from,
      text: message.image?.caption || 'Please analyze this image',
      isGroup: false,
      messageId: message.id + '_image',
      images: [{ data: base64, mimeType }],
      timestamp: parseInt(message.timestamp, 10) * 1000 || Date.now(),
    };

    this.onMessage(msg);
  }

  // ==========================================================================
  // 权限检查
  // ==========================================================================

  private isAllowed(senderId: string): boolean {
    const allowList = this.config?.allowList;

    // 没有白名单 = 全部拒绝（安全默认值）
    if (!allowList || allowList.length === 0) {
      return false;
    }

    // '*' = 全部放行
    if (allowList.includes('*')) return true;

    // 检查手机号（可能带或不带国家代码前缀）
    if (allowList.includes(senderId)) return true;

    // 尝试匹配不带 + 的号码
    const normalized = senderId.replace(/^\+/, '');
    if (allowList.includes(normalized)) return true;

    return false;
  }
}
