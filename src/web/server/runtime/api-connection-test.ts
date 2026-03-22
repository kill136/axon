import type { Message } from '../../../types/index.js';
import {
  getProviderForRuntimeBackend,
  normalizeWebRuntimeModelForBackend,
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../../shared/model-catalog.js';
import {
  getDefaultBaseUrlForRuntimeBackend,
  getDefaultTestModelForRuntimeBackend,
} from '../../shared/runtime-capabilities.js';
import { createConversationClient } from './factory.js';
import { fetchRuntimeModelCatalog } from './runtime-model-catalog.js';

export interface RuntimeApiConnectionTestOptions {
  apiKey: string;
  apiBaseUrl?: string;
  customModelName?: string;
  runtimeBackend?: WebRuntimeBackend;
  apiProvider?: 'anthropic' | 'openai-compatible' | 'axon-cloud';
  fetchImpl?: typeof fetch;
}

export interface RuntimeApiConnectionTestResult {
  model: string;
  baseUrl: string;
  provider: WebRuntimeProvider;
  availableModels?: string[];
}

export function resolveApiTestRuntimeBackend(
  options: Pick<RuntimeApiConnectionTestOptions, 'runtimeBackend' | 'apiProvider'>,
): WebRuntimeBackend {
  if (options.runtimeBackend) {
    return options.runtimeBackend;
  }

  if (options.apiProvider === 'openai-compatible') {
    return 'openai-compatible-api';
  }

  if (options.apiProvider === 'axon-cloud') {
    return 'axon-cloud';
  }

  return 'claude-compatible-api';
}

function resolveApiTestBaseUrl(
  runtimeBackend: WebRuntimeBackend,
  apiBaseUrl?: string,
): string {
  const configured = apiBaseUrl?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return getDefaultBaseUrlForRuntimeBackend(runtimeBackend);
}

export async function testRuntimeApiConnection(
  options: RuntimeApiConnectionTestOptions,
): Promise<RuntimeApiConnectionTestResult> {
  const runtimeBackend = resolveApiTestRuntimeBackend(options);
  const baseUrl = resolveApiTestBaseUrl(runtimeBackend, options.apiBaseUrl);

  let availableModels: string[] | undefined;
  if (supportsDynamicModelCatalogForBackend(runtimeBackend)) {
    availableModels = await fetchRuntimeModelCatalog({
      runtimeBackend,
      apiKey: options.apiKey,
      baseUrl,
      fetchImpl: options.fetchImpl,
    }) || undefined;
  }

  const preferredModel = options.customModelName?.trim()
    || availableModels?.[0]
    || getDefaultTestModelForRuntimeBackend(runtimeBackend);
  const normalizedModel = normalizeWebRuntimeModelForBackend(
    runtimeBackend,
    preferredModel,
    preferredModel,
    availableModels,
  );
  const provider = getProviderForRuntimeBackend(runtimeBackend, normalizedModel);
  const client = createConversationClient({
    provider,
    model: normalizedModel,
    apiKey: options.apiKey,
    baseUrl,
    customModelName: provider === 'codex' ? normalizedModel : options.customModelName?.trim(),
    timeout: 30000,
  });

  const response = await client.createMessage(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hi' }],
      } as Message,
    ],
    undefined,
    undefined,
    { enableThinking: false },
  );

  return {
    model: response.model || normalizedModel,
    baseUrl,
    provider,
    availableModels,
  };
}
