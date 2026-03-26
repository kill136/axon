/**
 * 模型配置模块
 * 实现模型能力检测、回退机制、Extended Thinking 支持
 */

export { ModelConfig, modelConfig } from './config.js';
export { ModelFallback, modelFallback } from './fallback.js';
export { ModelStats, modelStats } from './stats.js';
export { ThinkingManager, thinkingManager } from './thinking.js';
export { QuotaManager, quotaManager } from './quota.js';
export { SubagentModelConfig, subagentModelConfig, AGENT_TYPES, type ModelSelectionStrategy } from './subagent-config.js';
export {
  getOfficialModelLimits,
  getResolvedModelContextWindow,
  getResolvedModelOutputTokenLimits,
  type ModelOutputTokenLimits,
} from './model-limits.js';
export type {
  ModelInfo,
  ModelCapabilities,
  ModelPricing,
  ThinkingConfig,
  ThinkingResult,
  ModelUsageStats,
  FallbackConfig,
  QuotaType,
  AlertLevel,
  CostAlert,
  QuotaLimit,
  UsageInfo,
  BudgetStatus,
  ThresholdCallback,
  LimitExceededCallback,
} from './types.js';
