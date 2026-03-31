import type { Message } from '../../../types/index.js';
import { webAuth } from '../web-auth.js';
import { resolveRuntimeSelection } from './runtime-selection.js';
import { normalizeWebRuntimeModelForBackend } from '../../shared/model-catalog.js';
import { shouldPreferAnthropicUtilityModelForBackend } from '../../shared/runtime-capabilities.js';
import { createConversationClient } from './factory.js';
import type { ConversationClient } from './types.js';

export function getUtilityModel(preferredAnthropicModel: string = 'haiku'): string {
  const runtimeBackend = webAuth.getRuntimeBackend();
  const preferAnthropic = shouldPreferAnthropicUtilityModelForBackend(runtimeBackend);
  const selection = resolveRuntimeSelection({
    runtimeBackend,
    model: preferAnthropic ? preferredAnthropicModel : undefined,
    defaultModelByBackend: webAuth.getDefaultModelByBackend(),
    customModelCatalogByBackend: webAuth.getCustomModelCatalogByBackend(),
    codexModelName: webAuth.getCodexModelName(),
    customModelName: webAuth.getCustomModelName(),
  });

  // 只有明确偏好 Anthropic utility model 的后端（claude-subscription, claude-compatible-api）
  // 才使用 Claude 模型别名。对于 axon-cloud、openai-compatible-api 等后端，
  // 即使 model-routed 推断出 provider 为 anthropic，也应使用后端的默认模型，
  // 避免向不支持 Claude 模型的代理发送 claude-haiku-4-5-20251001 等模型 ID。
  if (preferAnthropic && selection.provider === 'anthropic') {
    return normalizeWebRuntimeModelForBackend(runtimeBackend, preferredAnthropicModel, selection.customModelName);
  }

  return selection.normalizedModel;
}

export function createUtilityClient(preferredAnthropicModel: string = 'haiku'): ConversationClient | null {
  const creds = webAuth.getCredentials();
  if (!creds.apiKey && !creds.authToken) {
    return null;
  }

  const runtimeBackend = webAuth.getRuntimeBackend();
  const model = getUtilityModel(preferredAnthropicModel);
  const selection = resolveRuntimeSelection({
    runtimeBackend,
    model,
    defaultModelByBackend: webAuth.getDefaultModelByBackend(),
    customModelCatalogByBackend: webAuth.getCustomModelCatalogByBackend(),
    codexModelName: webAuth.getCodexModelName(),
    customModelName: webAuth.getCustomModelName(),
  });

  return createConversationClient({
    provider: selection.provider,
    model,
    apiKey: creds.apiKey,
    authToken: creds.authToken,
    baseUrl: creds.baseUrl,
    accountId: creds.accountId,
    customModelName: selection.customModelName,
    timeout: 300000,
  });
}

export async function requestUtilityText(
  prompt: string,
  preferredAnthropicModel: string = 'haiku',
): Promise<string | null> {
  await webAuth.ensureValidToken();
  const client = createUtilityClient(preferredAnthropicModel);
  if (!client) {
    throw new Error('API client not initialized, please check API Key configuration');
  }

  const response = await client.createMessage(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      } as Message,
    ],
    undefined,
    undefined,
    { enableThinking: false },
  );

  for (const block of response.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }

  return null;
}
