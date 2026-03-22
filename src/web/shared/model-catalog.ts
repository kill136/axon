import {
  getDefaultAssistantDisplayNameForRuntimeBackend,
  getRuntimeBackendCapabilities,
  getRuntimeProviderRouting,
  supportsDynamicModelCatalogForBackend as supportsDynamicModelCatalogForBackendFromCapabilities,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from './runtime-capabilities.js';

export type { WebRuntimeBackend, WebRuntimeProvider } from './runtime-capabilities.js';

export interface WebModelOption {
  value: string;
  label: string;
  description?: string;
  provider: WebRuntimeProvider;
}

export interface WebRuntimeBackendOption {
  value: WebRuntimeBackend;
  label: string;
  description: string;
  provider: WebRuntimeProvider;
}

const DEFAULT_CODEX_MODEL = 'gpt-5-codex';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4';
const ANTHROPIC_MODEL_ORDER = ['opus', 'sonnet', 'haiku'] as const;
const CODEX_RECOMMENDED_MODELS = [
  'gpt-5-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
] as const;
const OPENAI_RECOMMENDED_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5.1-codex',
] as const;

const ANTHROPIC_MODEL_OPTIONS: WebModelOption[] = [
  {
    value: 'opus',
    label: 'Opus',
    description: '最强的 Claude 编码模型',
    provider: 'anthropic',
  },
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Claude 的均衡模型',
    provider: 'anthropic',
  },
  {
    value: 'haiku',
    label: 'Haiku',
    description: 'Claude 的快速模型',
    provider: 'anthropic',
  },
];

function normalizeDynamicModelCatalog(models?: string[]): string[] {
  const values = new Set<string>();
  const normalized: string[] = [];

  for (const model of models || []) {
    const trimmed = model?.trim();
    if (!trimmed || values.has(trimmed)) {
      continue;
    }
    values.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function isStaticAnthropicAlias(model?: string): boolean {
  const normalized = model?.trim().toLowerCase();
  return normalized === 'opus' || normalized === 'sonnet' || normalized === 'haiku';
}

function getDynamicBackendDefaultModel(
  currentModel?: string,
  customModelName?: string,
  availableModels?: string[],
  fallbackModel: string = 'opus',
): string {
  const catalog = normalizeDynamicModelCatalog(availableModels);
  const trimmedCurrent = currentModel?.trim();
  const trimmedCustom = customModelName?.trim();

  if (catalog.length > 0) {
    if (trimmedCurrent && catalog.includes(trimmedCurrent)) {
      return trimmedCurrent;
    }
    if (trimmedCurrent && !isStaticAnthropicAlias(trimmedCurrent)) {
      return trimmedCurrent;
    }
    if (trimmedCustom && catalog.includes(trimmedCustom)) {
      return trimmedCustom;
    }
    if (trimmedCustom && !isStaticAnthropicAlias(trimmedCustom)) {
      return trimmedCustom;
    }
    return catalog[0];
  }

  return trimmedCurrent || trimmedCustom || fallbackModel;
}

function createDynamicModelOptions(
  availableModels: string[] | undefined,
  currentModel?: string,
  customModelName?: string,
  currentDescription?: string,
  configuredDescription?: string,
  catalogDescription?: string,
  providerResolver: (model: string) => WebRuntimeProvider = model => inferWebRuntimeProvider(model),
): WebModelOption[] {
  const catalog = normalizeDynamicModelCatalog(availableModels);
  const values = new Set<string>();
  const options: WebModelOption[] = [];

  const getDynamicLabel = (model: string) => (
    isStaticAnthropicAlias(model) || isCodexCompatibleModel(model)
      ? getWebModelLabel(model)
      : model
  );

  const push = (model?: string, description?: string) => {
    const normalized = model?.trim();
    if (!normalized || values.has(normalized)) {
      return;
    }
    values.add(normalized);
    options.push({
      value: normalized,
      label: getDynamicLabel(normalized),
      description,
      provider: providerResolver(normalized),
    });
  };

  push(currentModel, currentDescription);
  push(customModelName, configuredDescription);
  for (const model of catalog) {
    push(model, catalogDescription);
  }

  return options;
}

function toCodexLabel(model: string): string {
  return model
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => {
      if (/^gpt$/i.test(part)) return 'GPT';
      if (/^o\d+/i.test(part)) return part.toLowerCase();
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      if (/^codex$/i.test(part)) return 'Codex';
      if (/^mini$/i.test(part)) return 'Mini';
      if (/^max$/i.test(part)) return 'Max';
      if (/^spark$/i.test(part)) return 'Spark';
      if (/^openai$/i.test(part)) return 'OpenAI';
      if (/^compact$/i.test(part)) return 'Compact';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function normalizeAnthropicAlias(model?: string): (typeof ANTHROPIC_MODEL_ORDER)[number] | undefined {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('sonnet')) return 'sonnet';
  if (normalized.includes('haiku')) return 'haiku';
  return undefined;
}

export function isAnthropicCompatibleModel(model?: string): boolean {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return false;
  if (normalizeAnthropicAlias(normalized)) return true;
  return normalized.includes('claude');
}

export function isCodexCompatibleModel(model?: string): boolean {
  if (!model) return false;
  const normalized = model.trim();
  if (!normalized) return false;
  return /^(gpt-|o\d(?:$|[-_])|codex)/i.test(normalized) || normalized.toLowerCase().includes('codex');
}

export function getProviderForRuntimeBackend(
  backend: WebRuntimeBackend,
  model?: string,
): WebRuntimeProvider {
  const providerRouting = getRuntimeProviderRouting(backend);
  if (providerRouting === 'anthropic' || providerRouting === 'codex') {
    return providerRouting;
  }

  const capability = getRuntimeBackendCapabilities(backend);
  if (!model?.trim()) {
    return capability.defaultProvider;
  }
  return isAnthropicCompatibleModel(model) ? 'anthropic' : 'codex';
}

export function getRuntimeBackendLabel(backend: WebRuntimeBackend): string {
  switch (backend) {
    case 'axon-cloud':
      return 'Axon Cloud';
    case 'claude-subscription':
      return 'Claude Subscription';
    case 'claude-compatible-api':
      return 'Claude-Compatible API';
    case 'codex-subscription':
      return 'Codex Subscription';
    case 'openai-compatible-api':
      return 'OpenAI-Compatible API';
    default:
      return backend;
  }
}

export function getRuntimeBackendOptions(): WebRuntimeBackendOption[] {
  return [
    {
      value: 'axon-cloud',
      label: 'Axon Cloud',
      description: '使用 Axon Cloud 托管账号与模型能力',
      provider: 'anthropic',
    },
    {
      value: 'claude-subscription',
      label: 'Claude Subscription',
      description: '使用 Anthropic OAuth 订阅登录',
      provider: 'anthropic',
    },
    {
      value: 'claude-compatible-api',
      label: 'Claude-Compatible API',
      description: '使用兼容 Anthropic Messages 协议的 API 服务',
      provider: 'anthropic',
    },
    {
      value: 'codex-subscription',
      label: 'Codex Subscription',
      description: '使用 ChatGPT / Codex 订阅登录',
      provider: 'codex',
    },
    {
      value: 'openai-compatible-api',
      label: 'OpenAI-Compatible API',
      description: '使用兼容 OpenAI Responses 协议的 API 服务',
      provider: 'codex',
    },
  ];
}

export function supportsDynamicModelCatalogForBackend(backend: WebRuntimeBackend): boolean {
  return supportsDynamicModelCatalogForBackendFromCapabilities(backend);
}

export function getDefaultWebModelForBackend(
  backend: WebRuntimeBackend,
  customModelName?: string,
  availableModels?: string[],
): string {
  switch (backend) {
    case 'codex-subscription':
      return isCodexCompatibleModel(customModelName) ? customModelName!.trim() : DEFAULT_CODEX_MODEL;
    case 'openai-compatible-api':
      return getDynamicBackendDefaultModel(
        undefined,
        customModelName,
        availableModels,
        DEFAULT_OPENAI_MODEL,
      );
    case 'axon-cloud':
      return getDynamicBackendDefaultModel(undefined, customModelName, availableModels);
    case 'claude-subscription':
    case 'claude-compatible-api':
    default:
      return 'opus';
  }
}

export function inferWebRuntimeProvider(
  model?: string,
  fallback: WebRuntimeProvider = 'anthropic',
): WebRuntimeProvider {
  return isCodexCompatibleModel(model) ? 'codex' : fallback;
}

export function resolveWebRuntimeProvider(
  model?: string,
  runtimeBackend?: WebRuntimeBackend,
  fallback: WebRuntimeProvider = 'anthropic',
): WebRuntimeProvider {
  if (runtimeBackend) {
    return getProviderForRuntimeBackend(runtimeBackend, model);
  }
  return inferWebRuntimeProvider(model, fallback);
}

export function getDefaultWebModel(
  provider: WebRuntimeProvider,
  customModelName?: string,
): string {
  if (provider === 'codex') {
    return isCodexCompatibleModel(customModelName) ? customModelName!.trim() : DEFAULT_CODEX_MODEL;
  }
  return 'opus';
}

export function normalizeWebRuntimeModelForBackend(
  backend: WebRuntimeBackend,
  model?: string,
  customModelName?: string,
  availableModels?: string[],
): string {
  if (backend === 'axon-cloud') {
    return getDynamicBackendDefaultModel(model, customModelName, availableModels);
  }

  if (backend === 'openai-compatible-api') {
    return getDynamicBackendDefaultModel(
      model,
      customModelName,
      availableModels,
      DEFAULT_OPENAI_MODEL,
    );
  }

  const provider = getProviderForRuntimeBackend(backend);
  if (provider === 'codex') {
    if (isCodexCompatibleModel(model)) {
      return model!.trim();
    }
    return getDefaultWebModelForBackend(backend, customModelName, availableModels);
  }

  return normalizeAnthropicAlias(model) || getDefaultWebModelForBackend(backend, customModelName, availableModels);
}

export function normalizeWebRuntimeModel(
  provider: WebRuntimeProvider,
  model?: string,
  customModelName?: string,
): string {
  if (provider === 'codex') {
    if (isCodexCompatibleModel(model)) {
      return model!.trim();
    }
    return getDefaultWebModel(provider, customModelName);
  }

  return normalizeAnthropicAlias(model) || getDefaultWebModel(provider, customModelName);
}

export function getWebModelLabel(model?: string, providerHint?: WebRuntimeProvider): string {
  const provider = providerHint || inferWebRuntimeProvider(model);
  if (!model) {
    return provider === 'codex' ? 'Codex' : 'Claude';
  }

  if (provider === 'codex' || isCodexCompatibleModel(model)) {
    return toCodexLabel(model.trim());
  }

  const alias = normalizeAnthropicAlias(model);
  if (alias === 'opus') return 'Opus';
  if (alias === 'sonnet') return 'Sonnet';
  if (alias === 'haiku') return 'Haiku';
  return model.trim();
}

export function getAssistantDisplayName(
  model?: string,
  runtimeBackend?: WebRuntimeBackend,
): string {
  if (runtimeBackend) {
    return getDefaultAssistantDisplayNameForRuntimeBackend(runtimeBackend);
  }
  return resolveWebRuntimeProvider(model) === 'codex' ? 'Codex' : 'Claude';
}

export function getWebModelOptions(
  provider: WebRuntimeProvider,
  currentModel?: string,
  customModelName?: string,
): WebModelOption[] {
  if (provider === 'anthropic') {
    return ANTHROPIC_MODEL_OPTIONS;
  }

  const values = new Set<string>();
  const options: WebModelOption[] = [];

  const pushCodexOption = (model: string | undefined, description?: string) => {
    const normalized = model?.trim();
    if (!normalized || !isCodexCompatibleModel(normalized) || values.has(normalized)) {
      return;
    }
    values.add(normalized);
    options.push({
      value: normalized,
      label: getWebModelLabel(normalized, 'codex'),
      description,
      provider: 'codex',
    });
  };

  pushCodexOption(
    currentModel,
    currentModel ? '当前会话正在使用的 Codex 模型' : undefined,
  );
  pushCodexOption(
    customModelName,
    customModelName ? '当前配置里指定的 Codex 模型' : undefined,
  );
  for (const model of CODEX_RECOMMENDED_MODELS) {
    pushCodexOption(model, '推荐的 Codex 模型');
  }
  pushCodexOption(DEFAULT_CODEX_MODEL, '默认的 Codex 编码模型');

  return options;
}

export function getWebModelOptionsForBackend(
  backend: WebRuntimeBackend,
  currentModel?: string,
  customModelName?: string,
  availableModels?: string[],
): WebModelOption[] {
  if (backend === 'axon-cloud') {
    const options = createDynamicModelOptions(
      availableModels,
      currentModel,
      customModelName,
      currentModel ? '当前会话正在使用的 Axon Cloud 模型' : undefined,
      customModelName ? '当前配置里指定的 Axon Cloud 模型' : undefined,
      'Axon Cloud / NewAPI 返回的可用模型',
      model => getProviderForRuntimeBackend('axon-cloud', model),
    );
    if (options.length > 0) {
      return options;
    }
  }

  if (backend === 'openai-compatible-api') {
    const options = createDynamicModelOptions(
      availableModels,
      currentModel,
      customModelName,
      currentModel ? '当前会话正在使用的 OpenAI 兼容模型' : undefined,
      customModelName ? '当前配置里指定的 OpenAI 兼容模型' : undefined,
      'OpenAI 兼容接口返回的可用模型',
      model => getProviderForRuntimeBackend('openai-compatible-api', model),
    );
    if (options.length > 0) {
      return options;
    }

    const values = new Set<string>();
    const fallbackOptions: WebModelOption[] = [];
    const push = (model?: string, description?: string) => {
      const normalized = model?.trim();
      if (!normalized || values.has(normalized)) {
        return;
      }
      values.add(normalized);
      fallbackOptions.push({
        value: normalized,
        label: getWebModelLabel(normalized, 'codex'),
        description,
        provider: 'codex',
      });
    };

    push(currentModel, currentModel ? '当前会话正在使用的 OpenAI 兼容模型' : undefined);
    push(customModelName, customModelName ? '当前配置里指定的 OpenAI 兼容模型' : undefined);
    for (const model of OPENAI_RECOMMENDED_MODELS) {
      push(model, '推荐的 OpenAI 兼容模型');
    }
    push(DEFAULT_OPENAI_MODEL, '默认的 OpenAI 兼容模型');
    return fallbackOptions;
  }

  return getWebModelOptions(
    getProviderForRuntimeBackend(backend),
    currentModel,
    customModelName,
  );
}
