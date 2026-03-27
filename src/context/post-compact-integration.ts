/**
 * PostCompact Hook 集成
 * 实现 AXON v2.1.85 中的 Context 压缩后回调机制
 *
 * 触发流程：
 * 1. Context 压缩完成
 * 2. 计算压缩指标（originalTokens, compressedTokens, compressionRatio）
 * 3. 触发 PostCompact Hook
 * 4. Hook 处理压缩结果（记录日志、更新 Memory 等）
 *
 * Hook 输入：
 * - event: 'PostCompact'
 * - originalTokens: 压缩前 token 数
 * - compressedTokens: 压缩后 token 数
 * - compressionRatio: 压缩率
 * - summary: 压缩摘要
 *
 * 错误处理：
 * - Hook 执行失败不中断主流程
 * - 失败日志记录以备调试
 * - 支持 timeout 和 retry
 */

import type { HookInput, HookResult } from '../hooks/index.js';

/**
 * PostCompact Hook 配置
 */
export interface PostCompactHookConfig {
  enabled?: boolean;
  logStats?: boolean;
  compressionThreshold?: number; // 0-1
  timeout?: number; // 毫秒
}

/**
 * PostCompact 事件输入
 */
export interface PostCompactInput {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio?: number;
  summary?: string;
  sessionId?: string;
  timestamp?: Date;
}

/**
 * PostCompact 事件结果
 */
export interface PostCompactEventResult {
  success: boolean;
  hookSuccess: boolean;
  hookOutput?: string;
  hookError?: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  savedTokens: number;
  timestamp: Date;
}

/**
 * Hook 执行器接口（用于依赖注入）
 */
export interface HookExecutor {
  executeHook(input: HookInput, options?: { timeout?: number }): Promise<HookResult>;
}

/**
 * PostCompact Hook 执行器
 */
export class PostCompactExecutor {
  private hookExecutor: HookExecutor | null = null;
  private config: PostCompactHookConfig = {
    enabled: true,
    logStats: true,
    compressionThreshold: undefined,
    timeout: 30000,
  };

  constructor(hookExecutor?: HookExecutor, config?: PostCompactHookConfig) {
    this.hookExecutor = hookExecutor || null;
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * 设置 Hook 执行器（用于延迟初始化）
   */
  setHookExecutor(hookExecutor: HookExecutor): void {
    this.hookExecutor = hookExecutor;
  }

  /**
   * 执行 PostCompact 事件处理
   */
  async execute(input: PostCompactInput): Promise<PostCompactEventResult> {
    const timestamp = input.timestamp || new Date();
    const compressionRatio = input.compressionRatio ||
      (input.originalTokens > 0 ? input.compressedTokens / input.originalTokens : 1);
    const savedTokens = input.originalTokens - input.compressedTokens;

    const result: PostCompactEventResult = {
      success: true,
      hookSuccess: true,
      originalTokens: input.originalTokens,
      compressedTokens: input.compressedTokens,
      compressionRatio,
      savedTokens,
      timestamp,
    };

    // 检查压缩阈值
    if (this.config.compressionThreshold !== undefined) {
      if (compressionRatio > this.config.compressionThreshold) {
        // 压缩不足，跳过 Hook 触发
        return result;
      }
    }

    // 触发 Hook（如果配置了）
    if (this.config.enabled && this.hookExecutor) {
      try {
        const hookInput: HookInput = {
          event: 'PostCompact',
          originalTokens: input.originalTokens,
          compressedTokens: input.compressedTokens,
          compressionRatio,
          summary: input.summary,
          sessionId: input.sessionId,
        };

        const hookResult = await this.hookExecutor.executeHook(hookInput, {
          timeout: this.config.timeout,
        });

        result.hookSuccess = hookResult.success;
        result.hookOutput = hookResult.output;
        result.hookError = hookResult.error;

        // 记录统计信息（如果启用）
        if (this.config.logStats) {
          this.logStats({
            originalTokens: input.originalTokens,
            compressedTokens: input.compressedTokens,
            compressionRatio,
            savedTokens,
            timestamp,
          });
        }
      } catch (error) {
        // Hook 执行失败，记录错误但不中断主流程
        result.hookSuccess = false;
        result.hookError = error instanceof Error ? error.message : String(error);
        console.warn('[PostCompact] Hook execution failed:', result.hookError);
      }
    } else if (this.config.logStats) {
      // 即使没有 Hook 执行器，也要记录统计信息
      this.logStats({
        originalTokens: input.originalTokens,
        compressedTokens: input.compressedTokens,
        compressionRatio,
        savedTokens,
        timestamp,
      });
    }

    return result;
  }

  /**
   * 记录压缩统计信息
   */
  private logStats(stats: {
    originalTokens: number;
    compressedTokens: number;
    compressionRatio: number;
    savedTokens: number;
    timestamp: Date;
  }): void {
    const ratio = ((1 - stats.compressionRatio) * 100).toFixed(2);
    console.log('[PostCompact] Compression stats:', {
      event: 'PostCompact',
      originalTokens: stats.originalTokens,
      compressedTokens: stats.compressedTokens,
      compressionRatio: stats.compressionRatio.toFixed(4),
      savedTokens: stats.savedTokens,
      compressionPercentage: `${ratio}%`,
      timestamp: stats.timestamp.toISOString(),
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PostCompactHookConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PostCompactHookConfig {
    return { ...this.config };
  }
}

/**
 * 创建默认的 PostCompact 执行器
 */
export function createDefaultPostCompactExecutor(
  hookExecutor?: HookExecutor
): PostCompactExecutor {
  return new PostCompactExecutor(hookExecutor, {
    enabled: true,
    logStats: true,
    timeout: 30000,
  });
}
