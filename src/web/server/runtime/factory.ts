import { ClaudeClient } from '../../../core/client.js';
import { CodexConversationClient } from './codex-client.js';
import type { ConversationClient, ConversationClientConfig } from './types.js';

export function createConversationClient(config: ConversationClientConfig): ConversationClient {
  if (config.provider === 'codex') {
    return new CodexConversationClient(config);
  }

  return new ClaudeClient({
    apiKey: config.apiKey,
    authToken: config.authToken,
    model: config.model,
    baseUrl: config.baseUrl,
    timeout: config.timeout,
    identityVariant: config.identityVariant,
  });
}
