/**
 * max_tokens 计算逻辑
 * 对齐官方 oa() / Li6() 函数
 * 独立模块，避免 client.ts ↔ loop.ts 循环依赖
 */

import { configManager } from '../config/index.js';

/**
 * 获取模型的 max_tokens 默认值和上限
 * 对齐官方 oa() 函数
 * @param model 模型 ID
 * @returns { default, upperLimit }
 */
export function getModelOutputTokenLimits(model: string): { default: number; upperLimit: number } {
  const normalized = model.toLowerCase();

  // 对齐官方 oa() 逻辑
  if (normalized.includes('opus-4-5') || normalized.includes('opus-4-6') ||
      normalized.includes('sonnet-4') || normalized.includes('haiku-4')) {
    return { default: 32000, upperLimit: 64000 };
  } else if (normalized.includes('opus-4-1') || normalized.includes('opus-4')) {
    return { default: 32000, upperLimit: 32000 };
  } else if (normalized.includes('claude-3-opus')) {
    return { default: 4096, upperLimit: 4096 };
  } else if (normalized.includes('3-5-sonnet') || normalized.includes('3-5-haiku')) {
    return { default: 8192, upperLimit: 8192 };
  }

  // 默认值
  return { default: 32000, upperLimit: 64000 };
}

/**
 * 获取模型的最大输出 tokens
 * 对齐官方 Li6() 函数：支持 CLAUDE_CODE_MAX_OUTPUT_TOKENS 环境变量覆盖
 * 优先级：环境变量 > settings.json maxTokens > 模型默认值
 * @param model 模型 ID
 * @returns 最大输出 tokens
 */
export function getMaxOutputTokens(model: string): number {
  const limits = getModelOutputTokenLimits(model);

  // 1. 环境变量覆盖（对齐官方 CLAUDE_CODE_MAX_OUTPUT_TOKENS）
  const envValue = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || process.env.AXON_MAX_OUTPUT_TOKENS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      if (parsed > limits.upperLimit) {
        console.warn(`[MaxOutputTokens] CLAUDE_CODE_MAX_OUTPUT_TOKENS=${parsed} capped to ${limits.upperLimit}`);
        return limits.upperLimit;
      }
      return parsed;
    }
  }

  // 2. settings.json maxTokens 覆盖（不超过上限）
  try {
    const configMax = configManager.get('maxTokens') as number | undefined;
    if (configMax && configMax > 0) {
      return Math.min(configMax, limits.upperLimit);
    }
  } catch {}

  // 3. 模型默认值
  return limits.default;
}
