/**
 * ElicitationResult Hook Handler
 * 用户完成输入后触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * ElicitationResult Handler 配置
 */
export interface ElicitationResultHandlerConfig extends HandlerConfig {
  /** 是否验证用户输入 */
  validateInput?: boolean;
  /** 是否记录用户输入（安全考虑） */
  logInput?: boolean;
}

/**
 * ElicitationResult Hook Handler
 * 处理用户完成输入后的结果处理
 */
export class ElicitationResultHandler extends BaseHookHandler {
  private config: ElicitationResultHandlerConfig;

  constructor(config: ElicitationResultHandlerConfig = {}) {
    super({
      name: 'ElicitationResultHandler',
      timeout: 30000, // 30 seconds
      silent: true,
      ...config,
    });
    this.config = config;
  }

  async execute(input: HookInput): Promise<HookResult> {
    // 验证必要字段
    if (!input.userInput) {
      return {
        success: false,
        error: 'ElicitationResult requires userInput',
      };
    }

    // 验证用户输入
    if (this.config.validateInput !== false) {
      const validation = this.validateUserInput(input.userInput);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }
    }

    // 记录输入（如果启用且安全）
    if (this.config.logInput) {
      this.logUserInput(input);
    }

    // 返回处理结果
    return {
      success: true,
      output: JSON.stringify({
        action: 'processed',
        elicitation_id: input.elicitationId,
        fields_count: Object.keys(input.userInput).length,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * 验证用户输入
   */
  private validateUserInput(input: Record<string, unknown>): { valid: boolean; error?: string } {
    if (!input || typeof input !== 'object') {
      return { valid: false, error: 'Invalid input format' };
    }

    // 基本验证：确保至少有一个字段
    if (Object.keys(input).length === 0) {
      return { valid: false, error: 'No fields provided' };
    }

    return { valid: true };
  }

  /**
   * 记录用户输入（安全版本，不记录敏感字段）
   */
  private logUserInput(input: HookInput): void {
    const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'private_key'];
    const sanitized = { ...input.userInput };

    // 移除敏感字段
    for (const field of sensitiveFields) {
      for (const key in sanitized) {
        if (key.toLowerCase().includes(field)) {
          delete sanitized[key];
        }
      }
    }

    // 这里可以进行日志记录，但示例中省略
  }
}
