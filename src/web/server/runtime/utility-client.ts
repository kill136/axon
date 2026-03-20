import type { Message } from '../../../types/index.js';
import { webAuth } from '../web-auth.js';
import {
  getProviderForRuntimeBackend,
  normalizeWebRuntimeModelForBackend,
} from '../../shared/model-catalog.js';
import { createConversationClient } from './factory.js';
import type { ConversationClient } from './types.js';

export function getUtilityModel(preferredAnthropicModel: string = 'haiku'): string {
  const runtimeBackend = webAuth.getRuntimeBackend();
  const configuredModel = webAuth.getCustomModelName() || webAuth.getCodexModelName();
  const seedModel =
    runtimeBackend === 'claude-subscription' || runtimeBackend === 'claude-compatible-api'
      ? preferredAnthropicModel
      : (configuredModel || preferredAnthropicModel);
  return normalizeWebRuntimeModelForBackend(
    runtimeBackend,
    seedModel,
    configuredModel,
  );
}

export function createUtilityClient(preferredAnthropicModel: string = 'haiku'): ConversationClient | null {
  const creds = webAuth.getCredentials();
  if (!creds.apiKey && !creds.authToken) {
    return null;
  }

  const runtimeBackend = webAuth.getRuntimeBackend();
  const model = getUtilityModel(preferredAnthropicModel);
  const provider = getProviderForRuntimeBackend(runtimeBackend, model);
  const configuredModel = webAuth.getCustomModelName() || webAuth.getCodexModelName();

  return createConversationClient({
    provider,
    model,
    apiKey: creds.apiKey,
    authToken: creds.authToken,
    baseUrl: creds.baseUrl,
    accountId: creds.accountId,
    customModelName: configuredModel,
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
