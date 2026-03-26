import { configManager } from '../config/index.js';

export interface ModelOutputTokenLimits {
  default: number;
  upperLimit: number;
}

interface KnownModelLimits {
  contextWindow: number;
  outputTokens: ModelOutputTokenLimits;
}

const KNOWN_MODEL_LIMITS: Record<string, KnownModelLimits> = {
  'gpt-5.4': {
    contextWindow: 280_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.4-mini': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5-codex': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.3-codex': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.2': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.2-codex': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.1': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.1-codex': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
  'gpt-5.1-codex-max': {
    contextWindow: 400_000,
    outputTokens: { default: 128_000, upperLimit: 128_000 },
  },
};

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function findConfiguredContextWindow(modelId: string): number | undefined {
  try {
    const configured = configManager.get('modelContextWindowById');
    if (!configured) {
      return undefined;
    }

    const normalizedModelId = normalizeModelId(modelId);
    for (const [configuredModelId, contextWindow] of Object.entries(configured)) {
      if (normalizeModelId(configuredModelId) === normalizedModelId) {
        return contextWindow;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function findKnownModelKey(modelId: string): string | undefined {
  const normalizedModelId = normalizeModelId(modelId);

  if (KNOWN_MODEL_LIMITS[normalizedModelId]) {
    return normalizedModelId;
  }

  const sortedKeys = Object.keys(KNOWN_MODEL_LIMITS).sort((left, right) => right.length - left.length);
  return sortedKeys.find((key) => normalizedModelId.startsWith(`${key}-`));
}

export function getOfficialModelLimits(modelId: string): KnownModelLimits | undefined {
  const key = findKnownModelKey(modelId);
  return key ? KNOWN_MODEL_LIMITS[key] : undefined;
}

export function getResolvedModelContextWindow(modelId: string): number | undefined {
  return findConfiguredContextWindow(modelId) ?? getOfficialModelLimits(modelId)?.contextWindow;
}

export function getResolvedModelOutputTokenLimits(modelId: string): ModelOutputTokenLimits | undefined {
  return getOfficialModelLimits(modelId)?.outputTokens;
}
