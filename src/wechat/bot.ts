/**
 * 微信 Bot 主模块
 * 基于 Wechaty 框架，将微信消息桥接到 Claude Code 核心引擎
 */

import { WechatyBuilder, ScanStatus } from 'wechaty';
import type { Wechaty, Message as WechatyMessage, Contact, Room } from 'wechaty';
import chalk from 'chalk';
import { SessionManager } from './session-manager.js';
import {
  extractUserInput,
  shouldRespond,
  removeTriggerKeyword,
  formatResponse,
  splitMessage,
  handleBuiltinCommand,
} from './message-handler.js';
import type { WeChatBotConfig } from './config.js';

export class WeChatBot {
  private bot: Wechaty;
  private sessionManager: SessionManager;
  private config: WeChatBotConfig;
  private botName = '';

  constructor(config: WeChatBotConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config);

    this.bot = WechatyBuilder.build({
      name: 'claude-wechat-bot',
      puppet: config.puppet as any,
      puppetOptions: config.puppetOptions,
    });

    this.setupEventHandlers();
  }

  /**
   * 设置 Wechaty 事件处理器
   */
  private setupEventHandlers(): void {
    // 扫码登录
    this.bot.on('scan', (qrcode: string, status: ScanStatus) => {
      if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
        const qrcodeUrl = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
        console.log(chalk.cyan('\n╔══════════════════════════════════════╗'));
        console.log(chalk.cyan('║     扫描二维码登录微信              ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════╣'));
        console.log(chalk.cyan('║  用微信扫描以下链接中的二维码:      ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════╝'));
        console.log(chalk.yellow(`\n${qrcodeUrl}\n`));

        // 尝试在终端直接显示二维码（如果安装了 qrcode-terminal）
        try {
          // 动态导入，不强制依赖
          (import('qrcode-terminal' as string) as Promise<any>).then((qrt: any) => {
            qrt.default.generate(qrcode, { small: true });
          }).catch(() => {
            // qrcode-terminal 未安装，使用 URL 即可
          });
        } catch {
          // 忽略
        }
      }
    });

    // 登录成功
    this.bot.on('login', (user: Contact) => {
      this.botName = user.name();
      console.log(chalk.green(`\n✓ 登录成功: ${this.botName}`));
      console.log(chalk.gray(`  模型: ${this.config.model}`));
      console.log(chalk.gray(`  工作目录: ${this.config.workingDir}`));
      console.log(chalk.gray(`  允许工具: ${this.config.allowedTools.join(', ')}`));
      console.log(chalk.gray(`  速率限制: ${this.config.rateLimitPerMinute} 次/分钟`));
      console.log(chalk.gray(`  每日预算: $${this.config.dailyBudgetUSD}`));
      console.log(chalk.green('\n✓ Bot 已启动，等待消息...\n'));
    });

    // 登出
    this.bot.on('logout', (user: Contact) => {
      console.log(chalk.yellow(`\n⚠ 已登出: ${user.name()}`));
    });

    // 消息处理
    this.bot.on('message', async (msg: WechatyMessage) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        console.error(chalk.red('[Error] 消息处理失败:'), err);
      }
    });

    // 错误处理
    this.bot.on('error', (err: Error) => {
      console.error(chalk.red('[Error] Wechaty 错误:'), err.message);
    });
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(msg: WechatyMessage): Promise<void> {
    // 忽略自己发的消息
    if (msg.self()) return;

    // 只处理文本消息
    const msgType = msg.type();
    // Wechaty MessageType.Text = 7
    if (msgType !== 7) return;

    const text = msg.text();
    if (!text || text.trim().length === 0) return;

    const talker = msg.talker();
    const room = msg.room();
    const userId = talker.id;
    const roomId = room ? room.id : null;
    const isRoom = !!room;
    const isPrivate = !isRoom;

    // 检查是否被 @
    let isMentioned = false;
    if (room) {
      try {
        isMentioned = await msg.mentionSelf();
      } catch {
        // 某些 puppet 不支持 mentionSelf
        isMentioned = text.includes(`@${this.botName}`);
      }
    }

    // 判断是否应该响应
    if (!shouldRespond(text, isMentioned, isRoom, isPrivate, this.config)) {
      return;
    }

    // 提取用户输入
    let userInput = text;
    if (isRoom && isMentioned) {
      userInput = extractUserInput(text, this.botName);
    }
    if (this.config.triggerKeyword) {
      userInput = removeTriggerKeyword(userInput, this.config.triggerKeyword);
    }

    if (!userInput || userInput.trim().length === 0) {
      return;
    }

    const talkerName = talker.name();
    const roomName = room ? await room.topic() : '私聊';
    console.log(chalk.blue(`[${roomName}] ${talkerName}: ${userInput.slice(0, 100)}${userInput.length > 100 ? '...' : ''}`));

    // 处理内置命令
    const builtinResponse = handleBuiltinCommand(userInput);
    if (builtinResponse) {
      if (builtinResponse === '__RESET_SESSION__') {
        this.sessionManager.resetSession(roomId, userId);
        await this.reply(msg, room, '对话历史已清除。');
        return;
      }
      if (builtinResponse === '状态查询已触发') {
        const status = [
          `活跃会话数: ${this.sessionManager.getActiveSessionCount()}`,
          `当前模型: ${this.config.model}`,
          `工作目录: ${this.config.workingDir}`,
        ].join('\n');
        await this.reply(msg, room, status);
        return;
      }
      await this.reply(msg, room, builtinResponse);
      return;
    }

    // 速率限制检查
    const rateLimitMsg = this.sessionManager.checkRateLimit(userId);
    if (rateLimitMsg) {
      await this.reply(msg, room, rateLimitMsg);
      return;
    }

    // 发送 "思考中" 提示
    await this.reply(msg, room, '思考中...');

    // 调用 Claude 处理
    try {
      const response = await this.sessionManager.processMessage(roomId, userId, userInput);

      // 格式化响应
      const formatted = formatResponse(response);

      // 分割长消息
      const chunks = splitMessage(formatted, this.config.maxMessageLength);

      for (const chunk of chunks) {
        await this.reply(msg, room, chunk);
        // 多段消息之间稍作延迟，避免发送过快
        if (chunks.length > 1) {
          await sleep(500);
        }
      }

      console.log(chalk.green(`  ↳ 回复 ${formatted.length} 字 (${chunks.length} 段)`));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`  ↳ 错误: ${errMsg}`));
      await this.reply(msg, room, `处理出错: ${errMsg}`);
    }
  }

  /**
   * 回复消息
   */
  private async reply(msg: WechatyMessage, room: Room | null, text: string): Promise<void> {
    try {
      if (room) {
        await room.say(text);
      } else {
        await msg.say(text);
      }
    } catch (err) {
      console.error(chalk.red('[Error] 发送回复失败:'), err);
    }
  }

  /**
   * 启动 Bot
   */
  async start(): Promise<void> {
    console.log(chalk.cyan('\n🤖 Claude Code 微信 Bot 启动中...\n'));
    console.log(chalk.gray(`Puppet: ${this.config.puppet}`));
    await this.bot.start();
  }

  /**
   * 停止 Bot
   */
  async stop(): Promise<void> {
    console.log(chalk.yellow('\n正在停止 Bot...'));
    this.sessionManager.destroy();
    await this.bot.stop();
    console.log(chalk.green('Bot 已停止'));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
