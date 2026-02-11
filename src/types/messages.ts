/**
 * Message Type Definitions
 *
 * Complete type definitions for Claude API messages, compatible with Anthropic SDK.
 * Based on @anthropic-ai/sdk v0.32.1
 *
 * @see https://docs.anthropic.com/en/api/messages
 */

// ============ Message Roles ============

/**
 * The role of a message in a conversation.
 *
 * - `user`: Messages from the user/human
 * - `assistant`: Messages from Claude
 * - `system`: System-level instructions (used via system parameter, not in messages array)
 */
export type MessageRole = 'user' | 'assistant';

// ============ Content Block Types ============

/**
 * A text content block containing plain text.
 *
 * @example
 * ```typescript
 * const textBlock: TextBlock = {
 *   type: 'text',
 *   text: 'Hello, Claude!'
 * };
 * ```
 */
export interface TextBlock {
  /** The type identifier for this content block */
  type: 'text';
  /** The text content */
  text: string;
}

/**
 * A text content block parameter for input messages.
 * Identical to TextBlock but used in request parameters.
 */
export interface TextBlockParam {
  /** The type identifier for this content block */
  type: 'text';
  /** The text content */
  text: string;
}

/**
 * An image content block containing base64-encoded image data.
 *
 * Supported formats: JPEG, PNG, GIF, WebP
 *
 * @example
 * ```typescript
 * const imageBlock: ImageBlockParam = {
 *   type: 'image',
 *   source: {
 *     type: 'base64',
 *     media_type: 'image/png',
 *     data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
 *   }
 * };
 * ```
 */
export interface ImageBlockParam {
  /** The type identifier for this content block */
  type: 'image';
  /** The image source data */
  source: ImageSource;
}

/**
 * Image source data containing base64-encoded image.
 */
export interface ImageSource {
  /** The source type - currently only 'base64' is supported */
  type: 'base64';
  /** The MIME type of the image */
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64-encoded image data */
  data: string;
}

/**
 * A document content block containing base64-encoded PDF data.
 *
 * Supported format: PDF
 *
 * @example
 * ```typescript
 * const documentBlock: DocumentBlockParam = {
 *   type: 'document',
 *   source: {
 *     type: 'base64',
 *     media_type: 'application/pdf',
 *     data: 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC...'
 *   }
 * };
 * ```
 */
export interface DocumentBlockParam {
  /** The type identifier for this content block */
  type: 'document';
  /** The document source data */
  source: DocumentSource;
}

/**
 * Document source data containing base64-encoded PDF.
 */
export interface DocumentSource {
  /** The source type - currently only 'base64' is supported */
  type: 'base64';
  /** The MIME type of the document */
  media_type: 'application/pdf';
  /** Base64-encoded PDF data */
  data: string;
}

/**
 * A tool use block indicating the model wants to call a tool.
 *
 * The assistant returns this when it needs to invoke a tool.
 *
 * @example
 * ```typescript
 * const toolUse: ToolUseBlock = {
 *   type: 'tool_use',
 *   id: 'toolu_01A09q90qw90lq917835lq9',
 *   name: 'get_weather',
 *   input: { location: 'San Francisco' }
 * };
 * ```
 */
export interface ToolUseBlock {
  /** The type identifier for this content block */
  type: 'tool_use';
  /** Unique identifier for this tool use */
  id: string;
  /** Name of the tool to use */
  name: string;
  /** Input parameters for the tool (JSON object) */
  input: unknown;
}

// ============ Server Tool Types (Anthropic API built-in tools) ============

/**
 * A server tool use block indicating the model is using a server-side tool.
 * Server tools are executed by Anthropic's servers, not the client.
 * Currently only 'web_search' is supported.
 */
export interface ServerToolUseBlock {
  /** The type identifier for server tool use */
  type: 'server_tool_use';
  /** Unique identifier for this tool use */
  id: string;
  /** Name of the server tool (currently only 'web_search') */
  name: 'web_search';
  /** Input parameters for the tool */
  input: unknown;
}

/**
 * A web search result block containing search results.
 */
export interface WebSearchResultBlock {
  /** Encrypted content of the search result */
  encrypted_content: string;
  /** Age of the page (e.g., "2 days ago") */
  page_age: string | null;
  /** Title of the search result */
  title: string;
  /** Type identifier */
  type: 'web_search_result';
  /** URL of the search result */
  url: string;
}

/**
 * Error that can occur during web search.
 */
export interface WebSearchToolResultError {
  /** Error code */
  error_code: 'invalid_tool_input' | 'unavailable' | 'max_uses_exceeded' | 'too_many_requests' | 'query_too_long';
  /** Type identifier */
  type: 'web_search_tool_result_error';
}

/**
 * A web search tool result block containing search results or error.
 */
export interface WebSearchToolResultBlock {
  /** Content: either search results array or error */
  content: WebSearchResultBlock[] | WebSearchToolResultError;
  /** ID of the tool use this result corresponds to */
  tool_use_id: string;
  /** Type identifier */
  type: 'web_search_tool_result';
}

/**
 * User location for web search (used to provide more relevant results).
 */
export interface WebSearchUserLocation {
  type: 'approximate';
  /** City name */
  city?: string | null;
  /** Two-letter ISO country code */
  country?: string | null;
  /** Region/state name */
  region?: string | null;
  /** IANA timezone (e.g., "America/Los_Angeles") */
  timezone?: string | null;
}

/**
 * Web search server tool definition.
 * This is added to the tools array in API requests to enable web search.
 */
export interface WebSearchTool20250305 {
  /** Tool name - always 'web_search' */
  name: 'web_search';
  /** Tool type identifier */
  type: 'web_search_20250305';
  /** Only include results from these domains */
  allowed_domains?: string[] | null;
  /** Exclude results from these domains */
  blocked_domains?: string[] | null;
  /** Cache control for prompt caching */
  cache_control?: { type: 'ephemeral' } | null;
  /** Maximum number of times this tool can be used in a request */
  max_uses?: number | null;
  /** User's approximate location for more relevant results */
  user_location?: WebSearchUserLocation | null;
}

/**
 * Citation from web search results.
 */
export interface CitationsWebSearchResultLocation {
  /** The cited text */
  cited_text: string;
  /** Encrypted index for reference */
  encrypted_index: string;
  /** Title of the cited source */
  title: string | null;
  /** Type identifier */
  type: 'web_search_result_location';
  /** URL of the cited source */
  url: string;
}

/**
 * A tool use block parameter for input messages.
 * Identical to ToolUseBlock but used in request parameters.
 */
export interface ToolUseBlockParam {
  /** The type identifier for this content block */
  type: 'tool_use';
  /** Unique identifier for this tool use */
  id: string;
  /** Name of the tool that was used */
  name: string;
  /** Input parameters that were passed to the tool */
  input: unknown;
}

/**
 * A tool result block containing the output from a tool execution.
 *
 * The user returns this after executing a tool requested by the assistant.
 *
 * @example
 * ```typescript
 * const toolResult: ToolResultBlockParam = {
 *   type: 'tool_result',
 *   tool_use_id: 'toolu_01A09q90qw90lq917835lq9',
 *   content: 'The weather in San Francisco is 65°F and sunny.'
 * };
 * ```
 *
 * @example With error
 * ```typescript
 * const errorResult: ToolResultBlockParam = {
 *   type: 'tool_result',
 *   tool_use_id: 'toolu_01A09q90qw90lq917835lq9',
 *   content: 'Error: API key not configured',
 *   is_error: true
 * };
 * ```
 */
export interface ToolResultBlockParam {
  /** The type identifier for this content block */
  type: 'tool_result';
  /** ID of the tool use this is a result for */
  tool_use_id: string;
  /** The result content (can be string or array of content blocks) */
  content?: string | Array<TextBlockParam | ImageBlockParam>;
  /** Whether this represents an error result */
  is_error?: boolean;
}

/**
 * v2.1.33: Thinking block from Extended Thinking / Interleaved Thinking API.
 * Contains the model's reasoning process during extended thinking mode.
 */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

/**
 * v2.1.33: Redacted thinking block (content filtered by safety systems).
 */
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

/**
 * Union type of all possible content blocks in assistant responses.
 * Includes both client tools (tool_use) and server tools (server_tool_use, web_search_tool_result).
 * v2.1.33: Added ThinkingBlock and RedactedThinkingBlock for extended thinking support.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ServerToolUseBlock | WebSearchToolResultBlock | ThinkingBlock | RedactedThinkingBlock;

/**
 * Union type of all possible content blocks in user/input messages.
 */
export type ContentBlockParam = TextBlockParam | ImageBlockParam | DocumentBlockParam | ToolUseBlockParam | ToolResultBlockParam;

/**
 * Tool reference block (for file/resource references)
 * This is an internal type not part of the official API
 */
export interface ToolReferenceBlock {
  type: 'tool_reference';
  tool_use_id: string;
  path?: string;
}

/**
 * Union type of all possible content blocks for internal use.
 * This includes both response blocks and request blocks.
 * Use this for internal message processing and storage.
 */
export type AnyContentBlock = TextBlock | ToolUseBlock | ServerToolUseBlock | WebSearchToolResultBlock | ThinkingBlock | RedactedThinkingBlock | ImageBlockParam | DocumentBlockParam | ToolResultBlockParam | ToolReferenceBlock;

// ============ Message Types ============

/**
 * A message in a conversation.
 *
 * Messages alternate between user and assistant roles.
 *
 * @example User message with text
 * ```typescript
 * const message: MessageParam = {
 *   role: 'user',
 *   content: 'What is the weather like?'
 * };
 * ```
 *
 * @example User message with multiple content blocks
 * ```typescript
 * const message: MessageParam = {
 *   role: 'user',
 *   content: [
 *     { type: 'text', text: 'What is in this image?' },
 *     {
 *       type: 'image',
 *       source: {
 *         type: 'base64',
 *         media_type: 'image/png',
 *         data: '...'
 *       }
 *     }
 *   ]
 * };
 * ```
 */
export interface MessageParam {
  /** The role of the message sender */
  role: MessageRole;
  /** The message content (string shorthand or array of content blocks) */
  content: string | ContentBlockParam[];
}

/**
 * A complete message response from the Anthropic API.
 *
 * This is returned by the Messages API after the model generates a response.
 * For request messages, use MessageParam instead.
 */
export interface APIMessage {
  /**
   * Unique message identifier.
   * Format and length may change over time.
   */
  id: string;

  /**
   * The conversational role - always "assistant" for response messages.
   */
  role: 'assistant';

  /**
   * Content generated by the model.
   * Array of content blocks (text and/or tool_use).
   *
   * @example
   * ```json
   * [{ "type": "text", "text": "Hello! How can I help you?" }]
   * ```
   */
  content: ContentBlock[];

  /**
   * The model that generated this response.
   *
   * @example "claude-3-5-sonnet-20241022"
   */
  model: string;

  /**
   * The reason the model stopped generating.
   *
   * - `end_turn`: Natural stopping point
   * - `max_tokens`: Hit token limit
   * - `stop_sequence`: Hit a custom stop sequence
   * - `tool_use`: Model wants to use a tool
   *
   * In streaming mode, this is null in message_start and non-null otherwise.
   */
  stop_reason: StopReason | null;

  /**
   * Which custom stop sequence was generated, if any.
   * Non-null only when stop_reason is "stop_sequence".
   */
  stop_sequence: string | null;

  /**
   * Object type - always "message" for message objects.
   */
  type: 'message';

  /**
   * Token usage statistics for this request.
   * Used for billing and rate limiting.
   */
  usage: Usage;
}

/**
 * Generic message type for internal use.
 * Compatible with both user and assistant messages.
 * Use this for conversation history and session management.
 *
 * For API requests, use MessageParam.
 * For API responses, use APIMessage.
 */
export interface Message {
  /** Message role */
  role: MessageRole;
  /** Message content (string shorthand or array of content blocks) */
  content: string | AnyContentBlock[];
  /** Optional message ID (for assistant messages from API) */
  id?: string;
  /** Optional model (for assistant messages from API) */
  model?: string;
  /** Optional stop reason (for assistant messages from API) */
  stop_reason?: StopReason | null;
  /** Optional stop sequence (for assistant messages from API) */
  stop_sequence?: string | null;
  /** Optional message type (for assistant messages from API) */
  type?: 'message';
  /** Optional usage stats (for assistant messages from API) */
  usage?: Usage;

  // === 压缩相关元数据（对齐官方内部消息字段） ===

  /** 消息唯一标识（用于压缩边界追踪，对齐官方 uuid 字段） */
  uuid?: string;
  /** 标记此消息为压缩摘要（对齐官方 isCompactSummary） */
  isCompactSummary?: boolean;
  /** 标记此消息仅在对话记录中可见，不参与 UI 显示（对齐官方 isVisibleInTranscriptOnly） */
  isVisibleInTranscriptOnly?: boolean;
  /** 标记此消息为元消息（如工具结果包装），不算作用户实际输入（对齐官方 isMeta） */
  isMeta?: boolean;
}

/**
 * Possible reasons for the model to stop generating.
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

/**
 * Token usage statistics.
 *
 * Tracks input and output tokens for billing and rate limiting.
 * Note: Token counts may not match visible content one-to-one due to
 * internal formatting and parsing.
 */
export interface Usage {
  /** Number of input tokens consumed */
  input_tokens: number;
  /** Number of output tokens generated */
  output_tokens: number;
}

// ============ Streaming Events ============

/**
 * Event emitted when a message starts in streaming mode.
 *
 * This is the first event in a message stream.
 */
export interface MessageStartEvent {
  /** Event type */
  type: 'message_start';
  /** The initial message object (content will be empty) */
  message: APIMessage;
}

/**
 * Event emitted when the message delta updates in streaming mode.
 *
 * Contains updates to stop_reason and stop_sequence.
 */
export interface MessageDeltaEvent {
  /** Event type */
  type: 'message_delta';
  /** The delta containing updates */
  delta: MessageDelta;
  /** Updated usage statistics */
  usage: MessageDeltaUsage;
}

/**
 * Delta update for a message.
 */
export interface MessageDelta {
  /** Updated stop reason */
  stop_reason: StopReason | null;
  /** Updated stop sequence */
  stop_sequence: string | null;
}

/**
 * Usage statistics update in a message delta event.
 */
export interface MessageDeltaUsage {
  /** Cumulative output tokens used */
  output_tokens: number;
}

/**
 * Event emitted when the message completes in streaming mode.
 *
 * This is the final event in a message stream.
 */
export interface MessageStopEvent {
  /** Event type */
  type: 'message_stop';
}

/**
 * Event emitted when a content block starts in streaming mode.
 */
export interface ContentBlockStartEvent {
  /** Event type */
  type: 'content_block_start';
  /** Index of this content block in the content array */
  index: number;
  /** The content block being started */
  content_block: ContentBlock;
}

/**
 * Event emitted when a content block delta updates in streaming mode.
 *
 * Contains incremental updates to the content block.
 */
export interface ContentBlockDeltaEvent {
  /** Event type */
  type: 'content_block_delta';
  /** Index of the content block being updated */
  index: number;
  /** The delta update */
  delta: ContentBlockDelta;
}

/**
 * Delta update for a content block.
 */
export type ContentBlockDelta = TextDelta | InputJSONDelta;

/**
 * A text delta containing incremental text.
 */
export interface TextDelta {
  /** Delta type */
  type: 'text_delta';
  /** The incremental text */
  text: string;
}

/**
 * An input JSON delta containing partial JSON for tool inputs.
 */
export interface InputJSONDelta {
  /** Delta type */
  type: 'input_json_delta';
  /** Partial JSON string */
  partial_json: string;
}

/**
 * Event emitted when a content block completes in streaming mode.
 */
export interface ContentBlockStopEvent {
  /** Event type */
  type: 'content_block_stop';
  /** Index of the content block that stopped */
  index: number;
}

/**
 * Union type of all possible message stream events.
 *
 * Events arrive in this order:
 * 1. message_start
 * 2. content_block_start
 * 3. content_block_delta (multiple)
 * 4. content_block_stop
 * 5. message_delta
 * 6. message_stop
 */
export type MessageStreamEvent =
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent;

// ============ Tool Definitions ============

/**
 * Definition of a tool that the model can use.
 *
 * @example
 * ```typescript
 * const tool: Tool = {
 *   name: 'get_weather',
 *   description: 'Get the current weather for a location',
 *   input_schema: {
 *     type: 'object',
 *     properties: {
 *       location: {
 *         type: 'string',
 *         description: 'The city and state, e.g. San Francisco, CA'
 *       },
 *       unit: {
 *         type: 'string',
 *         enum: ['celsius', 'fahrenheit'],
 *         description: 'The unit of temperature'
 *       }
 *     },
 *     required: ['location']
 *   }
 * };
 * ```
 */
export interface Tool {
  /**
   * Name of the tool.
   * This is how the model will reference the tool in tool_use blocks.
   */
  name: string;

  /**
   * Description of what the tool does.
   * Should be detailed to help the model understand when and how to use it.
   */
  description?: string;

  /**
   * JSON Schema defining the tool's input parameters.
   * This describes the shape of the input object.
   */
  input_schema: ToolInputSchema;
}

/**
 * JSON Schema for a tool's input parameters.
 */
export interface ToolInputSchema {
  /** Must be "object" */
  type: 'object';
  /** Property definitions */
  properties?: Record<string, unknown>;
  /** List of required property names */
  required?: string[];
  /** Allow additional properties */
  [key: string]: unknown;
}

/**
 * How the model should use the provided tools.
 */
export type ToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool;

/**
 * The model will automatically decide whether to use tools.
 * This is the default behavior.
 */
export interface ToolChoiceAuto {
  /** Choice type */
  type: 'auto';
  /**
   * Whether to disable parallel tool use.
   * If true, model outputs at most one tool use.
   */
  disable_parallel_tool_use?: boolean;
}

/**
 * The model will use any available tool.
 * Forces the model to use at least one tool.
 */
export interface ToolChoiceAny {
  /** Choice type */
  type: 'any';
  /**
   * Whether to disable parallel tool use.
   * If true, model outputs exactly one tool use.
   */
  disable_parallel_tool_use?: boolean;
}

/**
 * The model will use the specified tool.
 * Forces the model to use a specific tool.
 */
export interface ToolChoiceTool {
  /** Choice type */
  type: 'tool';
  /** The name of the tool to use */
  name: string;
  /**
   * Whether to disable parallel tool use.
   * If true, model outputs exactly one tool use.
   */
  disable_parallel_tool_use?: boolean;
}

// ============ Request Metadata ============

/**
 * Metadata about the request.
 * Used for tracking and abuse detection.
 */
export interface Metadata {
  /**
   * External identifier for the user making the request.
   * Should be a UUID, hash, or other opaque identifier.
   * Do NOT include PII (name, email, phone, etc.)
   */
  user_id?: string | null;
}

// ============ Model Types ============

/**
 * Available Claude models.
 *
 * See https://docs.anthropic.com/en/docs/models-overview for details.
 */
export type Model =
  | 'claude-opus-4-20250514'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-sonnet-latest'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-sonnet-20240620'
  | 'claude-3-5-haiku-latest'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-opus-latest'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'
  | 'claude-2.1'
  | 'claude-2.0'
  | 'claude-instant-1.2'
  | (string & {}); // Allow custom model strings

// ============ Simplified Types for Internal Use ============

/**
 * Simplified message type for internal session management.
 * Compatible with both Anthropic SDK Message and MessageParam.
 */
export interface SessionMessage {
  /** Message role */
  role: MessageRole;
  /** Message content */
  content: string | AnyContentBlock[];
  /** Optional message ID (for assistant messages) */
  id?: string;
  /** Optional model (for assistant messages) */
  model?: string;
  /** Optional stop reason (for assistant messages) */
  stop_reason?: StopReason | null;
  /** Optional usage stats (for assistant messages) */
  usage?: Usage;
}

// ============ Legacy Type Aliases for Backward Compatibility ============

/**
 * @deprecated Use Tool instead
 * Legacy tool definition type for backward compatibility.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** 是否为 MCP 工具（用于 deferred tool 判断） */
  isMcp?: boolean;
}

/**
 * @deprecated Use MessageParam instead
 */
export type InputMessage = MessageParam;

/**
 * @deprecated Use APIMessage instead
 * Represents a response from the Anthropic API.
 */
export type OutputMessage = APIMessage;

/**
 * @deprecated Use ContentBlockParam instead
 */
export type InputContentBlock = ContentBlockParam;

/**
 * @deprecated Use ContentBlock instead
 */
export type OutputContentBlock = ContentBlock;
