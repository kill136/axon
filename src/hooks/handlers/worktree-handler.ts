/**
 * Worktree Hook Handlers
 * WorktreeCreate - Worktree 创建时触发
 * WorktreeRemove - Worktree 删除时触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * Worktree Handler 配置
 */
export interface WorktreeHandlerConfig extends HandlerConfig {
  /** 是否记录事件 */
  logEvent?: boolean;
  /** 回调 URL（可选） */
  callbackUrl?: string;
}

/**
 * WorktreeCreate Hook Handler
 * 处理 Worktree 创建事件
 */
export class WorktreeCreateHandler extends BaseHookHandler {
  constructor(config: WorktreeHandlerConfig = {}) {
    super({
      name: 'WorktreeCreateHandler',
      timeout: 30000, // 30 seconds
      silent: true,
      ...config,
    });
  }

  async execute(input: HookInput): Promise<HookResult> {
    // Cast config to access extended properties
    const cfg = this.config as unknown as WorktreeHandlerConfig;

    // 验证必要字段
    if (!input.worktreePath || !input.worktreeName) {
      return {
        success: false,
        error: 'WorktreeCreate requires worktreePath and worktreeName',
      };
    }

    const event = {
      type: 'worktree_created',
      worktree_name: input.worktreeName,
      worktree_path: input.worktreePath,
      branch_name: input.branchName || 'unknown',
      timestamp: new Date().toISOString(),
    };

    if (cfg.logEvent !== false) {
      // 这里可以进行日志记录
    }

    // 如果配置了回调 URL，可以发送通知
    if (cfg.callbackUrl) {
      try {
        await this.sendCallback(cfg.callbackUrl, event);
      } catch (err) {
        // 回调失败不应该中断主流程
        console.warn('Worktree create callback failed:', err);
      }
    }

    return {
      success: true,
      output: JSON.stringify(event),
    };
  }

  /**
   * 发送回调通知
   */
  private async sendCallback(url: string, event: Record<string, unknown>): Promise<void> {
    // 这里可以使用 fetch 或其他 HTTP 客户端
    // 示例实现
    try {
      // 非阻塞的 fetch（可选）
      // await fetch(url, { method: 'POST', body: JSON.stringify(event) });
    } catch (err) {
      throw err;
    }
  }
}

/**
 * WorktreeRemove Hook Handler
 * 处理 Worktree 删除事件
 */
export class WorktreeRemoveHandler extends BaseHookHandler {
  constructor(config: WorktreeHandlerConfig = {}) {
    super({
      name: 'WorktreeRemoveHandler',
      timeout: 30000, // 30 seconds
      silent: true,
      ...config,
    });
  }

  async execute(input: HookInput): Promise<HookResult> {
    // Cast config to access extended properties
    const cfg = this.config as unknown as WorktreeHandlerConfig;

    // 验证必要字段
    if (!input.worktreePath || !input.worktreeName) {
      return {
        success: false,
        error: 'WorktreeRemove requires worktreePath and worktreeName',
      };
    }

    const event = {
      type: 'worktree_removed',
      worktree_name: input.worktreeName,
      worktree_path: input.worktreePath,
      timestamp: new Date().toISOString(),
    };

    if (cfg.logEvent !== false) {
      // 这里可以进行日志记录和清理
    }

    // 如果配置了回调 URL，可以发送通知
    if (cfg.callbackUrl) {
      try {
        await this.sendCallback(cfg.callbackUrl, event);
      } catch (err) {
        // 回调失败不应该中断主流程
        console.warn('Worktree remove callback failed:', err);
      }
    }

    return {
      success: true,
      output: JSON.stringify(event),
    };
  }

  /**
   * 发送回调通知
   */
  private async sendCallback(url: string, event: Record<string, unknown>): Promise<void> {
    // 这里可以使用 fetch 或其他 HTTP 客户端
    try {
      // 非阻塞的 fetch（可选）
      // await fetch(url, { method: 'POST', body: JSON.stringify(event) });
    } catch (err) {
      throw err;
    }
  }
}
