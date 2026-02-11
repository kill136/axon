/**
 * 飞书会话管理器
 * 为每个 (群聊, 用户) 对维护独立的 ConversationLoop 实例
 * 处理会话生命周期、消息队列和速率限制
 */

import { ConversationLoop } from '../core/loop.js';
import type { FeishuBotConfig } from './config.js';

interface SessionEntry {
  /** ConversationLoop 实例 */
  loop: ConversationLoop;
  /** 最后活跃时间 */
  lastActive: number;
  /** 对话轮数 */
  turns: number;
  /** 消息处理队列（确保串行处理） */
  queue: Array<{
    input: string;
    resolve: (value: string) => void;
    reject: (reason: Error) => void;
  }>;
  /** 是否正在处理消息 */
  processing: boolean;
}

interface RateLimitEntry {
  /** 时间窗口内的请求时间戳 */
  timestamps: number[];
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private dailyCost = 0;
  private dailyCostResetTime = Date.now();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private config: FeishuBotConfig) {
    // 定期清理过期会话
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * 生成会话键
   */
  private getSessionKey(chatId: string | null, userId: string): string {
    return chatId ? `chat:${chatId}:user:${userId}` : `dm:${userId}`;
  }

  /**
   * 检查速率限制
   * @returns 错误消息（如果被限制），null 表示通过
   */
  checkRateLimit(userId: string): string | null {
    // 检查每日预算
    if (Date.now() - this.dailyCostResetTime > 24 * 60 * 60 * 1000) {
      this.dailyCost = 0;
      this.dailyCostResetTime = Date.now();
    }
    if (this.dailyCost >= this.config.dailyBudgetUSD) {
      return '今日使用额度已用完，请明天再试。';
    }

    // 检查每用户速率
    const now = Date.now();
    const windowMs = 60 * 1000;

    let entry = this.rateLimits.get(userId);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(userId, entry);
    }

    // 清除过期时间戳
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    if (entry.timestamps.length >= this.config.rateLimitPerMinute) {
      const waitSec = Math.ceil((entry.timestamps[0] + windowMs - now) / 1000);
      return `请求过于频繁，请 ${waitSec} 秒后再试。`;
    }

    entry.timestamps.push(now);
    return null;
  }

  /**
   * 获取或创建会话的 ConversationLoop
   */
  private getOrCreateSession(chatId: string | null, userId: string): SessionEntry {
    const key = this.getSessionKey(chatId, userId);
    let entry = this.sessions.get(key);

    if (entry) {
      // 检查是否超时
      if (Date.now() - entry.lastActive > this.config.sessionTimeout) {
        this.sessions.delete(key);
        entry = undefined;
      }
      // 检查是否超过最大轮数
      if (entry && entry.turns >= this.config.maxSessionTurns) {
        this.sessions.delete(key);
        entry = undefined;
      }
    }

    if (!entry) {
      const loop = new ConversationLoop({
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        systemPrompt: this.config.systemPrompt,
        permissionMode: 'bypassPermissions',
        allowedTools: this.config.allowedTools,
        workingDir: this.config.workingDir,
        maxTurns: 10,
        verbose: false,
        isSubAgent: false,
      });

      entry = {
        loop,
        lastActive: Date.now(),
        turns: 0,
        queue: [],
        processing: false,
      };
      this.sessions.set(key, entry);
    }

    return entry;
  }

  /**
   * 处理消息（自动排队，保证串行）
   */
  async processMessage(
    chatId: string | null,
    userId: string,
    input: string,
  ): Promise<string> {
    const entry = this.getOrCreateSession(chatId, userId);

    return new Promise<string>((resolve, reject) => {
      entry.queue.push({ input, resolve, reject });
      this.drainQueue(entry);
    });
  }

  /**
   * 消费队列中的消息
   */
  private async drainQueue(entry: SessionEntry): Promise<void> {
    if (entry.processing || entry.queue.length === 0) return;

    entry.processing = true;
    const task = entry.queue.shift()!;

    try {
      entry.lastActive = Date.now();
      entry.turns++;

      const response = await entry.loop.processMessage(task.input);
      task.resolve(response);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.resolve(`处理消息时出错: ${errorMsg}`);
    } finally {
      entry.processing = false;
      this.drainQueue(entry);
    }
  }

  /**
   * 重置指定会话
   */
  resetSession(chatId: string | null, userId: string): void {
    const key = this.getSessionKey(chatId, userId);
    this.sessions.delete(key);
  }

  /**
   * 清理过期会话
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastActive > this.config.sessionTimeout) {
        this.sessions.delete(key);
      }
    }
    for (const [key, entry] of this.rateLimits) {
      entry.timestamps = entry.timestamps.filter(t => now - t < 60 * 1000);
      if (entry.timestamps.length === 0) {
        this.rateLimits.delete(key);
      }
    }
  }

  /**
   * 增加每日费用
   */
  addDailyCost(cost: number): void {
    this.dailyCost += cost;
  }

  /**
   * 获取活跃会话数
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 销毁所有会话
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
    this.rateLimits.clear();
  }
}
