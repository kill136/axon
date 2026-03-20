import type { PromptBlock } from '../../../prompt/index.js';
import type { ContentBlock, Message, ToolDefinition } from '../../../types/index.js';
import type { ThinkingResult } from '../../../models/index.js';

export interface ConversationClientConfig {
  provider: 'anthropic' | 'codex';
  model: string;
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  timeout?: number;
  accountId?: string;
  debug?: boolean;
  customModelName?: string;
  identityVariant?: 'main' | 'sdk' | 'agent';
}

export interface ConversationMessageResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
  };
  thinking?: ThinkingResult;
  model: string;
}

export type ConversationStreamEvent =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_use_start'; id?: string; name?: string }
  | { type: 'tool_use_delta'; id?: string; input?: string }
  | { type: 'tool_use_complete'; id?: string; input?: unknown }
  | { type: 'server_tool_use_start'; id?: string; name?: string; input?: string }
  | { type: 'web_search_result'; id?: string; searchResults?: any[]; data?: any }
  | { type: 'stop'; stopReason?: string }
  | {
      type: 'usage';
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        thinkingTokens?: number;
      };
    }
  | { type: 'error'; error?: string }
  | { type: 'response_headers'; headers?: Headers };

export interface ConversationClient {
  createMessage(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
      toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
      promptBlocks?: PromptBlock[];
      toolSearchEnabled?: boolean;
    }
  ): Promise<ConversationMessageResponse>;
  createMessageStream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
      signal?: AbortSignal;
      toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
      promptBlocks?: PromptBlock[];
      toolSearchEnabled?: boolean;
    }
  ): AsyncGenerator<ConversationStreamEvent>;
}
