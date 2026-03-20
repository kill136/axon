import {
  getProviderForRuntimeBackend,
  normalizeWebRuntimeModelForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../../shared/model-catalog.js';

export interface RuntimeSelectionOptions {
  runtimeBackend: WebRuntimeBackend;
  model?: string;
  defaultModelByBackend?: Partial<Record<WebRuntimeBackend, string>>;
  codexModelName?: string;
  customModelName?: string;
}

export interface RuntimeSelectionResult {
  provider: WebRuntimeProvider;
  normalizedModel: string;
  customModelName?: string;
}

function trimToUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getConfiguredRuntimeModelName(
  runtimeBackend: WebRuntimeBackend,
  defaultModelByBackend?: Partial<Record<WebRuntimeBackend, string>>,
  codexModelName?: string,
  customModelName?: string,
): string | undefined {
  const storedModel = trimToUndefined(defaultModelByBackend?.[runtimeBackend]);
  if (storedModel) {
    return storedModel;
  }

  switch (runtimeBackend) {
    case 'codex-subscription':
    case 'openai-compatible-api':
      return trimToUndefined(codexModelName);
    case 'axon-cloud':
      return trimToUndefined(codexModelName) || trimToUndefined(customModelName);
    case 'claude-subscription':
    case 'claude-compatible-api':
    default:
      return trimToUndefined(customModelName);
  }
}

export function resolveRuntimeSelection(options: RuntimeSelectionOptions): RuntimeSelectionResult {
  const customModelName = getConfiguredRuntimeModelName(
    options.runtimeBackend,
    options.defaultModelByBackend,
    options.codexModelName,
    options.customModelName,
  );
  const normalizedModel = normalizeWebRuntimeModelForBackend(
    options.runtimeBackend,
    options.model,
    customModelName,
  );
  const provider = getProviderForRuntimeBackend(
    options.runtimeBackend,
    customModelName || normalizedModel,
  );

  return {
    provider,
    normalizedModel,
    customModelName,
  };
}
