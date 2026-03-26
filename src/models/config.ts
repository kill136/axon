/**
 * 模型配置管理
 * 实现模型能力检测、别名解析、上下文窗口检测
 */

import type { ModelInfo, ModelCapabilities, ModelPricing } from './types.js';
import { getResolvedModelContextWindow, getResolvedModelOutputTokenLimits } from './model-limits.js';

/**
 * 已知模型列表
 */
const KNOWN_MODELS: ModelInfo[] = [
  // Claude 4.6 系列 (最新 - 2026-02)
  {
    id: 'claude-opus-4-6',
    displayName: 'Opus 4.6',
    aliases: ['opus', 'opus-4-6', 'claude-opus-4-6'],
    contextWindow: 1_000_000,
    maxOutputTokens: 32768,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'opus',
    releaseDate: '2026-02-06', // Knowledge cutoff: May 2025
  },

  // Claude 4.5 系列
  {
    id: 'claude-opus-4-5-20251101',
    displayName: 'Opus 4.5',
    aliases: ['opus-4-5', 'claude-opus-4-5'],
    contextWindow: 1_000_000,
    maxOutputTokens: 32768,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'opus',
    releaseDate: '2025-11-01',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Sonnet 4.5',
    aliases: ['sonnet', 'sonnet-4-5', 'claude-sonnet-4-5'],
    contextWindow: 1_000_000,
    maxOutputTokens: 16384,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'sonnet',
    releaseDate: '2025-09-29',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    aliases: ['haiku', 'haiku-4-5', 'claude-haiku-4-5'],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'haiku',
    releaseDate: '2025-10-01',
  },

  // Claude 4 系列
  {
    id: 'claude-opus-4-20250514',
    displayName: 'Opus 4',
    aliases: ['opus-4', 'claude-opus-4'],
    contextWindow: 200_000,
    maxOutputTokens: 32768,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'opus',
    releaseDate: '2025-05-14',
  },
  {
    id: 'claude-sonnet-4-20250514',
    displayName: 'Sonnet 4',
    aliases: ['sonnet-4', 'claude-sonnet-4'],
    contextWindow: 200_000,
    maxOutputTokens: 16384,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: true,
    supportsCaching: true,
    family: 'sonnet',
    releaseDate: '2025-05-14',
  },

  // Claude 3.5 系列
  {
    id: 'claude-3-5-sonnet-20241022',
    displayName: 'Sonnet 3.5',
    aliases: ['sonnet-3-5', 'claude-3-5-sonnet'],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: false,
    supportsCaching: true,
    family: 'sonnet',
    releaseDate: '2024-10-22',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    displayName: 'Haiku 3.5',
    aliases: ['haiku-3-5', 'claude-3-5-haiku'],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    supportsTools: true,
    supportsVision: true,
    supportsPdf: false,
    supportsCaching: true,
    family: 'haiku',
    releaseDate: '2024-10-22',
  },
];

/**
 * 模型定价
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
    thinking: 75,
  },
  'claude-opus-4-5-20251101': {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
    thinking: 75,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
    thinking: 15,
  },
  'claude-haiku-4-5-20251001': {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreate: 1,
  },
  'claude-opus-4-20250514': {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
    thinking: 75,
  },
  'claude-sonnet-4-20250514': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
    thinking: 15,
  },
  'claude-3-5-sonnet-20241022': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  'claude-3-5-haiku-20241022': {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreate: 1,
  },
};

/**
 * 模型配置管理器
 */
export class ModelConfig {
  private models: Map<string, ModelInfo> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private pricing: Map<string, ModelPricing> = new Map();

  constructor() {
    this.initializeModels();
  }

  /**
   * 初始化模型列表
   */
  private initializeModels(): void {
    for (const model of KNOWN_MODELS) {
      this.models.set(model.id, model);

      // 建立别名映射
      for (const alias of model.aliases) {
        this.aliasMap.set(alias.toLowerCase(), model.id);
      }
      // 模型 ID 本身也作为别名
      this.aliasMap.set(model.id.toLowerCase(), model.id);
    }

    // 初始化定价
    for (const [modelId, pricing] of Object.entries(MODEL_PRICING)) {
      this.pricing.set(modelId, pricing);
    }
  }

  /**
   * 解析模型别名为完整模型 ID
   */
  resolveAlias(modelIdOrAlias: string): string {
    const normalized = modelIdOrAlias.toLowerCase().trim();
    return this.aliasMap.get(normalized) || modelIdOrAlias;
  }

  /**
   * 获取模型信息
   */
  getModelInfo(modelIdOrAlias: string): ModelInfo | null {
    const modelId = this.resolveAlias(modelIdOrAlias);
    return this.models.get(modelId) || null;
  }

  /**
   * 获取模型能力
   */
  getCapabilities(modelIdOrAlias: string): ModelCapabilities {
    const info = this.getModelInfo(modelIdOrAlias);

    if (info) {
      return {
        contextWindow: info.contextWindow,
        maxOutputTokens: info.maxOutputTokens,
        supportsThinking: info.supportsThinking,
        supportsTools: info.supportsTools,
        supportsVision: info.supportsVision,
        supportsPdf: info.supportsPdf,
        supportsCaching: info.supportsCaching,
        thinkingBudgetRange: info.supportsThinking
          ? {
              min: 1024,
              max: 128000,
              default: 10000,
            }
          : undefined,
      };
    }

    // 未知模型，返回默认能力
    return this.inferCapabilities(modelIdOrAlias);
  }

  /**
   * 推断未知模型的能力
   */
  private inferCapabilities(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();
    const resolvedContextWindow = getResolvedModelContextWindow(modelId);
    const resolvedOutputLimits = getResolvedModelOutputTokenLimits(modelId);

    // 检测是否为非 Claude 模型（Ollama 本地模型等）
    const isClaude = normalized.includes('claude') || normalized.includes('opus') || normalized.includes('sonnet') || normalized.includes('haiku');

    if (!isClaude) {
      // 本地 / 第三方模型：保守的默认能力
      return {
        contextWindow: resolvedContextWindow ?? 32_000,
        maxOutputTokens: resolvedOutputLimits?.default ?? 4096,
        supportsThinking: false,
        supportsTools: true,  // 大多数现代模型支持 function calling
        supportsVision: false,
        supportsPdf: false,
        supportsCaching: false,
      };
    }

    // 检测 1M token 模型
    if (normalized.includes('[1m]') ||
        normalized.includes('opus-4-6') ||
        normalized.includes('opus-4-5') ||
        normalized.includes('sonnet-4-5')) {
      return {
        contextWindow: 1_000_000,
        maxOutputTokens: 32768,
        supportsThinking: true,
        supportsTools: true,
        supportsVision: true,
        supportsPdf: true,
        supportsCaching: true,
        thinkingBudgetRange: {
          min: 1024,
          max: 128000,
          default: 10000,
        },
      };
    }

    // 检测 Extended Thinking 支持
    const supportsThinking =
      normalized.includes('opus-4') ||
      normalized.includes('sonnet-4-5') ||
      normalized.includes('sonnet-4');

    // 检测上下文窗口
    let contextWindow = 200_000;
    if (normalized.includes('[1m]')) {
      contextWindow = 1_000_000;
    }

    return {
      contextWindow: resolvedContextWindow ?? contextWindow,
      maxOutputTokens: resolvedOutputLimits?.default ?? 8192,
      supportsThinking,
      supportsTools: true,
      supportsVision: true,
      supportsPdf: normalized.includes('4'),
      supportsCaching: true,
      thinkingBudgetRange: supportsThinking
        ? {
            min: 1024,
            max: 128000,
            default: 10000,
          }
        : undefined,
    };
  }

  /**
   * 获取上下文窗口大小
   */
  getContextWindow(modelIdOrAlias: string): number {
    return this.getCapabilities(modelIdOrAlias).contextWindow;
  }

  /**
   * 检查是否支持 Extended Thinking
   */
  supportsExtendedThinking(modelIdOrAlias: string): boolean {
    return this.getCapabilities(modelIdOrAlias).supportsThinking;
  }

  /**
   * 获取模型定价
   */
  getPricing(modelIdOrAlias: string): ModelPricing {
    const modelId = this.resolveAlias(modelIdOrAlias);
    const pricing = this.pricing.get(modelId);

    if (pricing) {
      return pricing;
    }

    // 根据模型家族推断定价
    const info = this.getModelInfo(modelIdOrAlias);
    if (info) {
      switch (info.family) {
        case 'opus':
          return { input: 15, output: 75 };
        case 'sonnet':
          return { input: 3, output: 15 };
        case 'haiku':
          return { input: 0.8, output: 4 };
      }
    }

    // 默认定价 (sonnet 级别)
    return { input: 3, output: 15 };
  }

  /**
   * 计算成本
   */
  calculateCost(
    modelIdOrAlias: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      thinkingTokens?: number;
    }
  ): number {
    const pricing = this.getPricing(modelIdOrAlias);

    let cost = 0;
    cost += (usage.inputTokens / 1_000_000) * pricing.input;
    cost += (usage.outputTokens / 1_000_000) * pricing.output;

    if (usage.cacheReadTokens && pricing.cacheRead) {
      cost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;
    }
    if (usage.cacheCreationTokens && pricing.cacheCreate) {
      cost += (usage.cacheCreationTokens / 1_000_000) * pricing.cacheCreate;
    }
    if (usage.thinkingTokens && pricing.thinking) {
      cost += (usage.thinkingTokens / 1_000_000) * pricing.thinking;
    }

    return cost;
  }

  /**
   * 获取所有模型
   */
  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * 获取推荐的默认模型
   */
  getDefaultModel(): string {
    return 'claude-sonnet-4-5-20250929';
  }

  /**
   * 获取模型显示名称
   */
  getDisplayName(modelIdOrAlias: string): string {
    const info = this.getModelInfo(modelIdOrAlias);
    return info?.displayName || modelIdOrAlias;
  }

  /**
   * 验证模型 ID
   */
  isValidModel(modelIdOrAlias: string): boolean {
    const resolved = this.resolveAlias(modelIdOrAlias);
    return this.models.has(resolved) || this.isValidModelFormat(resolved);
  }

  /**
   * 检查是否为有效的模型格式
   */
  private isValidModelFormat(modelId: string): boolean {
    // Claude 模型 ID 格式: claude-{family}-{version}-{date}
    return /^claude-[\w-]+(-\d{8})?$/.test(modelId);
  }

  /**
   * 获取适合给定任务的模型推荐
   */
  recommendModel(task: 'simple' | 'medium' | 'complex' | 'thinking'): string {
    switch (task) {
      case 'simple':
        return 'claude-haiku-4-5-20251001';
      case 'medium':
        return 'claude-sonnet-4-5-20250929';
      case 'complex':
        return 'claude-opus-4-6';
      case 'thinking':
        return 'claude-opus-4-6';
      default:
        return this.getDefaultModel();
    }
  }
}

/**
 * 全局模型配置实例
 */
export const modelConfig = new ModelConfig();
