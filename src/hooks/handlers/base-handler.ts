/**
 * Hook Handler 基类
 * 所有 Hook 处理器应继承此类
 */

import { HookInput, HookResult } from '../index.js';

/**
 * Hook Handler 配置
 */
export interface HandlerConfig {
  /** 处理器名称 */
  name?: string;
  /** 处理超时（毫秒，默认 10 分钟） */
  timeout?: number;
  /** 是否在错误时静默失败 */
  silent?: boolean;
}

/**
 * 基础 Hook Handler 类
 */
export abstract class BaseHookHandler {
  protected config: HandlerConfig;

  constructor(config: HandlerConfig) {
    this.config = {
      timeout: 600000, // 10 minutes
      silent: true,
      ...config,
    };
  }

  /**
   * 执行 Hook 处理逻辑（子类实现）
   */
  abstract execute(input: HookInput): Promise<HookResult>;

  /**
   * 安全执行 Hook 处理器（带错误隔离和超时）
   */
  async safeExecute(input: HookInput): Promise<HookResult> {
    return new Promise((resolve) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Handler "${this.config.name}" execution timed out`,
        });
      }, this.config.timeout);

      // 执行 handler
      this.execute(input)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeoutId);

          if (this.config.silent) {
            // 静默失败
            resolve({
              success: false,
              error: err.message || 'Unknown error',
            });
          } else {
            // 抛出错误
            resolve({
              success: false,
              error: err.message || 'Unknown error',
            });
          }
        });
    });
  }

  /**
   * 获取处理器配置
   */
  getConfig(): HandlerConfig {
    return this.config;
  }
}
