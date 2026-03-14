/**
 * Ollama 协议适配器
 * 
 * 接收 Anthropic Messages API 格式的请求，转换为 OpenAI Chat Completions 格式调用 Ollama，
 * 再将 OpenAI 格式的响应转换回 Anthropic 格式返回。
 * 
 * 这使得 Axon 的 ClaudeClient（基于 Anthropic SDK）可以透明地调用本地 Ollama 模型。
 * 
 * 请求转换: POST /v1/messages → POST /v1/chat/completions
 * 响应转换: OpenAI SSE → Anthropic SSE
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';

// ============ 类型定义 ============

export interface OllamaAdapterConfig {
  /** 适配器监听端口 */
  port: number;
  /** Ollama 服务地址 (默认 http://localhost:11434) */
  ollamaUrl: string;
  /** 默认模型名 */
  model?: string;
}

// Anthropic 请求类型
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: string; text: string; cache_control?: any }>;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: any;
  stream?: boolean;
  temperature?: number;
  metadata?: any;
  betas?: string[];
  thinking?: any;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  source?: any;
  // cache_control 字段（直接忽略）
  cache_control?: any;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
  // cache_control（直接忽略）
  cache_control?: any;
  // 可能是 server tool（如 web_search）
  type?: string;
}

// OpenAI 请求类型
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

// ============ 请求转换 ============

/**
 * 提取 system prompt 字符串
 */
function extractSystemPrompt(system: AnthropicRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  // Array of blocks — 拼接 text 内容
  return system
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join('\n\n');
}

/**
 * 将 Anthropic messages 转换为 OpenAI messages
 */
function convertMessages(
  anthropicMessages: AnthropicMessage[],
  systemPrompt: string
): OpenAIMessage[] {
  const openaiMessages: OpenAIMessage[] = [];

  // System prompt 作为第一条消息
  if (systemPrompt) {
    openaiMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      openaiMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
      continue;
    }

    // content 是 block 数组
    if (!Array.isArray(msg.content)) continue;

    if (msg.role === 'assistant') {
      // 合并 text blocks + tool_use blocks
      const textParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_use' && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input || {}),
            },
          });
        }
        // thinking blocks — 忽略
      }

      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null,
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      openaiMessages.push(assistantMsg);
    } else if (msg.role === 'user') {
      // user content blocks: text, tool_result, image
      const textParts: string[] = [];
      const toolResults: Array<{ tool_call_id: string; content: string }> = [];

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_result' && block.tool_use_id) {
          // 提取 tool_result 内容
          let resultContent = '';
          if (typeof block.content === 'string') {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent = block.content
              .filter((c: any) => c.type === 'text' && c.text)
              .map((c: any) => c.text)
              .join('\n');
          }
          toolResults.push({
            tool_call_id: block.tool_use_id,
            content: resultContent,
          });
        } else if (block.type === 'image' && block.source) {
          // 图片内容 — 作为文本描述（大多数本地模型不支持 vision）
          textParts.push('[Image content omitted - local model may not support vision]');
        }
      }

      // 先输出 tool results（每个作为独立消息）
      for (const tr of toolResults) {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        });
      }

      // 再输出普通文本内容
      if (textParts.length > 0) {
        openaiMessages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
      }
    }
  }

  return openaiMessages;
}

/**
 * 将 Anthropic tools 转换为 OpenAI tools
 */
function convertTools(anthropicTools: AnthropicTool[]): OpenAITool[] {
  const tools: OpenAITool[] = [];

  for (const tool of anthropicTools) {
    // 跳过 server tools (如 web_search) — Ollama 不支持
    if (tool.type && tool.type !== 'custom') continue;

    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    });
  }

  return tools;
}

/**
 * 将 Anthropic 请求转换为 OpenAI 请求
 */
function convertRequest(anthropicReq: AnthropicRequest): any {
  const systemPrompt = extractSystemPrompt(anthropicReq.system);
  const messages = convertMessages(anthropicReq.messages, systemPrompt);

  const openaiReq: any = {
    model: anthropicReq.model,
    messages,
    max_tokens: anthropicReq.max_tokens,
    stream: true, // 总是使用流式
  };

  // Temperature
  if (anthropicReq.temperature !== undefined) {
    openaiReq.temperature = anthropicReq.temperature;
  }

  // Tools（如果有且模型支持）
  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    const tools = convertTools(anthropicReq.tools);
    if (tools.length > 0) {
      openaiReq.tools = tools;
    }
  }

  return openaiReq;
}

// ============ 响应转换 ============

/**
 * 生成 Anthropic 格式的消息 ID
 */
function generateMessageId(): string {
  return `msg_ollama_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * 生成 tool_use ID
 */
function generateToolUseId(): string {
  return `toolu_ollama_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * 构建 Anthropic message_start SSE 事件
 */
function buildMessageStartEvent(model: string, messageId: string): string {
  const event = {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  return `event: message_start\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构建 content_block_start 事件
 */
function buildContentBlockStartEvent(index: number, type: 'text' | 'tool_use', toolInfo?: { id: string; name: string }): string {
  let block: any;
  if (type === 'text') {
    block = { type: 'text', text: '' };
  } else {
    block = { type: 'tool_use', id: toolInfo!.id, name: toolInfo!.name, input: {} };
  }
  return `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index, content_block: block })}\n\n`;
}

/**
 * 构建 content_block_delta 事件
 */
function buildTextDeltaEvent(index: number, text: string): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  })}\n\n`;
}

/**
 * 构建 tool input delta 事件
 */
function buildToolInputDeltaEvent(index: number, partialJson: string): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  })}\n\n`;
}

/**
 * 构建 content_block_stop 事件
 */
function buildContentBlockStopEvent(index: number): string {
  return `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`;
}

/**
 * 构建 message_delta 事件（stop_reason）
 */
function buildMessageDeltaEvent(stopReason: string, outputTokens: number): string {
  return `event: message_delta\ndata: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  })}\n\n`;
}

/**
 * 构建 message_stop 事件
 */
function buildMessageStopEvent(): string {
  return `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
}

/**
 * 构建 ping 事件
 */
function buildPingEvent(): string {
  return `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`;
}

// ============ 流式处理 ============

/**
 * 处理 OpenAI 流式响应，转换为 Anthropic 流式响应
 */
async function handleStreamingResponse(
  ollamaUrl: string,
  openaiRequest: any,
  res: http.ServerResponse,
  requestModel: string
): Promise<void> {
  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const messageId = generateMessageId();

  // 发送 message_start
  res.write(buildMessageStartEvent(requestModel, messageId));
  res.write(buildPingEvent());

  // 调用 Ollama OpenAI 兼容端点
  const url = new URL('/v1/chat/completions', ollamaUrl);
  
  const requestBody = JSON.stringify(openaiRequest);
  
  const fetchResponse = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  if (!fetchResponse.ok) {
    const errorBody = await fetchResponse.text();
    console.error(`[OllamaAdapter] Ollama returned ${fetchResponse.status}: ${errorBody}`);
    
    // 返回 Anthropic 格式的错误
    res.write(buildContentBlockStartEvent(0, 'text'));
    res.write(buildTextDeltaEvent(0, `Error from Ollama (${fetchResponse.status}): ${errorBody}`));
    res.write(buildContentBlockStopEvent(0));
    res.write(buildMessageDeltaEvent('end_turn', 0));
    res.write(buildMessageStopEvent());
    res.end();
    return;
  }

  if (!fetchResponse.body) {
    res.write(buildContentBlockStartEvent(0, 'text'));
    res.write(buildTextDeltaEvent(0, 'Error: No response body from Ollama'));
    res.write(buildContentBlockStopEvent(0));
    res.write(buildMessageDeltaEvent('end_turn', 0));
    res.write(buildMessageStopEvent());
    res.end();
    return;
  }

  // 流式解析 OpenAI SSE 并转换
  let currentBlockIndex = 0;
  let textBlockStarted = false;
  let outputTokenCount = 0;
  let hasToolCalls = false;
  // 累积 tool call 数据（OpenAI 的 tool_calls 是分片到达的）
  const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let finishReason: string | null = null;

  const reader = fetchResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行解析 SSE
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          finishReason = finishReason || 'end_turn';
          continue;
        }

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // 跳过无法解析的行
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        // 文本内容
        if (delta.content) {
          if (!textBlockStarted) {
            res.write(buildContentBlockStartEvent(currentBlockIndex, 'text'));
            textBlockStarted = true;
          }
          res.write(buildTextDeltaEvent(currentBlockIndex, delta.content));
          outputTokenCount += Math.ceil(delta.content.length / 4); // 粗略估计
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;

            if (!toolCallAccumulator.has(tcIndex)) {
              // 新的 tool call — 先关闭文本 block
              if (textBlockStarted) {
                res.write(buildContentBlockStopEvent(currentBlockIndex));
                currentBlockIndex++;
                textBlockStarted = false;
              }

              const toolId = tc.id || generateToolUseId();
              const toolName = tc.function?.name || '';
              toolCallAccumulator.set(tcIndex, { id: toolId, name: toolName, arguments: '' });

              // 开始 tool_use block
              res.write(buildContentBlockStartEvent(currentBlockIndex, 'tool_use', { id: toolId, name: toolName }));
              hasToolCalls = true;
            }

            // 累积 arguments
            const acc = toolCallAccumulator.get(tcIndex)!;
            if (tc.function?.name && !acc.name) {
              acc.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              acc.arguments += tc.function.arguments;
              res.write(buildToolInputDeltaEvent(currentBlockIndex, tc.function.arguments));
            }
          }
        }

        // finish_reason
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }
  } catch (streamError) {
    console.error('[OllamaAdapter] Stream read error:', streamError);
  }

  // 关闭打开的 blocks
  if (textBlockStarted) {
    res.write(buildContentBlockStopEvent(currentBlockIndex));
    currentBlockIndex++;
  }

  // 关闭所有打开的 tool_use blocks
  if (hasToolCalls) {
    // tool blocks 在累积器中，每个开始但未关闭的
    for (const [, ] of toolCallAccumulator) {
      res.write(buildContentBlockStopEvent(currentBlockIndex));
      currentBlockIndex++;
    }
  }

  // 映射 stop_reason
  let anthropicStopReason = 'end_turn';
  if (finishReason === 'tool_calls') {
    anthropicStopReason = 'tool_use';
  } else if (finishReason === 'length') {
    anthropicStopReason = 'max_tokens';
  }

  // 发送 message_delta 和 message_stop
  res.write(buildMessageDeltaEvent(anthropicStopReason, outputTokenCount));
  res.write(buildMessageStopEvent());
  res.end();
}

// ============ 非流式处理 ============

/**
 * 处理非流式请求（把 Ollama 响应转换为 Anthropic 非流式响应）
 */
async function handleNonStreamingResponse(
  ollamaUrl: string,
  openaiRequest: any,
  res: http.ServerResponse,
  requestModel: string
): Promise<void> {
  // 非流式调用
  openaiRequest.stream = false;

  const url = new URL('/v1/chat/completions', ollamaUrl);
  const fetchResponse = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(openaiRequest),
  });

  if (!fetchResponse.ok) {
    const errorBody = await fetchResponse.text();
    res.writeHead(fetchResponse.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `Ollama error: ${errorBody}` },
    }));
    return;
  }

  const openaiResponse = await fetchResponse.json() as any;
  const choice = openaiResponse.choices?.[0];

  const content: any[] = [];

  // 文本内容
  if (choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  // Tool calls
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      content.push({
        type: 'tool_use',
        id: tc.id || generateToolUseId(),
        name: tc.function.name,
        input: args,
      });
    }
  }

  let stopReason = 'end_turn';
  if (choice?.finish_reason === 'tool_calls') {
    stopReason = 'tool_use';
  } else if (choice?.finish_reason === 'length') {
    stopReason = 'max_tokens';
  }

  const anthropicResponse = {
    id: generateMessageId(),
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0,
    },
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(anthropicResponse));
}

// ============ HTTP 服务器 ============

let adapterServer: http.Server | null = null;
let adapterPort: number | null = null;

/**
 * 启动 Ollama 适配器服务器
 * 返回适配器的 baseURL（供 ClaudeClient 使用）
 */
export async function startOllamaAdapter(config: OllamaAdapterConfig): Promise<string> {
  // 如果已在运行，先停止
  if (adapterServer) {
    await stopOllamaAdapter();
  }

  const ollamaUrl = config.ollamaUrl.replace(/\/$/, '');

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    // 只处理 POST /v1/messages
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // 读取请求体
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
      }
    } catch (err) {
      console.error('[OllamaAdapter] Failed to read request body:', err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

    let anthropicReq: AnthropicRequest;
    try {
      anthropicReq = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // 转换请求
    const openaiReq = convertRequest(anthropicReq);

    // 覆盖模型名（如果配置了默认模型且请求中的模型是 Claude 系列）
    if (config.model && isClaude(anthropicReq.model)) {
      openaiReq.model = config.model;
    }

    // 判断是否流式
    const isStream = req.headers['accept']?.includes('text/event-stream') ||
                     anthropicReq.stream !== false;

    try {
      if (isStream) {
        await handleStreamingResponse(ollamaUrl, openaiReq, res, anthropicReq.model);
      } else {
        await handleNonStreamingResponse(ollamaUrl, openaiReq, res, anthropicReq.model);
      }
    } catch (error: any) {
      console.error('[OllamaAdapter] Request handling error:', error);
      
      // 检查是否是连接错误（Ollama 未运行）
      if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message: `Cannot connect to Ollama at ${ollamaUrl}. Is Ollama running? Start it with: ollama serve`,
          },
        }));
        return;
      }

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: error.message || 'Internal adapter error' },
        }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(config.port, '127.0.0.1', () => {
      adapterServer = server;
      adapterPort = config.port;
      const baseUrl = `http://127.0.0.1:${config.port}`;
      console.log(`[OllamaAdapter] Started on ${baseUrl}, proxying to ${ollamaUrl}`);
      resolve(baseUrl);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // 端口被占用，尝试下一个端口
        console.warn(`[OllamaAdapter] Port ${config.port} in use, trying ${config.port + 1}`);
        server.listen(config.port + 1, '127.0.0.1', () => {
          adapterServer = server;
          adapterPort = config.port + 1;
          const baseUrl = `http://127.0.0.1:${config.port + 1}`;
          console.log(`[OllamaAdapter] Started on ${baseUrl}, proxying to ${ollamaUrl}`);
          resolve(baseUrl);
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * 停止 Ollama 适配器
 */
export async function stopOllamaAdapter(): Promise<void> {
  if (adapterServer) {
    return new Promise((resolve) => {
      adapterServer!.close(() => {
        console.log('[OllamaAdapter] Stopped');
        adapterServer = null;
        adapterPort = null;
        resolve();
      });
    });
  }
}

/**
 * 获取当前适配器地址（如果在运行）
 */
export function getOllamaAdapterUrl(): string | null {
  if (adapterServer && adapterPort) {
    return `http://127.0.0.1:${adapterPort}`;
  }
  return null;
}

/**
 * 检查是否是 Claude 模型名
 */
function isClaude(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes('claude') || lower === 'opus' || lower === 'sonnet' || lower === 'haiku';
}

/**
 * 测试 Ollama 连接
 */
export async function testOllamaConnection(ollamaUrl: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const url = new URL('/api/tags', ollamaUrl.replace(/\/$/, ''));
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return { ok: false, error: `Ollama returned ${response.status}` };
    }
    const data = await response.json() as any;
    const models = (data.models || []).map((m: any) => m.name);
    return { ok: true, models };
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
      return { ok: false, error: `Cannot connect to Ollama at ${ollamaUrl}. Is Ollama running?` };
    }
    return { ok: false, error: error.message || 'Unknown error' };
  }
}
