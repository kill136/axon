/**
 * 飞书 Bot 主模块
 * 基于飞书官方 SDK，将飞书消息桥接到 Claude Code 核心引擎
 * 支持两种模式：
 *   1. 独立模式：自建 SessionManager + ConversationLoop
 *   2. WebUI 模式：接入 WebUI 的 ConversationManager，共享同一个 agent
 */

import * as lark from '@larksuiteoapi/node-sdk';
import express from 'express';
import chalk from 'chalk';
import { SessionManager } from './session-manager.js';
import {
  extractUserInput,
  shouldRespond,
  formatResponse,
  splitMessage,
  handleBuiltinCommand,
} from './message-handler.js';
import type { FeishuBotConfig } from './config.js';
import type { FeishuMention } from './message-handler.js';

/** WebUI ConversationManager 的最小接口（避免直接依赖 web server） */
export interface ConversationManagerLike {
  chat(
    sessionId: string,
    content: string,
    mediaAttachments: undefined,
    model: string,
    callbacks: {
      onTextDelta?: (text: string) => void;
      onComplete?: (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => void;
      onError?: (error: Error) => void;
    },
    projectPath?: string,
    ws?: unknown,
    permissionMode?: string,
  ): Promise<void>;
  getHistory(sessionId: string): any[];
  listPersistedSessions(options?: any): any[];
}

export interface FeishuBotOptions {
  config: FeishuBotConfig;
  /** WebUI 模式：提供 ConversationManager 实例 */
  conversationManager?: ConversationManagerLike;
  /** WebUI 模式：使用的会话 ID（不传则自动创建 feishu-bot 专用会话） */
  sessionId?: string;
}

export class FeishuBot {
  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private sessionManager: SessionManager | null = null;
  private conversationManager: ConversationManagerLike | null = null;
  private webuiSessionId: string;
  private config: FeishuBotConfig;
  /** 已处理的消息 ID（用于去重） */
  private processedMessages = new Set<string>();
  private dedupeCleanupTimer: ReturnType<typeof setInterval>;

  constructor(options: FeishuBotOptions) {
    this.config = options.config;

    if (options.conversationManager) {
      // WebUI 模式：接入已有的 ConversationManager
      this.conversationManager = options.conversationManager;
      this.webuiSessionId = options.sessionId || 'feishu-bot';
    } else {
      // 独立模式：自建 SessionManager
      this.sessionManager = new SessionManager(options.config);
      this.webuiSessionId = '';
    }

    this.client = new lark.Client({
      appId: options.config.appId,
      appSecret: options.config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    // 定期清理去重缓存（每 60 秒清空）
    this.dedupeCleanupTimer = setInterval(() => {
      this.processedMessages.clear();
    }, 60 * 1000);
  }

  /** 是否为 WebUI 桥接模式 */
  get isWebUIMode(): boolean {
    return this.conversationManager !== null;
  }

  /**
   * 创建事件分发器
   */
  private createEventDispatcher(): lark.EventDispatcher {
    const dispatcherConfig: any = {};
    if (this.config.encryptKey) {
      dispatcherConfig.encryptKey = this.config.encryptKey;
    }
    if (this.config.verificationToken) {
      dispatcherConfig.verificationToken = this.config.verificationToken;
    }

    const dispatcher = new lark.EventDispatcher(dispatcherConfig);

    dispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        try {
          await this.handleMessageEvent(data);
        } catch (err) {
          console.error(chalk.red('[Error] 消息处理失败:'), err);
        }
      },
    });

    return dispatcher;
  }

  /**
   * 通过 ConversationManager 处理消息（WebUI 模式）
   */
  private async processViaWebUI(userInput: string): Promise<string> {
    const cm = this.conversationManager!;
    let fullText = '';

    await cm.chat(
      this.webuiSessionId,
      userInput,
      undefined,
      this.config.model,
      {
        onTextDelta: (text: string) => {
          fullText += text;
        },
        onError: (error: Error) => {
          throw error;
        },
      },
      this.config.workingDir,
      undefined,
      'bypassPermissions',
    );

    return fullText;
  }

  /**
   * 处理收到的消息事件
   */
  private async handleMessageEvent(data: any): Promise<void> {
    const message = data.message;
    const sender = data.sender;

    if (!message || !sender) return;

    // 消息去重
    const messageId = message.message_id;
    if (this.processedMessages.has(messageId)) return;
    this.processedMessages.add(messageId);

    // 只处理文本消息
    if (message.message_type !== 'text') return;

    // 解析消息内容
    let rawText: string;
    try {
      const contentObj = JSON.parse(message.content);
      rawText = contentObj.text || '';
    } catch {
      return;
    }

    if (!rawText.trim()) return;

    const chatId = message.chat_id;
    const chatType = message.chat_type; // "p2p" 或 "group"
    const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';

    const isGroup = chatType === 'group';
    const isPrivate = chatType === 'p2p';

    // 检查是否被 @提及
    const mentions: FeishuMention[] = message.mentions || [];
    const isMentioned = mentions.length > 0;

    // 判断是否应该响应
    if (!shouldRespond(isGroup, isPrivate, isMentioned, this.config)) {
      return;
    }

    // 提取用户输入（移除 @提及 占位符）
    let userInput = extractUserInput(rawText, mentions);
    if (!userInput.trim()) return;

    const senderName = sender.sender_id?.open_id || 'unknown';
    const chatLabel = isGroup ? `群聊:${chatId}` : '私聊';
    console.log(chalk.blue(`[${chatLabel}] ${senderName}: ${userInput.slice(0, 100)}${userInput.length > 100 ? '...' : ''}`));

    // 处理内置命令
    const builtinResponse = handleBuiltinCommand(userInput);
    if (builtinResponse) {
      if (builtinResponse === '__RESET_SESSION__') {
        if (this.sessionManager) {
          const roomId = isGroup ? chatId : null;
          this.sessionManager.resetSession(roomId, senderId);
        }
        await this.sendReply(chatId, '对话历史已清除。', messageId);
        return;
      }
      if (builtinResponse === '状态查询已触发') {
        const modeLabel = this.isWebUIMode ? 'WebUI 桥接' : '独立';
        const sessionCount = this.sessionManager?.getActiveSessionCount() ?? 'N/A (WebUI)';
        const status = [
          `运行模式: ${modeLabel}`,
          `活跃会话数: ${sessionCount}`,
          `当前模型: ${this.config.model}`,
          `工作目录: ${this.config.workingDir}`,
          this.isWebUIMode ? `WebUI Session: ${this.webuiSessionId}` : '',
        ].filter(Boolean).join('\n');
        await this.sendReply(chatId, status, messageId);
        return;
      }
      await this.sendReply(chatId, builtinResponse, messageId);
      return;
    }

    // 速率限制检查（仅独立模式）
    if (this.sessionManager) {
      const rateLimitMsg = this.sessionManager.checkRateLimit(senderId);
      if (rateLimitMsg) {
        await this.sendReply(chatId, rateLimitMsg, messageId);
        return;
      }
    }

    // 发送 "思考中" 提示
    await this.sendReply(chatId, '思考中...', messageId);

    // 调用 Claude 处理
    try {
      let response: string;

      if (this.conversationManager) {
        // WebUI 模式：通过 ConversationManager
        response = await this.processViaWebUI(userInput);
      } else {
        // 独立模式：通过 SessionManager
        const roomId = isGroup ? chatId : null;
        response = await this.sessionManager!.processMessage(roomId, senderId, userInput);
      }

      // 格式化响应
      const formatted = formatResponse(response);

      // 分割长消息
      const chunks = splitMessage(formatted, this.config.maxMessageLength);

      for (const chunk of chunks) {
        await this.sendMessage(chatId, chunk);
        if (chunks.length > 1) {
          await sleep(500);
        }
      }

      console.log(chalk.green(`  ↳ 回复 ${formatted.length} 字 (${chunks.length} 段)`));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`  ↳ 错误: ${errMsg}`));
      await this.sendMessage(chatId, `处理出错: ${errMsg}`);
    }
  }

  /**
   * 回复指定消息
   */
  private async sendReply(chatId: string, text: string, replyToMessageId: string): Promise<void> {
    try {
      await this.client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (err) {
      console.error(chalk.red('[Error] 发送飞书回复失败:'), err);
    }
  }

  /**
   * 向会话发送新消息
   */
  private async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (err) {
      console.error(chalk.red('[Error] 发送飞书消息失败:'), err);
    }
  }

  /**
   * 启动 Bot
   */
  async start(): Promise<void> {
    console.log(chalk.cyan('\n飞书 Bot 启动中...\n'));
    console.log(chalk.gray(`连接模式: ${this.config.connectionMode}`));
    console.log(chalk.gray(`运行模式: ${this.isWebUIMode ? `WebUI 桥接 (session: ${this.webuiSessionId})` : '独立'}`));

    const eventDispatcher = this.createEventDispatcher();

    if (this.config.connectionMode === 'websocket') {
      // WebSocket 长连接模式（无需公网 IP）
      this.wsClient = new lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.info,
      });

      await this.wsClient.start({ eventDispatcher });
      console.log(chalk.green('\n✓ WebSocket 长连接已建立'));
    } else {
      // HTTP Webhook 模式
      const app = express();
      app.use(express.json());

      app.use(
        this.config.webhookPath,
        lark.adaptExpress(eventDispatcher, { autoChallenge: true }),
      );

      await new Promise<void>((resolve) => {
        app.listen(this.config.webhookPort, () => {
          console.log(chalk.green(`\n✓ Webhook 服务器已启动: http://0.0.0.0:${this.config.webhookPort}${this.config.webhookPath}`));
          resolve();
        });
      });
    }

    console.log(chalk.green('✓ Bot 已启动，等待消息...\n'));
  }

  /**
   * 停止 Bot
   */
  async stop(): Promise<void> {
    console.log(chalk.yellow('\n正在停止 Bot...'));
    clearInterval(this.dedupeCleanupTimer);
    this.sessionManager?.destroy();
    if (this.wsClient) {
      this.wsClient.close();
    }
    console.log(chalk.green('Bot 已停止'));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
