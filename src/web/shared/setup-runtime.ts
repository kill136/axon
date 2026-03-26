import type { WebRuntimeBackend } from './model-catalog.js';
import { getRuntimeBackendCapabilities } from './runtime-capabilities.js';

export interface RuntimeApiProviderOption {
  id: 'anthropic' | 'openai' | 'openrouter' | 'custom';
  name: string;
  icon: string;
  defaultBaseUrl: string;
}

export interface SetupRuntimeOption {
  backend: WebRuntimeBackend;
  icon: string;
  recommended?: boolean;
}

export interface SetupRuntimeGroup {
  id: 'managed' | 'api';
  items: SetupRuntimeOption[];
}

export interface RuntimeBackendAuthSpec {
  backend: WebRuntimeBackend;
  authMode: 'axon-cloud' | 'oauth' | 'api-key';
  runtimeProvider: 'anthropic' | 'codex';
  apiProvider?: 'anthropic' | 'openai-compatible' | 'axon-cloud';
  testConnection: boolean;
  providerOptions: RuntimeApiProviderOption[];
}

export type RuntimeConfigApiProvider =
  | 'anthropic'
  | 'openai-compatible'
  | 'axon-cloud'
  | 'bedrock'
  | 'vertex';

export type RuntimeConfigAuthPriority = 'apiKey' | 'oauth' | 'auto';

export interface RuntimeConfigShape {
  runtimeBackend?: WebRuntimeBackend;
  runtimeProvider?: 'anthropic' | 'codex';
  apiProvider?: RuntimeConfigApiProvider;
  authPriority?: RuntimeConfigAuthPriority;
}

export interface NormalizedRuntimeConfigShape {
  runtimeBackend: WebRuntimeBackend;
  runtimeProvider: 'anthropic' | 'codex';
  apiProvider: RuntimeConfigApiProvider;
  authPriority: RuntimeConfigAuthPriority;
}

function compactRuntimeConfigShape<T extends Partial<RuntimeConfigShape>>(shape?: T): Partial<RuntimeConfigShape> {
  const compacted: Partial<RuntimeConfigShape> = {};

  for (const [key, value] of Object.entries(shape || {})) {
    if (value !== undefined) {
      (compacted as Record<string, unknown>)[key] = value;
    }
  }

  return compacted;
}

const ANTHROPIC_PROVIDER_OPTIONS: RuntimeApiProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    defaultBaseUrl: 'https://api.anthropic.com',
  },
];

const OPENAI_PROVIDER_OPTIONS: RuntimeApiProviderOption[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🧠',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    defaultBaseUrl: '',
  },
];

export function getSetupRuntimeOptions(): SetupRuntimeOption[] {
  return [
    { backend: 'axon-cloud', icon: '☁️', recommended: true },
    { backend: 'claude-subscription', icon: '🔐' },
    { backend: 'codex-subscription', icon: '🧠' },
    { backend: 'claude-compatible-api', icon: '🔑' },
    { backend: 'openai-compatible-api', icon: '🌐' },
  ];
}

export function getRuntimeBackendAuthSpec(backend: WebRuntimeBackend): RuntimeBackendAuthSpec {
  const capability = getRuntimeBackendCapabilities(backend);
  switch (backend) {
    case 'axon-cloud':
      return {
        backend,
        authMode: 'axon-cloud',
        runtimeProvider: capability.defaultProvider,
        apiProvider: 'axon-cloud',
        testConnection: false,
        providerOptions: [],
      };
    case 'claude-subscription':
      return {
        backend,
        authMode: 'oauth',
        runtimeProvider: capability.defaultProvider,
        apiProvider: 'anthropic',
        testConnection: false,
        providerOptions: [],
      };
    case 'codex-subscription':
      return {
        backend,
        authMode: 'oauth',
        runtimeProvider: capability.defaultProvider,
        apiProvider: 'openai-compatible',
        testConnection: false,
        providerOptions: [],
      };
    case 'openai-compatible-api':
      return {
        backend,
        authMode: 'api-key',
        runtimeProvider: capability.defaultProvider,
        apiProvider: 'openai-compatible',
        testConnection: true,
        providerOptions: OPENAI_PROVIDER_OPTIONS,
      };
    case 'claude-compatible-api':
    default:
      return {
        backend,
        authMode: 'api-key',
        runtimeProvider: capability.defaultProvider,
        apiProvider: 'anthropic',
        testConnection: true,
        providerOptions: ANTHROPIC_PROVIDER_OPTIONS,
      };
  }
}

export function getGroupedSetupRuntimeOptions(): SetupRuntimeGroup[] {
  const groups: SetupRuntimeGroup[] = [
    { id: 'managed', items: [] },
    { id: 'api', items: [] },
  ];

  for (const option of getSetupRuntimeOptions()) {
    const spec = getRuntimeBackendAuthSpec(option.backend);
    if (spec.authMode === 'api-key') {
      groups[1].items.push(option);
    } else {
      groups[0].items.push(option);
    }
  }

  return groups;
}

function inferRuntimeBackendFromConfigShape(input: {
  current?: RuntimeConfigShape;
  updates?: Partial<RuntimeConfigShape>;
}): WebRuntimeBackend {
  const current = input.current || {};
  const updates = input.updates || {};
  const merged: RuntimeConfigShape = {
    ...current,
    ...updates,
  };
  const currentRuntimeBackend = current.runtimeBackend;
  const currentSpec = currentRuntimeBackend
    ? getRuntimeBackendAuthSpec(currentRuntimeBackend)
    : undefined;

  if (updates.runtimeBackend) {
    return updates.runtimeBackend;
  }

  const hasRuntimeSignal =
    'runtimeProvider' in updates
    || 'apiProvider' in updates
    || 'authPriority' in updates;

  if (!hasRuntimeSignal) {
    return currentRuntimeBackend || merged.runtimeBackend || 'claude-compatible-api';
  }

  if (merged.authPriority === 'oauth') {
    return merged.runtimeProvider === 'codex'
      || merged.apiProvider === 'openai-compatible'
      || currentSpec?.runtimeProvider === 'codex'
      ? 'codex-subscription'
      : 'claude-subscription';
  }

  if (merged.authPriority === 'apiKey') {
    if (merged.apiProvider === 'axon-cloud') {
      return 'axon-cloud';
    }

    if (
      merged.runtimeProvider === 'codex'
      || merged.apiProvider === 'openai-compatible'
      || (currentSpec?.runtimeProvider === 'codex' && currentSpec.authMode === 'api-key')
    ) {
      return 'openai-compatible-api';
    }

    return 'claude-compatible-api';
  }

  if (merged.apiProvider === 'openai-compatible') {
    return 'openai-compatible-api';
  }

  if (merged.apiProvider === 'axon-cloud') {
    return 'axon-cloud';
  }

  if (merged.runtimeProvider === 'codex') {
    return currentSpec?.authMode === 'api-key'
      ? 'openai-compatible-api'
      : 'codex-subscription';
  }

  return currentRuntimeBackend || 'claude-compatible-api';
}

export function normalizeRuntimeConfigShape(input: {
  current?: RuntimeConfigShape;
  updates?: Partial<RuntimeConfigShape>;
}): NormalizedRuntimeConfigShape {
  const current = compactRuntimeConfigShape(input.current) as RuntimeConfigShape;
  const updates = compactRuntimeConfigShape(input.updates);
  const merged: RuntimeConfigShape = {
    ...current,
    ...updates,
  };

  const runtimeBackend = inferRuntimeBackendFromConfigShape({ current, updates });
  const spec = getRuntimeBackendAuthSpec(runtimeBackend);

  let apiProvider: RuntimeConfigApiProvider = spec.apiProvider || 'anthropic';
  if (runtimeBackend === 'claude-compatible-api') {
    if (
      merged.apiProvider === 'bedrock'
      || merged.apiProvider === 'vertex'
      || merged.apiProvider === 'anthropic'
    ) {
      apiProvider = merged.apiProvider;
    } else {
      apiProvider = 'anthropic';
    }
  }

  const authPriority: RuntimeConfigAuthPriority =
    spec.authMode === 'oauth' ? 'oauth'
      : spec.authMode === 'api-key' ? 'apiKey'
      : 'auto';

  return {
    runtimeBackend,
    runtimeProvider: spec.runtimeProvider,
    apiProvider,
    authPriority,
  };
}

export function buildRuntimeBackendConfigPayload(
  backend: WebRuntimeBackend,
  options?: {
    apiBaseUrl?: string;
    apiKey?: string;
  },
): Record<string, string> {
  const normalized = normalizeRuntimeConfigShape({
    updates: { runtimeBackend: backend },
  });
  const payload: Record<string, string> = {
    runtimeBackend: normalized.runtimeBackend,
    runtimeProvider: normalized.runtimeProvider,
  };

  payload.apiProvider = normalized.apiProvider;
  payload.authPriority = normalized.authPriority;

  if (options?.apiBaseUrl) {
    payload.apiBaseUrl = options.apiBaseUrl;
  }

  if (options?.apiKey) {
    payload.apiKey = options.apiKey;
  }

  return payload;
}
