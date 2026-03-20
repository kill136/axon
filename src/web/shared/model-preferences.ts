import {
  normalizeWebRuntimeModelForBackend,
  type WebRuntimeBackend,
} from './model-catalog.js';

export type DefaultModelMap = Partial<Record<WebRuntimeBackend, string>>;

export function resolveBackendDefaultModel(
  backend: WebRuntimeBackend,
  defaultModelByBackend?: DefaultModelMap,
  fallbackModel?: string,
): string {
  const stored = defaultModelByBackend?.[backend] || fallbackModel;
  return normalizeWebRuntimeModelForBackend(backend, stored, stored);
}

export function upsertBackendDefaultModel(
  defaultModelByBackend: DefaultModelMap | undefined,
  backend: WebRuntimeBackend,
  model: string,
): DefaultModelMap {
  const normalized = normalizeWebRuntimeModelForBackend(backend, model, model);
  return {
    ...(defaultModelByBackend || {}),
    [backend]: normalized,
  };
}
