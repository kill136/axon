import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  ToolDefinition,
} from '../../../types/index.js';
import type { ImageBlockParam, TextBlock, ToolResultBlockParam, ToolUseBlock } from '../../../types/messages.js';
import type {
  ConversationClient,
  ConversationClientConfig,
  ConversationMessageResponse,
  ConversationRequestOptions,
  ConversationStreamEvent,
} from './types.js';

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_CODEX_INSTRUCTIONS = 'You are Axon, a coding assistant helping inside a web IDE.';

interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
}

interface ResponseOutputItem {
  id?: string;
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  summary?: Array<{ text?: string }>;
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponsesApiResult {
  id?: string;
  model?: string;
  output?: ResponseOutputItem[];
  usage?: ResponseUsage;
}

interface ResponsesStreamReplayState {
  sawTextDelta: boolean;
  sawThinkingDelta: boolean;
  startedToolCallIds: Set<string>;
  completedToolCallIds: Set<string>;
  reasoningByKey: Map<string, string>;
  toolCallAliases: Map<string, string>;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string; image_url?: { url?: string } }> | null;
  tool_calls?: ChatCompletionToolCall[];
  reasoning_content?: string;
}

interface ChatCompletionChoice {
  message?: ChatCompletionMessage;
  delta?: ChatCompletionMessage;
  finish_reason?: string | null;
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface ChatCompletionsApiResult {
  id?: string;
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function coerceTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as any).text;
      if (typeof text === 'string') return text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractTextFromOutput(output?: ResponseOutputItem[]): string {
  if (!Array.isArray(output)) return '';
  return output
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .map(part => part.text || '')
    .join('');
}

function getResponseToolCallId(item: Pick<ResponseOutputItem, 'call_id' | 'id'>): string {
  return item.call_id || item.id || `call_${Date.now()}`;
}

function collectResponseToolCallAliases(item: Pick<ResponseOutputItem, 'call_id' | 'id'>): string[] {
  const aliases = [item.call_id, item.id]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return Array.from(new Set(aliases));
}

function resolveCanonicalToolCallId(
  replayState: ResponsesStreamReplayState | undefined,
  identifiers: Array<string | undefined>,
  fallback?: string,
): string {
  const aliases = Array.from(new Set(
    identifiers.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  ));

  if (replayState) {
    for (const alias of aliases) {
      const canonical = replayState.toolCallAliases.get(alias);
      if (canonical) {
        for (const candidate of aliases) {
          replayState.toolCallAliases.set(candidate, canonical);
        }
        return canonical;
      }
    }
  }

  const canonical = fallback || aliases[0] || `call_${Date.now()}`;

  if (replayState) {
    replayState.toolCallAliases.set(canonical, canonical);
    for (const alias of aliases) {
      replayState.toolCallAliases.set(alias, canonical);
    }
  }

  return canonical;
}

function getReasoningEventKey(payload: Record<string, any>): string {
  const itemId = typeof payload.item_id === 'string' && payload.item_id
    ? payload.item_id
    : typeof payload.item?.id === 'string' && payload.item.id
      ? payload.item.id
      : `reasoning-${typeof payload.output_index === 'number' ? payload.output_index : 0}`;

  const partIndex = typeof payload.summary_index === 'number'
    ? payload.summary_index
    : typeof payload.content_index === 'number'
      ? payload.content_index
      : 0;

  return `${itemId}:${partIndex}`;
}

function extractReasoningText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  if (typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }

  const part = (value as { part?: { text?: unknown } }).part;
  if (part && typeof part.text === 'string') {
    return part.text;
  }

  if (Array.isArray((value as { summary?: Array<{ text?: unknown }> }).summary)) {
    return (value as { summary: Array<{ text?: unknown }> }).summary
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join('');
  }

  return '';
}

function recordReasoningText(
  replayState: ResponsesStreamReplayState,
  key: string,
  text: string,
  mode: 'delta' | 'snapshot',
): string | undefined {
  if (!text) {
    return undefined;
  }

  const previous = replayState.reasoningByKey.get(key) || '';

  if (mode === 'delta') {
    replayState.reasoningByKey.set(key, previous + text);
    replayState.sawThinkingDelta = true;
    return text;
  }

  if (!previous) {
    replayState.reasoningByKey.set(key, text);
    replayState.sawThinkingDelta = true;
    return text;
  }

  if (text === previous) {
    return undefined;
  }

  if (text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    if (!delta) {
      return undefined;
    }
    replayState.reasoningByKey.set(key, text);
    replayState.sawThinkingDelta = true;
    return delta;
  }

  replayState.reasoningByKey.set(key, text);
  replayState.sawThinkingDelta = true;
  return text;
}

function isCodexCompatibleModel(model?: string): boolean {
  if (!model) return false;
  const normalized = model.trim();
  if (!normalized) return false;
  return /^(gpt-|o\d(?:$|[-_])|codex)/i.test(normalized) || normalized.toLowerCase().includes('codex');
}

function getMessageTextContentType(role: Message['role']): 'input_text' | 'output_text' {
  return role === 'assistant' ? 'output_text' : 'input_text';
}

function isImageBlock(block: unknown): block is ImageBlockParam {
  return !!block
    && typeof block === 'object'
    && (block as { type?: string }).type === 'image'
    && !!(block as { source?: { data?: string } }).source?.data;
}

function isThinkingBlock(block: unknown): block is { type: 'thinking'; thinking: string } {
  return !!block
    && typeof block === 'object'
    && (block as { type?: string }).type === 'thinking'
    && typeof (block as { thinking?: unknown }).thinking === 'string';
}

function parseResponsesApiResult(value: string | undefined): ResponsesApiResult | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as ResponsesApiResult;
  } catch {
    return null;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateForError(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function looksLikeHtmlPayload(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase() || '';
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}

function extractErrorDetail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = safeJsonParse<any>(trimmed, null);
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return collapseWhitespace(parsed.message);
    }

    const nestedError = parsed.error;
    if (typeof nestedError === 'string' && nestedError.trim()) {
      return collapseWhitespace(nestedError);
    }
    if (nestedError && typeof nestedError === 'object') {
      if (typeof nestedError.message === 'string' && nestedError.message.trim()) {
        return collapseWhitespace(nestedError.message);
      }
      if (typeof nestedError.type === 'string' && nestedError.type.trim()) {
        return collapseWhitespace(nestedError.type);
      }
    }
  }

  if (looksLikeHtmlPayload(trimmed)) {
    const titleMatch = trimmed.match(/<title>\s*([^<]+?)\s*<\/title>/i);
    if (titleMatch?.[1]) {
      return collapseWhitespace(titleMatch[1]);
    }
    return 'upstream proxy returned an HTML error page';
  }

  return collapseWhitespace(trimmed);
}

function formatHttpErrorMessage(
  transportName: string,
  response: Pick<Response, 'status' | 'statusText'>,
  payload: string | undefined,
): string {
  const detail = extractErrorDetail(payload);
  const statusParts: string[] = [];
  if (response.status) {
    statusParts.push(`HTTP ${response.status}`);
  }
  if (response.statusText) {
    statusParts.push(response.statusText);
  }

  const statusSuffix = statusParts.length > 0 ? ` (${statusParts.join(' ')})` : '';
  if (!detail) {
    return `${transportName} request failed${statusSuffix}`;
  }

  return `${transportName} request failed${statusSuffix}: ${truncateForError(detail)}`;
}

function buildResponsesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/backend-api/codex') || pathname.endsWith('/v1')) {
      return `${normalized}/responses`;
    }

    return `${normalized}/v1/responses`;
  } catch {
    if (normalized.endsWith('/backend-api/codex') || normalized.endsWith('/v1')) {
      return `${normalized}/responses`;
    }
    return `${normalized}/v1/responses`;
  }
}

function buildChatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, '');

    if (pathname.endsWith('/backend-api/codex')) {
      return `${normalized}/chat/completions`;
    }
    if (pathname.endsWith('/v1')) {
      return `${normalized}/chat/completions`;
    }

    return `${normalized}/v1/chat/completions`;
  } catch {
    if (normalized.endsWith('/backend-api/codex') || normalized.endsWith('/v1')) {
      return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
  }
}

function isCustomResponsesEndpoint(baseUrl: string): boolean {
  const normalized = baseUrl.replace(/\/+$/, '');
  return !/chatgpt\.com\/backend-api\/codex$/i.test(normalized);
}

function shouldFallbackToChatCompletions(
  response: Pick<Response, 'status' | 'headers'>,
  errorText: string | undefined,
): boolean {
  const normalized = errorText?.toLowerCase() || '';
  if (normalized.includes('convert_request_failed') || normalized.includes('not implemented')) {
    return true;
  }

  const contentType = response.headers.get('content-type') || '';
  const isHtmlError = /text\/html/i.test(contentType) || looksLikeHtmlPayload(errorText);
  return response.status >= 500 && isHtmlError;
}

function shouldIncludeThinkingHistory(options?: ConversationRequestOptions): boolean {
  return options?.enableThinking !== false && options?.reasoningEffort !== 'none';
}

export class CodexConversationClient implements ConversationClient {
  private model: string;
  private authToken?: string;
  private apiKey?: string;
  private baseUrl: string;
  private accountId?: string;
  private timeout: number;
  private customModelName?: string;

  constructor(config: ConversationClientConfig) {
    this.model = config.model;
    this.authToken = config.authToken;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, '');
    this.accountId = config.accountId;
    this.timeout = config.timeout || 300000;
    this.customModelName = config.customModelName;
  }

  async createMessage(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: ConversationRequestOptions,
  ): Promise<ConversationMessageResponse> {
    if (this.shouldUseChatCompletionsTransport()) {
      const response = await this.callChatCompletionsApi(messages, tools, systemPrompt, options, false);
      return this.mapChatCompletionResponse(response);
    }

    const response = await this.callResponsesApi(messages, tools, systemPrompt, options, false);
    const content = this.mapOutputToContentBlocks(response.output);
    const hasToolUse = content.some(block => block.type === 'tool_use');

    return {
      content,
      stopReason: hasToolUse ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        thinkingTokens: response.usage?.reasoning_tokens || 0,
      },
      model: response.model || this.resolveModelName(),
    };
  }

  async *createMessageStream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: ConversationRequestOptions,
  ): AsyncGenerator<ConversationStreamEvent> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Codex request timed out')), this.timeout);
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
    }

    if (this.shouldUseChatCompletionsTransport()) {
      yield* this.createChatCompletionsStream(messages, tools, systemPrompt, options);
      return;
    }

    const endpoint = buildResponsesEndpoint(this.baseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(messages, tools, systemPrompt, options, true)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      if (isCustomResponsesEndpoint(this.baseUrl) && shouldFallbackToChatCompletions(response, text)) {
        yield* this.createChatCompletionsStream(messages, tools, systemPrompt, options);
        return;
      }
      clearTimeout(timeoutId);
      yield { type: 'response_headers', headers: response.headers };
      yield { type: 'error', error: formatHttpErrorMessage('Codex', response, text) };
      return;
    }

    clearTimeout(timeoutId);
    yield { type: 'response_headers', headers: response.headers };

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/event-stream/i.test(contentType)) {
      const text = await response.text();
      const apiResponse = parseResponsesApiResult(text);
      if (!apiResponse) {
        yield {
          type: 'error',
          error: `Codex request returned a non-stream payload that could not be parsed: ${truncateForError(extractErrorDetail(text) || 'empty response')}`,
        };
        return;
      }

      yield* this.emitCompletedResponse(apiResponse);
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'Codex response body is empty' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let activeToolCallId: string | undefined;
    let activeToolCallName: string | undefined;
    let completed = false;
    const replayState: ResponsesStreamReplayState = {
      sawTextDelta: false,
      sawThinkingDelta: false,
      startedToolCallIds: new Set<string>(),
      completedToolCallIds: new Set<string>(),
      reasoningByKey: new Map<string, string>(),
      toolCallAliases: new Map<string, string>(),
    };

    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = rawEvent.split(/\r?\n/);
        let eventType = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataString = dataLines.join('\n');
        if (!dataString || dataString === '[DONE]') {
          continue;
        }

        const payload = safeJsonParse<Record<string, any>>(dataString, {});
        const eventName = typeof payload.type === 'string' ? payload.type : eventType;

        switch (eventName) {
          case 'response.output_text.delta':
            if (payload.delta) {
              replayState.sawTextDelta = true;
            }
            yield { type: 'text', text: payload.delta || '' };
            break;
          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning.delta':
          case 'response.reasoning_summary.delta': {
            const thinkingText = recordReasoningText(
              replayState,
              getReasoningEventKey(payload),
              extractReasoningText(payload.delta),
              'delta',
            );
            if (thinkingText) {
              yield { type: 'thinking', thinking: thinkingText };
            }
            break;
          }
          case 'response.reasoning.done':
          case 'response.reasoning_summary.done':
          case 'response.reasoning_summary_text.done':
          case 'response.reasoning_summary_part.done': {
            const thinkingText = recordReasoningText(
              replayState,
              getReasoningEventKey(payload),
              extractReasoningText(payload),
              'snapshot',
            );
            if (thinkingText) {
              yield { type: 'thinking', thinking: thinkingText };
            }
            break;
          }
          case 'response.output_item.added': {
            const item = payload.item || {};
            if (item.type === 'function_call') {
              activeToolCallId = resolveCanonicalToolCallId(
                replayState,
                collectResponseToolCallAliases(item),
                getResponseToolCallId(item),
              );
              activeToolCallName = item.name;
              if (!replayState.startedToolCallIds.has(activeToolCallId)) {
                replayState.startedToolCallIds.add(activeToolCallId);
                yield {
                  type: 'tool_use_start',
                  id: activeToolCallId,
                  name: activeToolCallName,
                };
              }
            }
            break;
          }
          case 'response.output_item.done': {
            const item = payload.item || {};
            if (item.type === 'reasoning' && Array.isArray(item.summary)) {
              const itemId = typeof item.id === 'string' && item.id
                ? item.id
                : `reasoning-${typeof payload.output_index === 'number' ? payload.output_index : 0}`;
              for (let index = 0; index < item.summary.length; index += 1) {
                const part = item.summary[index];
                const thinkingText = recordReasoningText(
                  replayState,
                  `${itemId}:${index}`,
                  extractReasoningText(part),
                  'snapshot',
                );
                if (thinkingText) {
                  yield { type: 'thinking', thinking: thinkingText };
                }
              }
            }
            break;
          }
          case 'response.function_call_arguments.delta':
            activeToolCallId = resolveCanonicalToolCallId(
              replayState,
              [payload.call_id],
              activeToolCallId,
            );
            yield {
              type: 'tool_use_delta',
              id: activeToolCallId,
              input: payload.delta || '',
            };
            break;
          case 'response.function_call_arguments.done':
            activeToolCallId = resolveCanonicalToolCallId(
              replayState,
              [payload.call_id],
              activeToolCallId,
            );
            if (!replayState.completedToolCallIds.has(activeToolCallId)) {
              replayState.completedToolCallIds.add(activeToolCallId);
              yield {
                type: 'tool_use_complete',
                id: activeToolCallId,
                input: safeJsonParse(payload.arguments, {}),
              };
            }
            break;
          case 'response.completed': {
            const apiResponse = payload.response as ResponsesApiResult | undefined;
            completed = true;
            yield* this.emitCompletedResponse(apiResponse, replayState);
            break;
          }
          case 'response.error':
            yield { type: 'error', error: payload.error?.message || payload.message || 'Codex stream error' };
            return;
        }
      }
    }

    const trailingText = buffer.trim();
    if (!completed && trailingText) {
      const apiResponse = parseResponsesApiResult(trailingText);
      if (apiResponse) {
        yield* this.emitCompletedResponse(apiResponse, replayState);
        return;
      }
    }

    if (!completed) {
      yield {
        type: 'error',
        error: 'Codex stream ended without a completion event',
      };
    }
  }

  private async callResponsesApi(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    options: ConversationRequestOptions | undefined,
    stream: boolean
  ): Promise<ResponsesApiResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Codex request timed out')), this.timeout);

    try {
      const endpoint = buildResponsesEndpoint(this.baseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildRequestBody(messages, tools, systemPrompt, options, stream)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        if (isCustomResponsesEndpoint(this.baseUrl) && shouldFallbackToChatCompletions(response, text)) {
          const fallback = await this.callChatCompletionsApi(messages, tools, systemPrompt, options, stream);
          return this.mapChatCompletionApiResultToResponses(fallback);
        }
        throw new Error(formatHttpErrorMessage('Codex', response, text));
      }

      return await response.json() as ResponsesApiResult;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Codex request failed: ${String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async callChatCompletionsApi(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    options: ConversationRequestOptions | undefined,
    stream: boolean,
  ): Promise<ChatCompletionsApiResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('OpenAI-compatible request timed out')), this.timeout);

    try {
      const endpoint = buildChatCompletionsEndpoint(this.baseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildChatCompletionsBody(messages, tools, systemPrompt, options, stream)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatHttpErrorMessage('OpenAI-compatible', response, text));
      }

      return await response.json() as ChatCompletionsApiResult;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`OpenAI-compatible request failed: ${String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async *createChatCompletionsStream(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    options: ConversationRequestOptions | undefined,
  ): AsyncGenerator<ConversationStreamEvent> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('OpenAI-compatible request timed out')), this.timeout);
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
    }

    const endpoint = buildChatCompletionsEndpoint(this.baseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildChatCompletionsBody(messages, tools, systemPrompt, options, true)),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    yield { type: 'response_headers', headers: response.headers };

    if (!response.ok) {
      const text = await response.text();
      yield { type: 'error', error: formatHttpErrorMessage('OpenAI-compatible', response, text) };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'OpenAI-compatible response body is empty' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | null = null;
    let usage: ChatCompletionUsage | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string; index: number }>();
    const toolCallAliases = new Map<string, number>();
    let generatedToolCallCounter = 0;

    const resolveToolCall = (toolCall: ChatCompletionToolCall & { index?: number }) => {
      const rawId = typeof toolCall.id === 'string' && toolCall.id.trim()
        ? toolCall.id
        : undefined;
      const explicitIndex = typeof toolCall.index === 'number'
        ? toolCall.index
        : undefined;

      if (rawId) {
        const aliasedIndex = toolCallAliases.get(rawId);
        if (aliasedIndex != null) {
          return toolCalls.get(aliasedIndex) || null;
        }

        for (const candidate of toolCalls.values()) {
          if (candidate.id === rawId) {
            toolCallAliases.set(rawId, candidate.index);
            return candidate;
          }
        }
      }

      if (explicitIndex != null) {
        return toolCalls.get(explicitIndex) || null;
      }

      return null;
    };

    const appendToolArguments = (
      entry: { arguments: string },
      nextChunk: string | undefined,
    ): string | undefined => {
      if (!nextChunk) {
        return undefined;
      }

      if (!entry.arguments) {
        entry.arguments = nextChunk;
        return nextChunk;
      }

      if (nextChunk === entry.arguments || entry.arguments.endsWith(nextChunk)) {
        return undefined;
      }

      if (nextChunk.startsWith(entry.arguments)) {
        const delta = nextChunk.slice(entry.arguments.length);
        if (!delta) {
          return undefined;
        }
        entry.arguments = nextChunk;
        return delta;
      }

      entry.arguments += nextChunk;
      return nextChunk;
    };

    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') {
          continue;
        }

        const payload = safeJsonParse<ChatCompletionsApiResult>(data, {});
        const choice = payload.choices?.[0];

        if (payload.usage) {
          usage = payload.usage;
        }

        if (!choice) {
          continue;
        }

        const delta = choice.delta || {};
        const reasoning = delta.reasoning_content;
        if (reasoning) {
          yield { type: 'thinking', thinking: reasoning };
        }

        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'text', text: delta.content };
        }

        for (const toolCall of delta.tool_calls || []) {
          const rawId = typeof toolCall.id === 'string' && toolCall.id.trim()
            ? toolCall.id
            : undefined;
          const explicitIndex = typeof (toolCall as any).index === 'number'
            ? (toolCall as any).index
            : undefined;
          const existing = resolveToolCall(toolCall as ChatCompletionToolCall & { index?: number });
          if (!existing) {
            const nextIndex = explicitIndex ?? generatedToolCallCounter++;
            const next = {
              id: rawId || `call_${Date.now()}_${nextIndex}`,
              name: toolCall.function?.name || 'unknown_tool',
              arguments: '',
              index: nextIndex,
            };
            toolCalls.set(nextIndex, next);
            if (rawId) {
              toolCallAliases.set(rawId, nextIndex);
            }
            yield {
              type: 'tool_use_start',
              id: next.id,
              name: next.name,
            };
            const initialDelta = appendToolArguments(next, toolCall.function?.arguments);
            if (initialDelta) {
              yield {
                type: 'tool_use_delta',
                id: next.id,
                input: initialDelta,
              };
            }
            continue;
          }

          if (rawId) {
            toolCallAliases.set(rawId, existing.index);
          }
          if (toolCall.function?.name && existing.name === 'unknown_tool') {
            existing.name = toolCall.function.name;
          }
          const deltaChunk = appendToolArguments(existing, toolCall.function?.arguments);
          if (deltaChunk) {
            yield {
              type: 'tool_use_delta',
              id: existing.id,
              input: deltaChunk,
            };
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }

    for (const toolCall of toolCalls.values()) {
      yield {
        type: 'tool_use_complete',
        id: toolCall.id,
        input: safeJsonParse(toolCall.arguments, {}),
      };
    }

    yield {
      type: 'usage',
      usage: {
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
        thinkingTokens: usage?.completion_tokens_details?.reasoning_tokens || 0,
      },
    };
    yield {
      type: 'stop',
      stopReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'length' ? 'max_tokens' : 'end_turn',
    };
  }

  private buildChatCompletionsBody(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    options: ConversationRequestOptions | undefined,
    stream: boolean,
  ): Record<string, any> {
    const body: Record<string, any> = {
      model: this.resolveModelName(),
      messages: this.convertMessagesToChatCompletions(
        messages,
        systemPrompt,
        shouldIncludeThinkingHistory(options),
      ),
      stream,
    };

    if (stream) {
      body.stream_options = { include_usage: true };
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    }

    if (options?.toolChoice) {
      if (options.toolChoice.type === 'tool') {
        body.tool_choice = {
          type: 'function',
          function: { name: options.toolChoice.name },
        };
      } else {
        body.tool_choice = options.toolChoice.type;
      }
    }

    return body;
  }

  private convertMessagesToChatCompletions(
    messages: Message[],
    systemPrompt?: string,
    includeThinkingHistory = true,
  ): any[] {
    const openAiMessages: any[] = [];

    if (systemPrompt?.trim()) {
      openAiMessages.push({
        role: 'system',
        content: systemPrompt.trim(),
      });
    }

    for (const message of messages) {
      const contentBlocks = typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content;

      if (!Array.isArray(contentBlocks)) {
        continue;
      }

      if (message.role === 'assistant') {
        const textParts: string[] = [];
        const toolCalls: any[] = [];
        const reasoningParts: string[] = [];

        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
            continue;
          }

          if (includeThinkingHistory && isThinkingBlock(block)) {
            const normalizedThinking = block.thinking.trim();
            if (normalizedThinking) {
              reasoningParts.push(normalizedThinking);
            }
            continue;
          }

          if (block.type === 'tool_use') {
            const toolUse = block as ToolUseBlock;
            toolCalls.push({
              id: toolUse.id,
              type: 'function',
              function: {
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input || {}),
              },
            });
          }
        }

        const assistantMessage: Record<string, any> = {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('') : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };
        const reasoningContent = reasoningParts.join('\n').trim();
        if (reasoningContent) {
          assistantMessage.reasoning_content = reasoningContent;
        } else if (includeThinkingHistory && toolCalls.length > 0) {
          // 一些 OpenAI-compatible 网关在 assistant tool_calls 历史里强制要求该字段存在，
          // 即使当前无法恢复完整 reasoning trace，也至少补空字符串避免恢复会话时报错。
          assistantMessage.reasoning_content = '';
        }

        openAiMessages.push(assistantMessage);
        continue;
      }

      const userTextParts: string[] = [];
      const userVisionParts: any[] = [];
      const toolResults: Array<{ tool_call_id: string; content: string }> = [];

      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text) {
          userTextParts.push(block.text);
          continue;
        }

        if (isImageBlock(block)) {
          userVisionParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          });
          continue;
        }

        if (block.type === 'tool_result') {
          const toolResult = block as ToolResultBlockParam;
          toolResults.push({
            tool_call_id: toolResult.tool_use_id,
            content: coerceTextContent(toolResult.content),
          });
        }
      }

      for (const toolResult of toolResults) {
        openAiMessages.push({
          role: 'tool',
          tool_call_id: toolResult.tool_call_id,
          content: toolResult.content,
        });
      }

      if (userTextParts.length > 0 || userVisionParts.length > 0) {
        if (userVisionParts.length > 0) {
          const content: any[] = [];
          if (userTextParts.length > 0) {
            content.push({
              type: 'text',
              text: userTextParts.join('\n'),
            });
          }
          content.push(...userVisionParts);
          openAiMessages.push({
            role: 'user',
            content,
          });
        } else {
          openAiMessages.push({
            role: 'user',
            content: userTextParts.join('\n'),
          });
        }
      }
    }

    return openAiMessages;
  }

  private mapChatCompletionResponse(response: ChatCompletionsApiResult): ConversationMessageResponse {
    const choice = response.choices?.[0];
    const message = choice?.message || {};
    const content: ContentBlock[] = [];

    if (message.reasoning_content) {
      content.push({ type: 'thinking', thinking: message.reasoning_content } as any);
    }

    for (const toolCall of message.tool_calls || []) {
      content.push({
        type: 'tool_use',
        id: toolCall.id || `call_${Date.now()}`,
        name: toolCall.function?.name || 'unknown_tool',
        input: safeJsonParse(toolCall.function?.arguments, {}),
      } as ToolUseBlock);
    }

    if (typeof message.content === 'string' && message.content) {
      content.push({ type: 'text', text: message.content } as TextBlock);
    }

    return {
      content,
      stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        thinkingTokens: response.usage?.completion_tokens_details?.reasoning_tokens || 0,
      },
      model: response.model || this.resolveModelName(),
    };
  }

  private mapChatCompletionApiResultToResponses(response: ChatCompletionsApiResult): ResponsesApiResult {
    const mapped = this.mapChatCompletionResponse(response);
    const output: ResponseOutputItem[] = [];

    for (const block of mapped.content) {
      if (block.type === 'thinking') {
        output.push({
          type: 'reasoning',
          summary: [{ text: (block as any).thinking }],
        });
        continue;
      }

      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseBlock;
        output.push({
          type: 'function_call',
          call_id: toolUse.id,
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input || {}),
        });
        continue;
      }

      if (block.type === 'text') {
        output.push({
          type: 'message',
          content: [{ type: 'output_text', text: block.text }],
        });
      }
    }

    return {
      model: mapped.model,
      output,
      usage: {
        input_tokens: mapped.usage.inputTokens,
        output_tokens: mapped.usage.outputTokens,
        reasoning_tokens: mapped.usage.thinkingTokens,
      },
    };
  }

  private shouldUseChatCompletionsTransport(): boolean {
    return isCustomResponsesEndpoint(this.baseUrl) && !isCodexCompatibleModel(this.resolveModelName());
  }

  private buildHeaders(): Record<string, string> {
    const token = this.apiKey || this.authToken;
    if (!token) {
      throw new Error('Codex credentials are not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    if (this.authToken && this.accountId) {
      headers['ChatGPT-Account-ID'] = this.accountId;
    }

    return headers;
  }

  private buildRequestBody(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    options: ConversationRequestOptions | undefined,
    stream: boolean
  ): Record<string, any> {
    const input = this.convertMessages(messages);
    const instructions = systemPrompt?.trim() || DEFAULT_CODEX_INSTRUCTIONS;
    const resolvedModel = this.resolveModelName();
    const body: Record<string, any> = {
      model: resolvedModel,
      input,
      stream,
      store: false,
      instructions,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
    }

    if (options?.toolChoice) {
      if (options.toolChoice.type === 'tool') {
        body.tool_choice = {
          type: 'function',
          name: options.toolChoice.name,
        };
      } else {
        body.tool_choice = options.toolChoice.type;
      }
    }

    if (this.supportsReasoning(resolvedModel)) {
      const reasoningEffort =
        options?.enableThinking === false
          ? 'none'
          : options?.reasoningEffort || (options?.enableThinking ? 'medium' : undefined);

      if (reasoningEffort) {
        body.reasoning = {
          effort: reasoningEffort,
          summary: 'auto',
        };
      }
    }

    return body;
  }

  private convertMessages(messages: Message[]): any[] {
    const input: any[] = [];

    for (const message of messages) {
      const contentBlocks = typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content;

      const textParts: string[] = [];
      const imageParts: any[] = [];

      for (const block of contentBlocks) {
        if (block.type === 'text') {
          textParts.push(block.text);
          continue;
        }

        if (isImageBlock(block)) {
          imageParts.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
          });
          continue;
        }

        if (block.type === 'tool_result') {
          const toolResult = block as ToolResultBlockParam;
          input.push({
            type: 'function_call_output',
            call_id: toolResult.tool_use_id,
            output: coerceTextContent(toolResult.content),
          });
          continue;
        }

        if (message.role === 'assistant' && block.type === 'tool_use') {
          const toolUse = block as ToolUseBlock;
          input.push({
            type: 'function_call',
            call_id: toolUse.id,
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input || {}),
          });
        }
      }

      if (textParts.length > 0 || imageParts.length > 0) {
        const content: any[] = [];
        if (textParts.length > 0) {
          content.push({
            type: getMessageTextContentType(message.role),
            text: textParts.join('\n'),
          });
        }
        if (message.role !== 'assistant') {
          content.push(...imageParts);
        }
        input.push({
          type: 'message',
          role: message.role,
          content,
        });
      }
    }

    return input;
  }

  private mapOutputToContentBlocks(output?: ResponseOutputItem[]): ContentBlock[] {
    if (!Array.isArray(output)) {
      return [{ type: 'text', text: '' } as TextBlock];
    }

    const contentBlocks: ContentBlock[] = [];
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        const text = item.content
          .map(part => part.text || '')
          .join('');
        if (text) {
          contentBlocks.push({ type: 'text', text } as TextBlock);
        }
        continue;
      }

      if (item.type === 'reasoning' && Array.isArray(item.summary)) {
        const text = item.summary.map(part => part.text || '').join('');
        if (text) {
          contentBlocks.push({ type: 'thinking', thinking: text } as any);
        }
        continue;
      }

      if (item.type === 'function_call') {
        contentBlocks.push({
          type: 'tool_use',
          id: item.call_id || item.id || `call_${Date.now()}`,
          name: item.name || 'unknown_tool',
          input: safeJsonParse(item.arguments, {}),
        } as ToolUseBlock);
      }
    }

    if (contentBlocks.length === 0) {
      const text = extractTextFromOutput(output);
      if (text) {
        contentBlocks.push({ type: 'text', text } as TextBlock);
      }
    }

    return contentBlocks;
  }

  private *emitCompletedResponse(
    response?: ResponsesApiResult,
    replayState?: ResponsesStreamReplayState,
  ): Generator<ConversationStreamEvent> {
    const output = response?.output || [];
    for (const item of output) {
      if (item.type === 'reasoning' && Array.isArray(item.summary)) {
        if (replayState?.sawThinkingDelta) {
          continue;
        }
        const text = item.summary.map(part => part.text || '').join('');
        if (text) {
          yield { type: 'thinking', thinking: text };
        }
        continue;
      }

      if (item.type === 'function_call') {
        const callId = resolveCanonicalToolCallId(
          replayState,
          collectResponseToolCallAliases(item),
          getResponseToolCallId(item),
        );
        if (!replayState?.startedToolCallIds.has(callId)) {
          yield {
            type: 'tool_use_start',
            id: callId,
            name: item.name || 'unknown_tool',
          };
        }
        if (!replayState?.completedToolCallIds.has(callId)) {
          yield {
            type: 'tool_use_complete',
            id: callId,
            input: safeJsonParse(item.arguments, {}),
          };
        }
        continue;
      }

      if (item.type === 'message' && Array.isArray(item.content)) {
        if (replayState?.sawTextDelta) {
          continue;
        }
        for (const part of item.content) {
          if (part.type === 'output_text' && part.text) {
            yield { type: 'text', text: part.text };
          }
        }
      }
    }

    const hasToolUse = output.some(item => item.type === 'function_call');
    yield {
      type: 'usage',
      usage: {
        inputTokens: response?.usage?.input_tokens || 0,
        outputTokens: response?.usage?.output_tokens || 0,
        thinkingTokens: response?.usage?.reasoning_tokens || 0,
      },
    };
    yield {
      type: 'stop',
      stopReason: hasToolUse ? 'tool_use' : 'end_turn',
    };
  }

  private resolveModelName(): string {
    const allowArbitraryModel = isCustomResponsesEndpoint(this.baseUrl);

    if (this.customModelName?.trim() && (allowArbitraryModel || isCodexCompatibleModel(this.customModelName))) {
      return this.customModelName.trim();
    }
    const normalized = this.model.trim();
    if (normalized && (allowArbitraryModel || isCodexCompatibleModel(normalized))) {
      return normalized;
    }
    return 'gpt-5-codex';
  }

  private supportsReasoning(model: string): boolean {
    return isCodexCompatibleModel(model);
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getIsOAuth(): boolean {
    return !this.apiKey && !!this.authToken;
  }

  getAnthropicClient(): Anthropic | undefined {
    return undefined;
  }
}
