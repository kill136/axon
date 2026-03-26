export type WebRuntimeProvider = 'anthropic' | 'codex';
export type WebRuntimeBackend =
  | 'axon-cloud'
  | 'claude-subscription'
  | 'claude-compatible-api'
  | 'codex-subscription'
  | 'openai-compatible-api';

export type RuntimeProviderRouting = 'anthropic' | 'codex' | 'model-routed';
export type RuntimeOAuthRefreshStrategy = 'none' | 'anthropic' | 'codex';
export type RuntimeUtilityModelStrategy = 'anthropic-preferred' | 'runtime-default';

export interface RuntimeBackendCapabilities {
  backend: WebRuntimeBackend;
  providerRouting: RuntimeProviderRouting;
  defaultProvider: WebRuntimeProvider;
  supportsDynamicModelCatalog: boolean;
  allowsArbitraryModelIds: boolean;
  defaultAssistantLabel: string;
  defaultTestModel: string;
  defaultBaseUrl: string;
  apiKeyBaseUrl?: string;
  oauthRefreshStrategy: RuntimeOAuthRefreshStrategy;
  utilityModelStrategy: RuntimeUtilityModelStrategy;
}

export interface RuntimeBaseUrlOptions {
  useApiKey?: boolean;
}

export interface RuntimeOAuthStrategyOptions {
  authPriority?: 'apiKey' | 'oauth' | 'auto';
}

export const DEFAULT_ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CODEX_SUBSCRIPTION_BASE_URL = 'https://chatgpt.com/backend-api/codex';

const RUNTIME_BACKEND_CAPABILITIES: Record<WebRuntimeBackend, RuntimeBackendCapabilities> = {
  'axon-cloud': {
    backend: 'axon-cloud',
    providerRouting: 'model-routed',
    defaultProvider: 'anthropic',
    supportsDynamicModelCatalog: true,
    allowsArbitraryModelIds: true,
    defaultAssistantLabel: 'Axon',
    defaultTestModel: 'gpt-5.4',
    defaultBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
    oauthRefreshStrategy: 'none',
    utilityModelStrategy: 'runtime-default',
  },
  'claude-subscription': {
    backend: 'claude-subscription',
    providerRouting: 'anthropic',
    defaultProvider: 'anthropic',
    supportsDynamicModelCatalog: false,
    allowsArbitraryModelIds: false,
    defaultAssistantLabel: 'Claude',
    defaultTestModel: 'haiku',
    defaultBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
    oauthRefreshStrategy: 'anthropic',
    utilityModelStrategy: 'anthropic-preferred',
  },
  'claude-compatible-api': {
    backend: 'claude-compatible-api',
    providerRouting: 'anthropic',
    defaultProvider: 'anthropic',
    supportsDynamicModelCatalog: false,
    allowsArbitraryModelIds: false,
    defaultAssistantLabel: 'Claude',
    defaultTestModel: 'haiku',
    defaultBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
    oauthRefreshStrategy: 'anthropic',
    utilityModelStrategy: 'anthropic-preferred',
  },
  'codex-subscription': {
    backend: 'codex-subscription',
    providerRouting: 'codex',
    defaultProvider: 'codex',
    supportsDynamicModelCatalog: false,
    allowsArbitraryModelIds: false,
    defaultAssistantLabel: 'Codex',
    defaultTestModel: 'gpt-5.4',
    defaultBaseUrl: DEFAULT_CODEX_SUBSCRIPTION_BASE_URL,
    apiKeyBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
    oauthRefreshStrategy: 'codex',
    utilityModelStrategy: 'runtime-default',
  },
  'openai-compatible-api': {
    backend: 'openai-compatible-api',
    providerRouting: 'codex',
    defaultProvider: 'codex',
    supportsDynamicModelCatalog: true,
    allowsArbitraryModelIds: true,
    defaultAssistantLabel: 'OpenAI',
    defaultTestModel: 'gpt-5.4',
    defaultBaseUrl: DEFAULT_OPENAI_API_BASE_URL,
    oauthRefreshStrategy: 'none',
    utilityModelStrategy: 'runtime-default',
  },
};

export function getRuntimeBackendCapabilities(
  backend: WebRuntimeBackend,
): RuntimeBackendCapabilities {
  return RUNTIME_BACKEND_CAPABILITIES[backend];
}

export function supportsDynamicModelCatalogForBackend(
  backend: WebRuntimeBackend,
): boolean {
  return getRuntimeBackendCapabilities(backend).supportsDynamicModelCatalog;
}

export function allowsArbitraryModelIdsForBackend(
  backend: WebRuntimeBackend,
): boolean {
  return getRuntimeBackendCapabilities(backend).allowsArbitraryModelIds;
}

export function getRuntimeProviderRouting(
  backend: WebRuntimeBackend,
): RuntimeProviderRouting {
  return getRuntimeBackendCapabilities(backend).providerRouting;
}

export function getDefaultAssistantDisplayNameForRuntimeBackend(
  backend: WebRuntimeBackend,
): string {
  return getRuntimeBackendCapabilities(backend).defaultAssistantLabel;
}

export function getDefaultTestModelForRuntimeBackend(
  backend: WebRuntimeBackend,
): string {
  return getRuntimeBackendCapabilities(backend).defaultTestModel;
}

export function getDefaultBaseUrlForRuntimeBackend(
  backend: WebRuntimeBackend,
  options?: RuntimeBaseUrlOptions,
): string {
  const capability = getRuntimeBackendCapabilities(backend);
  if (backend === 'codex-subscription' && options?.useApiKey && capability.apiKeyBaseUrl) {
    return capability.apiKeyBaseUrl;
  }
  return capability.defaultBaseUrl;
}

export function getRuntimeOAuthRefreshStrategy(
  backend: WebRuntimeBackend,
  options?: RuntimeOAuthStrategyOptions,
): RuntimeOAuthRefreshStrategy {
  if (backend === 'claude-compatible-api' && options?.authPriority !== 'oauth') {
    return 'none';
  }
  return getRuntimeBackendCapabilities(backend).oauthRefreshStrategy;
}

export function shouldPreferAnthropicUtilityModelForBackend(
  backend: WebRuntimeBackend,
): boolean {
  return getRuntimeBackendCapabilities(backend).utilityModelStrategy === 'anthropic-preferred';
}
