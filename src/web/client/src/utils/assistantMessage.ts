import type { ChatContent, ChatMessage } from '../types';

interface CreateAssistantMessageOptions {
  id: string;
  content: ChatContent[];
  timestamp?: number;
  model?: string;
  runtimeBackend?: string;
}

export function createAssistantMessage(options: CreateAssistantMessageOptions): ChatMessage {
  const message: ChatMessage = {
    id: options.id,
    role: 'assistant',
    timestamp: options.timestamp ?? Date.now(),
    content: options.content,
  };

  if (options.model) {
    message.model = options.model;
  }

  if (options.runtimeBackend) {
    message.runtimeBackend = options.runtimeBackend;
  }

  return message;
}
