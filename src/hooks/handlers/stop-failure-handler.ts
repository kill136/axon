/**
 * StopFailure Hook Handler
 * API 错误导致 turn 结束时触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * StopFailure Handler 配置
 */
export interface StopFailureHandlerConfig extends HandlerConfig {
  /** 是否自动重试 */
  autoRetry?: boolean;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 错误通知 URL */
  notificationUrl?: string;
}

/**
 * StopFailure Hook Handler
 * 处理 API 错误或其他导致 turn 失败的情况
 */
export class StopFailureHandler extends BaseHookHandler {
  private config: StopFailureHandlerConfig;
  private retryCount: number = 0;

  constructor(config: StopFailureHandlerConfig = {}) {
    super({
      name: 'StopFailureHandler',
      timeout: 60000, // 60 seconds
      silent: true,
      ...config,
    });
    this.config = {
      maxRetries: 3,
      retryDelay: 5000,
      ...config,
    };
  }

  async execute(input: HookInput): Promise<HookResult> {
    // 验证必要字段
    if (!input.stopReason) {
      return {
        success: false,
        error: 'StopFailure requires stopReason',
      };
    }

    // 分析错误类型
    const errorAnalysis = this.analyzeError(input);

    // 如果启用自动重试，检查是否应该重试
    if (this.config.autoRetry && this.shouldRetry(input)) {
      this.retryCount++;

      if (this.retryCount <= (this.config.maxRetries || 3)) {
        // 延迟后重试
        await this.delay(this.config.retryDelay || 5000);

        return {
          success: true,
          output: JSON.stringify({
            action: 'retry',
            retry_count: this.retryCount,
            retry_reason: errorAnalysis.recoverable,
            next_retry_delay_ms: this.config.retryDelay,
          }),
        };
      }

      // 已达到最大重试次数
      return {
        success: false,
        error: `Max retries (${this.config.maxRetries}) exceeded`,
      };
    }

    // 发送错误通知
    if (this.config.notificationUrl) {
      try {
        await this.sendNotification(this.config.notificationUrl, {
          stop_reason: input.stopReason,
          error: input.apiError || 'Unknown error',
          http_status: input.httpStatus,
          analysis: errorAnalysis,
        });
      } catch (err) {
        console.warn('Failed to send error notification:', err);
      }
    }

    return {
      success: true,
      output: JSON.stringify({
        action: 'error_handled',
        stop_reason: input.stopReason,
        error_analysis: errorAnalysis,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * 分析错误
   */
  private analyzeError(input: HookInput): {
    type: string;
    recoverable: boolean;
    severity: 'low' | 'medium' | 'high';
  } {
    const stopReason = input.stopReason || 'unknown';
    const httpStatus = input.httpStatus || 0;

    let type = stopReason;
    let recoverable = false;
    let severity: 'low' | 'medium' | 'high' = 'medium';

    // 根据 HTTP 状态码判断
    if (httpStatus >= 500 && httpStatus < 600) {
      // 服务器错误，可能可恢复
      type = 'server_error';
      recoverable = true;
      severity = httpStatus === 529 ? 'medium' : 'high';
    } else if (httpStatus === 429) {
      // 速率限制
      type = 'rate_limit';
      recoverable = true;
      severity = 'low';
    } else if (httpStatus === 401 || httpStatus === 403) {
      // 认证/授权错误
      type = 'auth_error';
      recoverable = false;
      severity = 'high';
    } else if (httpStatus === 408 || httpStatus === 504) {
      // 超时
      type = 'timeout';
      recoverable = true;
      severity = 'medium';
    }

    // 根据 stopReason 进一步调整
    if (stopReason === 'timeout') {
      type = 'timeout';
      recoverable = true;
      severity = 'medium';
    } else if (stopReason === 'quota_exceeded') {
      type = 'quota_exceeded';
      recoverable = false;
      severity = 'high';
    }

    return { type, recoverable, severity };
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(input: HookInput): boolean {
    const stopReason = input.stopReason || 'unknown';

    // 可重试的错误
    const retryableReasons = ['timeout', 'rate_limit', 'api_error'];

    return retryableReasons.includes(stopReason);
  }

  /**
   * 延迟（毫秒）
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 发送错误通知
   */
  private async sendNotification(
    url: string,
    event: Record<string, unknown>
  ): Promise<void> {
    // 这里可以使用 fetch 发送通知
    try {
      // 示例：
      // await fetch(url, { method: 'POST', body: JSON.stringify(event) });
    } catch (err) {
      throw err;
    }
  }
}
