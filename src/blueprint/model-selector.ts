/**
 * 蜂群架构 v5.1 - 模型选择器
 *
 * 简化版：
 * - 任务分解时已确定 complexity，直接映射到模型即可
 * - 不需要 AI 再"智能选择"模型（浪费 API 调用）
 * - 成本是执行后统计的实际值，不是预估
 */

import type {
  SmartTask,
  SwarmConfig,
  ModelSelection,
  ModelType,
  TaskType,
} from './types.js';

// ============================================================================
// 模型定价（用于执行后统计实际成本）
// ============================================================================

export const MODEL_PRICING: Record<ModelType, { input: number; output: number }> = {
  haiku: { input: 0.0008, output: 0.004 },
  sonnet: { input: 0.003, output: 0.015 },
  opus: { input: 0.015, output: 0.075 },
};

// ============================================================================
// 模型选择器
// ============================================================================

export class ModelSelector {
  /**
   * 根据任务复杂度选择模型
   * 任务分解时已确定 complexity，直接映射即可
   */
  selectModel(task: SmartTask, config: SwarmConfig): ModelSelection {
    let model: ModelType;

    switch (task.complexity) {
      case 'trivial':
        model = config.simpleTaskModel;
        break;
      case 'simple':
        model = config.simpleTaskModel;
        break;
      case 'moderate':
        model = config.defaultModel;
        break;
      case 'complex':
        model = config.complexTaskModel;
        break;
      default:
        model = config.defaultModel;
    }

    // 特殊任务类型调整
    model = this.adjustByTaskType(model, task.type, config);

    return {
      model,
      reason: `${task.complexity} → ${model}`,
    };
  }

  /**
   * 根据任务类型微调
   */
  private adjustByTaskType(model: ModelType, taskType: TaskType, config: SwarmConfig): ModelType {
    // 集成/重构任务不能用 haiku
    if ((taskType === 'integrate' || taskType === 'refactor') && model === 'haiku') {
      return config.defaultModel;
    }
    // 配置/文档任务不需要 opus
    if ((taskType === 'config' || taskType === 'docs') && model === 'opus') {
      return config.defaultModel;
    }
    return model;
  }

  /**
   * 计算实际成本（执行后统计）
   */
  calculateActualCost(model: ModelType, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1000;
  }

  /**
   * 获取模型显示名称
   */
  getModelDisplayName(model: ModelType): string {
    return {
      haiku: 'Claude 4.5 Haiku',
      sonnet: 'Claude 4.5 Sonnet',
      opus: 'Claude Opus 4.6',
    }[model] || model;
  }
}

export const modelSelector = new ModelSelector();
