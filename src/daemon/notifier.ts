/**
 * Daemon 通知器
 * 支持桌面通知（node-notifier）和飞书推送（@larksuiteoapi/node-sdk）
 */

import * as lark from '@larksuiteoapi/node-sdk';

export interface NotifierOptions {
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuChatId?: string;
}

export class Notifier {
  private feishuClient: lark.Client | null = null;
  private defaultFeishuChatId: string;

  constructor(options: NotifierOptions = {}) {
    const appId = options.feishuAppId || process.env.FEISHU_APP_ID || '';
    const appSecret = options.feishuAppSecret || process.env.FEISHU_APP_SECRET || '';
    this.defaultFeishuChatId = options.feishuChatId || process.env.FEISHU_NOTIFY_CHAT_ID || '';

    if (appId && appSecret) {
      this.feishuClient = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });
    }
  }

  /**
   * 发送通知
   * @param title 通知标题
   * @param body 通知内容
   * @param channels 通知渠道列表
   * @param feishuChatId 可选的飞书 chat_id（覆盖默认值）
   */
  async send(
    title: string,
    body: string,
    channels: ('desktop' | 'feishu')[],
    feishuChatId?: string,
  ): Promise<void> {
    const errors: string[] = [];

    for (const channel of channels) {
      try {
        if (channel === 'desktop') {
          await this.sendDesktop(title, body);
        } else if (channel === 'feishu') {
          await this.sendFeishu(title, body, feishuChatId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${channel}] ${msg}`);
      }
    }

    if (errors.length > 0) {
      console.error(`[Daemon Notifier] Partial failures:\n${errors.join('\n')}`);
    }
  }

  private async sendDesktop(title: string, body: string): Promise<void> {
    // node-notifier 是 CJS 模块，动态 import
    const notifier = await import('node-notifier');
    const notify = notifier.default || notifier;

    return new Promise<void>((resolve, reject) => {
      notify.notify(
        {
          title,
          message: body.length > 500 ? body.slice(0, 497) + '...' : body,
          sound: true,
        },
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  private async sendFeishu(title: string, body: string, chatId?: string): Promise<void> {
    const targetChatId = chatId || this.defaultFeishuChatId;

    if (!this.feishuClient) {
      console.warn('[Daemon Notifier] Feishu not configured (missing FEISHU_APP_ID / FEISHU_APP_SECRET). Skipping feishu notification.');
      return;
    }

    if (!targetChatId) {
      console.warn('[Daemon Notifier] No feishu chat_id configured (set FEISHU_NOTIFY_CHAT_ID). Skipping feishu notification.');
      return;
    }

    const text = `[Daemon] ${title}\n\n${body}`;

    await this.feishuClient.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: targetChatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }
}
