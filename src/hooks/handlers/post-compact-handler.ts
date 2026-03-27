/**
 * PostCompact Hook Handler
 * Context 压缩后触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * PostCompact Handler 配置
 */
export interface PostCompactHandlerConfig extends HandlerConfig {
  /** 是否记录压缩统计 */
  logStats?: boolean;
  /** 压缩阈值（仅当压缩比例超过此值时触发） */
  compressionThreshold?: number; // 0-1，例如 0.5 表示压缩至少 50%
}

/**
 * PostCompact Hook Handler
 * 处理 Context 压缩完成后的回调
 */
export class PostCompactHandler extends BaseHookHandler {
  private config: PostCompactHandlerConfig;

  constructor(config: PostCompactHandlerConfig = {}) {
    super({
      name: 'PostCompactHandler',
      timeout: 30000, // 30 seconds
      silent: true,
      ...config,
    });
    this.config = config;
  }

  async execute(input: HookInput): Promise<HookResult> {
    // 验证必要字段
    if (input.originalTokens === undefined || input.compressedTokens === undefined) {
      return {
        success: false,
        error: 'PostCompact requires originalTokens and compressedTokens',
      };
    }

    // 检查压缩阈值
    if (this.config.compressionThreshold !== undefined) {
      const ratio = input.compressedTokens / input.originalTokens;
      if (ratio > this.config.compressionThreshold) {
        // 压缩不足，跳过处理
        return {
          success: true,
          output: `Compression ratio ${ratio.toFixed(2)} did not meet threshold`,
        };
      }
    }

    // 记录统计信息
    if (this.config.logStats !== false) {
      const ratio = ((1 - input.compressedTokens / input.originalTokens) * 100).toFixed(2);
      const stats = {
        event: 'PostCompact',
        originalTokens: input.originalTokens,
        compressedTokens: input.compressedTokens,
        compressionRatio: input.compressionRatio || input.compressedTokens / input.originalTokens,
        savedTokens: input.originalTokens - input.compressedTokens,
        compressionPercentage: `${ratio}%`,
      };

      return {
        success: true,
        output: JSON.stringify(stats),
      };
    }

    return {
      success: true,
      output: 'PostCompact handled successfully',
    };
  }
}
