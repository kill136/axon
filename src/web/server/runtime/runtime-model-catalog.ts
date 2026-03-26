import {
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
} from '../../shared/model-catalog.js';

export function buildRuntimeModelCatalogEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/v1')) {
      return `${normalized}/models`;
    }

    return `${normalized}/v1/models`;
  } catch {
    if (normalized.endsWith('/v1')) {
      return `${normalized}/models`;
    }

    return `${normalized}/v1/models`;
  }
}

export function extractRuntimeModelIds(payload: unknown): string[] {
  const values = new Set<string>();
  const models: string[] = [];

  const append = (value: unknown) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || values.has(normalized)) {
      return;
    }
    values.add(normalized);
    models.push(normalized);
  };

  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      append(value);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') {
      append(record.id);
      return;
    }
    if (typeof record.name === 'string') {
      append(record.name);
      return;
    }
    if (typeof record.model === 'string') {
      append(record.model);
    }
  };

  if (Array.isArray(payload)) {
    payload.forEach(visit);
    return models;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      record.data.forEach(visit);
    }
    if (Array.isArray(record.models)) {
      record.models.forEach(visit);
    }
  }

  return models;
}

export async function fetchRuntimeModelCatalog(options: {
  runtimeBackend: WebRuntimeBackend;
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<string[] | null> {
  if (!supportsDynamicModelCatalogForBackend(options.runtimeBackend)) {
    return null;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = buildRuntimeModelCatalogEndpoint(options.baseUrl);
  const response = await fetchImpl(endpoint, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Model catalog endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  const models = extractRuntimeModelIds(payload);
  return models.length > 0 ? models : null;
}
