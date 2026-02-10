/**
 * Extended Thinking 管理器
 * 实现思考预算、思考过程处理
 */

import type { ThinkingConfig, ThinkingResult } from './types.js';
import { ThinkingNotSupportedError } from './types.js';
import { modelConfig } from './config.js';

/**
 * 默认思考配置
 */
const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  enabled: false,
  budgetTokens: 10000,
  showThinking: false,
  timeout: 120000, // 2 分钟
};

/**
 * Extended Thinking 管理器
 */
export class ThinkingManager {
  private config: ThinkingConfig;
  private thinkingHistory: ThinkingResult[] = [];

  constructor(config?: Partial<ThinkingConfig>) {
    this.config = { ...DEFAULT_THINKING_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  configure(config: Partial<ThinkingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ThinkingConfig {
    return { ...this.config };
  }

  /**
   * 设置思考预算
   */
  setThinkingBudget(budget: number): void {
    if (budget < 0) {
      throw new Error('Thinking budget must be non-negative');
    }
    this.config.budgetTokens = budget;
  }

  /**
   * 获取当前思考预算
   */
  getThinkingBudget(): number {
    return this.config.budgetTokens || DEFAULT_THINKING_CONFIG.budgetTokens!;
  }

  /**
   * 检查模型是否支持 Extended Thinking
   */
  isSupported(modelId: string): boolean {
    return modelConfig.supportsExtendedThinking(modelId);
  }

  /**
   * 验证模型支持
   */
  validateSupport(modelId: string): void {
    if (!this.isSupported(modelId)) {
      throw new ThinkingNotSupportedError(modelId);
    }
  }

  /**
   * 获取 API 请求的思考参数
   */
  getThinkingParams(modelId: string, options?: { forceEnabled?: boolean }): {
    thinking?: {
      type: 'enabled';
      budget_tokens: number;
    };
  } | Record<string, never> {
    if (!this.config.enabled && !options?.forceEnabled) {
      return {};
    }

    if (!this.isSupported(modelId)) {
      console.warn(
        `Extended thinking not supported for model ${modelId}, skipping`
      );
      return {};
    }

    const capabilities = modelConfig.getCapabilities(modelId);
    let budgetTokens = this.config.budgetTokens || DEFAULT_THINKING_CONFIG.budgetTokens!;

    // 确保在有效范围内
    if (capabilities.thinkingBudgetRange) {
      budgetTokens = Math.max(
        capabilities.thinkingBudgetRange.min,
        Math.min(budgetTokens, capabilities.thinkingBudgetRange.max)
      );
    }

    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens,
      },
    };
  }

  /**
   * 处理思考响应
   */
  processThinkingResponse(response: {
    thinking?: string;
    thinking_tokens?: number;
  }, startTime: number): ThinkingResult | null {
    if (!response.thinking) {
      return null;
    }

    const result: ThinkingResult = {
      thinking: response.thinking,
      thinkingTokens: response.thinking_tokens || 0,
      thinkingTimeMs: Date.now() - startTime,
      budgetExhausted: false,
    };

    // 检查是否达到预算限制
    if (this.config.budgetTokens && result.thinkingTokens >= this.config.budgetTokens * 0.95) {
      result.budgetExhausted = true;
    }

    // 记录历史
    this.thinkingHistory.push(result);

    // 保留最近 50 条
    if (this.thinkingHistory.length > 50) {
      this.thinkingHistory = this.thinkingHistory.slice(-50);
    }

    return result;
  }

  /**
   * 格式化思考输出
   */
  formatThinking(thinking: string, options?: {
    maxLength?: number;
    showFull?: boolean;
  }): string {
    if (!thinking) {
      return '';
    }

    const maxLength = options?.maxLength || 500;
    const showFull = options?.showFull || this.config.showThinking;

    if (showFull) {
      return `<thinking>\n${thinking}\n</thinking>`;
    }

    // 截断长思考
    if (thinking.length > maxLength) {
      const truncated = thinking.slice(0, maxLength);
      return `<thinking>\n${truncated}...\n[Thinking truncated, ${thinking.length} total chars]\n</thinking>`;
    }

    return `<thinking>\n${thinking}\n</thinking>`;
  }

  /**
   * 获取思考历史
   */
  getHistory(): ThinkingResult[] {
    return [...this.thinkingHistory];
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.thinkingHistory = [];
  }

  /**
   * 获取思考统计
   */
  getStats(): {
    totalThinking: number;
    totalTokens: number;
    totalTimeMs: number;
    averageTokens: number;
    averageTimeMs: number;
    budgetExhaustedCount: number;
  } {
    if (this.thinkingHistory.length === 0) {
      return {
        totalThinking: 0,
        totalTokens: 0,
        totalTimeMs: 0,
        averageTokens: 0,
        averageTimeMs: 0,
        budgetExhaustedCount: 0,
      };
    }

    const totalTokens = this.thinkingHistory.reduce((sum, r) => sum + r.thinkingTokens, 0);
    const totalTimeMs = this.thinkingHistory.reduce((sum, r) => sum + r.thinkingTimeMs, 0);
    const budgetExhaustedCount = this.thinkingHistory.filter(r => r.budgetExhausted).length;

    return {
      totalThinking: this.thinkingHistory.length,
      totalTokens,
      totalTimeMs,
      averageTokens: Math.round(totalTokens / this.thinkingHistory.length),
      averageTimeMs: Math.round(totalTimeMs / this.thinkingHistory.length),
      budgetExhaustedCount,
    };
  }

  /**
   * 推荐思考预算
   */
  recommendBudget(taskComplexity: 'simple' | 'medium' | 'complex'): number {
    switch (taskComplexity) {
      case 'simple':
        return 2000;
      case 'medium':
        return 10000;
      case 'complex':
        return 50000;
      default:
        return DEFAULT_THINKING_CONFIG.budgetTokens!;
    }
  }

  /**
   * 启用 Extended Thinking
   */
  enable(budget?: number): void {
    this.config.enabled = true;
    if (budget !== undefined) {
      this.config.budgetTokens = budget;
    }
  }

  /**
   * 禁用 Extended Thinking
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * 全局 Extended Thinking 管理器
 */
export const thinkingManager = new ThinkingManager();
