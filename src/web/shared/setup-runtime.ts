import type { WebRuntimeBackend } from './model-catalog.js';

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

export interface RuntimeBackendAuthSpec {
  backend: WebRuntimeBackend;
  authMode: 'axon-cloud' | 'oauth' | 'api-key';
  runtimeProvider: 'anthropic' | 'codex';
  apiProvider?: 'anthropic' | 'openai-compatible' | 'axon-cloud';
  testConnection: boolean;
  providerOptions: RuntimeApiProviderOption[];
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
  switch (backend) {
    case 'axon-cloud':
      return {
        backend,
        authMode: 'axon-cloud',
        runtimeProvider: 'anthropic',
        apiProvider: 'axon-cloud',
        testConnection: false,
        providerOptions: [],
      };
    case 'claude-subscription':
      return {
        backend,
        authMode: 'oauth',
        runtimeProvider: 'anthropic',
        apiProvider: 'anthropic',
        testConnection: false,
        providerOptions: [],
      };
    case 'codex-subscription':
      return {
        backend,
        authMode: 'oauth',
        runtimeProvider: 'codex',
        apiProvider: 'openai-compatible',
        testConnection: false,
        providerOptions: [],
      };
    case 'openai-compatible-api':
      return {
        backend,
        authMode: 'api-key',
        runtimeProvider: 'codex',
        apiProvider: 'openai-compatible',
        testConnection: false,
        providerOptions: OPENAI_PROVIDER_OPTIONS,
      };
    case 'claude-compatible-api':
    default:
      return {
        backend,
        authMode: 'api-key',
        runtimeProvider: 'anthropic',
        apiProvider: 'anthropic',
        testConnection: true,
        providerOptions: ANTHROPIC_PROVIDER_OPTIONS,
      };
  }
}

export function buildRuntimeBackendConfigPayload(
  backend: WebRuntimeBackend,
  options?: {
    apiBaseUrl?: string;
    apiKey?: string;
  },
): Record<string, string> {
  const spec = getRuntimeBackendAuthSpec(backend);
  const payload: Record<string, string> = {
    runtimeBackend: backend,
    runtimeProvider: spec.runtimeProvider,
  };

  if (spec.apiProvider) {
    payload.apiProvider = spec.apiProvider;
  }

  if (spec.authMode === 'oauth') {
    payload.authPriority = 'oauth';
  } else if (spec.authMode === 'api-key') {
    payload.authPriority = 'apiKey';
  } else {
    payload.authPriority = 'auto';
  }

  if (options?.apiBaseUrl) {
    payload.apiBaseUrl = options.apiBaseUrl;
  }

  if (options?.apiKey) {
    payload.apiKey = options.apiKey;
  }

  return payload;
}
