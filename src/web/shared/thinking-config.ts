import { modelConfig } from '../../models/config.js';
import {
  getProviderForRuntimeBackend,
  isCodexCompatibleModel,
  type WebRuntimeBackend,
} from './model-catalog.js';

export const WEB_THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export const WEB_XHIGH_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

export type WebThinkingLevel = (typeof WEB_XHIGH_THINKING_LEVELS)[number];
export type WebReasoningEffort = 'none' | WebThinkingLevel;

export interface WebThinkingConfig {
  enabled: boolean;
  level: WebThinkingLevel;
}

export interface WebThinkingRuntimeOptions {
  enableThinking: boolean;
  thinkingBudget?: number;
  reasoningEffort: WebReasoningEffort;
}

const DEFAULT_WEB_THINKING_CONFIG: WebThinkingConfig = {
  enabled: true,
  level: 'medium',
};

const THINKING_BUDGET_BY_LEVEL: Record<WebThinkingLevel, number> = {
  low: 2000,
  medium: 10000,
  high: 50000,
  xhigh: 50000,
};

function supportsCodexXHighThinking(model?: string): boolean {
  const normalizedModel = model?.trim().toLowerCase();
  if (!normalizedModel || !isCodexCompatibleModel(normalizedModel)) {
    return false;
  }

  return normalizedModel === 'gpt-5-codex'
    || /^gpt-5\.(2|3|4)(?:$|[-.])/.test(normalizedModel);
}

function supportsAnthropicThinking(model?: string): boolean {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return false;
  }
  return modelConfig.supportsExtendedThinking(normalizedModel);
}

export function normalizeWebThinkingConfig(
  config?: Partial<WebThinkingConfig> | null,
): WebThinkingConfig {
  const nextLevel = config?.level;
  return {
    enabled: config?.enabled ?? DEFAULT_WEB_THINKING_CONFIG.enabled,
    level: nextLevel && WEB_XHIGH_THINKING_LEVELS.includes(nextLevel)
      ? nextLevel
      : DEFAULT_WEB_THINKING_CONFIG.level,
  };
}

export function getSupportedWebThinkingLevels(
  runtimeBackend: WebRuntimeBackend,
  model?: string,
): readonly WebThinkingLevel[] {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return WEB_THINKING_LEVELS;
  }

  const provider = getProviderForRuntimeBackend(runtimeBackend, normalizedModel);
  if (provider === 'codex' && supportsCodexXHighThinking(normalizedModel)) {
    return WEB_XHIGH_THINKING_LEVELS;
  }

  return WEB_THINKING_LEVELS;
}

export function supportsWebThinkingConfig(
  runtimeBackend: WebRuntimeBackend,
  model?: string,
): boolean {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return false;
  }

  const provider = getProviderForRuntimeBackend(runtimeBackend, normalizedModel);
  if (provider === 'codex') {
    return isCodexCompatibleModel(normalizedModel);
  }

  return supportsAnthropicThinking(normalizedModel);
}

export function getResolvedWebThinkingConfig(
  runtimeBackend: WebRuntimeBackend,
  model?: string,
  config?: Partial<WebThinkingConfig> | null,
): WebThinkingConfig {
  const normalized = normalizeWebThinkingConfig(config);
  if (!supportsWebThinkingConfig(runtimeBackend, model)) {
    return {
      ...normalized,
      enabled: false,
    };
  }

  const supportedLevels = getSupportedWebThinkingLevels(runtimeBackend, model);
  const resolvedLevel = supportedLevels.includes(normalized.level)
    ? normalized.level
    : supportedLevels[supportedLevels.length - 1] || DEFAULT_WEB_THINKING_CONFIG.level;
  return {
    ...normalized,
    level: resolvedLevel,
  };
}

export function mapThinkingConfigToRuntimeOptions(
  runtimeBackend: WebRuntimeBackend,
  model?: string,
  config?: Partial<WebThinkingConfig> | null,
): WebThinkingRuntimeOptions {
  const resolvedConfig = getResolvedWebThinkingConfig(runtimeBackend, model, config);

  if (!resolvedConfig.enabled) {
    return {
      enableThinking: false,
      reasoningEffort: 'none',
    };
  }

  const normalizedModel = model?.trim();
  if (normalizedModel && isCodexCompatibleModel(normalizedModel)) {
    return {
      enableThinking: true,
      reasoningEffort: resolvedConfig.level,
    };
  }

  return {
    enableThinking: true,
    thinkingBudget: THINKING_BUDGET_BY_LEVEL[resolvedConfig.level],
    reasoningEffort: resolvedConfig.level,
  };
}
