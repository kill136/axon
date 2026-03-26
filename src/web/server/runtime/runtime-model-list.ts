import {
  getWebModelLabel,
  getWebModelOptionsForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../../shared/model-catalog.js';
import {
  resolveRuntimeSelection,
  type RuntimeSelectionOptions,
} from './runtime-selection.js';

export interface RuntimeModelListItem {
  id: string;
  name: string;
  description: string;
  modelId: string;
  provider: WebRuntimeProvider;
}

export interface RuntimeModelListResponse {
  provider: WebRuntimeProvider;
  runtimeBackend: WebRuntimeBackend;
  models: RuntimeModelListItem[];
}

function getRuntimeBackendDisplayPrefix(runtimeBackend: WebRuntimeBackend): string {
  switch (runtimeBackend) {
    case 'codex-subscription':
      return 'Codex';
    case 'openai-compatible-api':
      return 'OpenAI Compatible';
    case 'claude-compatible-api':
      return 'Claude Compatible';
    case 'axon-cloud':
      return 'Axon Cloud';
    default:
      return 'Claude';
  }
}

export function buildRuntimeModelListResponse(options: {
  provider: WebRuntimeProvider;
  runtimeBackend: WebRuntimeBackend;
  currentModel?: string;
  availableModels?: string[];
}): RuntimeModelListResponse {
  const backendLabel = getRuntimeBackendDisplayPrefix(options.runtimeBackend);
  const models = getWebModelOptionsForBackend(
    options.runtimeBackend,
    options.currentModel,
    options.currentModel,
    options.availableModels,
  ).map(model => ({
    id: model.value,
    name: `${backendLabel} ${getWebModelLabel(model.value, model.provider)}`,
    description: model.description || (model.provider === 'codex'
      ? 'Current or configured responses-compatible model'
      : 'Claude-family model'),
    modelId: model.value,
    provider: model.provider,
  }));

  return {
    provider: options.provider,
    runtimeBackend: options.runtimeBackend,
    models,
  };
}

export function buildCurrentRuntimeModelListResponse(
  options: RuntimeSelectionOptions & { availableModels?: string[] },
): RuntimeModelListResponse {
  const selection = resolveRuntimeSelection(options);

  return buildRuntimeModelListResponse({
    provider: selection.provider,
    runtimeBackend: options.runtimeBackend,
    currentModel: selection.normalizedModel,
    availableModels: options.availableModels,
  });
}
