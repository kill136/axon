import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ToolDefinition } from '../../../src/types/index.js';
import { CodexConversationClient } from '../../../src/web/server/runtime/codex-client.js';

describe('CodexConversationClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function collectStreamEvents(client: CodexConversationClient, messages: Message[]) {
    const events: Array<Record<string, any>> = [];
    for await (const event of client.createMessageStream(messages)) {
      events.push(event as Record<string, any>);
    }
    return events;
  }

  it('should send ChatGPT auth headers and responses payload', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 7,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'haiku',
      authToken: 'chatgpt-token',
      accountId: 'acct_123',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    });

    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '帮我看下文件' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'README.md' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file content' }],
      },
    ];

    const tools: ToolDefinition[] = [
      {
        name: 'Read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
          },
          required: ['file_path'],
        },
      },
    ];

    const response = await client.createMessage(messages, tools, '你是一个 coding assistant', {
      enableThinking: true,
      toolChoice: { type: 'tool', name: 'Read' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer chatgpt-token',
      'ChatGPT-Account-ID': 'acct_123',
    });

    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: 'gpt-5-codex',
      instructions: '你是一个 coding assistant',
      stream: false,
      store: false,
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
      tool_choice: {
        type: 'function',
        name: 'Read',
      },
      tools: [
        {
          type: 'function',
          name: 'Read',
          description: 'Read a file',
        },
      ],
    });
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '帮我看下文件' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'Read',
        arguments: JSON.stringify({ file_path: 'README.md' }),
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'file content',
      },
    ]);

    expect(response.model).toBe('gpt-5-codex');
    expect(response.stopReason).toBe('end_turn');
    expect(response.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(response.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 7,
      thinkingTokens: 0,
    });
  });

  it('should map reasoning and function calls back to content blocks', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex-mini',
        output: [
          {
            type: 'reasoning',
            summary: [{ text: '先读文件再总结' }],
          },
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'Read',
            arguments: JSON.stringify({ file_path: 'docs/spec.md' }),
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: '我先读取文档。' }],
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          reasoning_tokens: 5,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex-mini',
      apiKey: 'sk-test',
    });

    const response = await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '总结 spec' }],
      },
    ]);

    expect(response.stopReason).toBe('tool_use');
    expect(response.content).toEqual([
      { type: 'thinking', thinking: '先读文件再总结' },
      {
        type: 'tool_use',
        id: 'call_2',
        name: 'Read',
        input: { file_path: 'docs/spec.md' },
      },
      { type: 'text', text: '我先读取文档。' },
    ]);
    expect(response.usage).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      thinkingTokens: 5,
    });
  });

  it('should forward high reasoning effort to Codex responses requests', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: {
          input_tokens: 4,
          output_tokens: 2,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      apiKey: 'sk-test',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '深度思考一下' }],
      },
    ], undefined, undefined, {
      enableThinking: true,
      reasoningEffort: 'high',
    });

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.reasoning).toEqual({
      effort: 'high',
      summary: 'auto',
    });
  });

  it('should forward xhigh reasoning effort to GPT-5.4 requests', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: {
          input_tokens: 4,
          output_tokens: 2,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '多想一点' }],
      },
    ], undefined, undefined, {
      enableThinking: true,
      reasoningEffort: 'xhigh',
    });

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.reasoning).toEqual({
      effort: 'xhigh',
      summary: 'auto',
    });
  });

  it('should forward none reasoning effort when thinking is disabled', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: {
          input_tokens: 4,
          output_tokens: 2,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      apiKey: 'sk-test',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '不要思考' }],
      },
    ], undefined, undefined, {
      enableThinking: false,
      reasoningEffort: 'none',
    });

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.reasoning).toEqual({
      effort: 'none',
      summary: 'auto',
    });
  });

  it('should send default instructions and fallback model for Claude aliases', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5.1-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'OK' }],
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 2,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'claude-opus-4-1-20250805',
      apiKey: 'sk-test',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: 'ping' }],
      },
    ]);

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('gpt-5-codex');
    expect(body.instructions).toContain('coding assistant');
  });

  it('should append /v1/responses for root OpenAI-compatible endpoints', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'OK' }],
          },
        ],
        usage: {
          input_tokens: 2,
          output_tokens: 1,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: 'ping' }],
      },
    ]);

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chatbi.site/v1/responses');
  });

  it('should allow arbitrary model ids on custom responses-compatible endpoints', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'kimi-k2.5',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '我是 Kimi' }],
          },
        ],
        usage: {
          input_tokens: 3,
          output_tokens: 2,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '你是谁' }],
      },
    ], undefined, undefined, { enableThinking: true });

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('kimi-k2.5');
    expect(body.reasoning).toBeUndefined();
  });

  it('should ignore incompatible customModelName values and fall back to gpt-5-codex', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'OK' }],
          },
        ],
        usage: {
          input_tokens: 4,
          output_tokens: 1,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      apiKey: 'sk-test',
      customModelName: 'mimo-v2-pro',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: 'ping' }],
      },
    ]);

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('gpt-5-codex');
  });

  it('should encode assistant history text as output_text for Codex responses', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-5-codex',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '继续说。' }],
          },
        ],
        usage: {
          input_tokens: 11,
          output_tokens: 3,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      apiKey: 'sk-test',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '第一句' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '这是上一轮回复' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '继续' }],
      },
    ]);

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '第一句' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '这是上一轮回复' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '继续' }],
      },
    ]);
  });

  it('should fall back to a non-stream JSON payload when a Responses proxy does not emit SSE', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'application/json',
      }),
      text: async () => JSON.stringify({
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'hello from json fallback' }],
          },
        ],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'ping' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'text', text: 'hello from json fallback' },
      {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
  });

  it('should fall back to chat completions when a custom Responses endpoint returns an HTML timeout page', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 524,
        statusText: 'A timeout occurred',
        headers: new Headers({
          'content-type': 'text/html',
        }),
        text: async () => '<!DOCTYPE html><html><head><title>openai-next.com | 524: A timeout occurred</title></head><body>timeout</body></html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'gpt-5.4',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'fallback ok',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 4,
          },
        }),
      });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai-next.com',
    });

    const response = await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: 'summarize this conversation' }],
      },
    ]);

    expect(response.content).toEqual([{ type: 'text', text: 'fallback ok' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.openai-next.com/v1/responses');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://api.openai-next.com/v1/chat/completions');
  });

  it('should collapse HTML error pages into a concise chat completions error', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 524,
      statusText: 'A timeout occurred',
      headers: new Headers({
        'content-type': 'text/html',
      }),
      text: async () => '<!DOCTYPE html><html><head><title>openai-next.com | 524: A timeout occurred</title></head><body>timeout</body></html>',
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai-next.com',
    });

    await expect(client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: 'ping' }],
      },
    ])).rejects.toThrow('OpenAI-compatible request failed (HTTP 524 A timeout occurred): openai-next.com | 524: A timeout occurred');
  });

  it('should recover when a proxy ends the stream with a raw JSON payload instead of SSE frames', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(JSON.stringify({
            model: 'gpt-5.4',
            output: [
              {
                type: 'function_call',
                call_id: 'call_9',
                name: 'Read',
                arguments: JSON.stringify({ file_path: 'README.md' }),
              },
            ],
            usage: {
              input_tokens: 6,
              output_tokens: 2,
            },
          }));
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'read readme' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'tool_use_start', id: 'call_9', name: 'Read' },
      { type: 'tool_use_complete', id: 'call_9', input: { file_path: 'README.md' } },
      {
        type: 'usage',
        usage: {
          inputTokens: 6,
          outputTokens: 2,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'tool_use' },
    ]);
  });

  it('should emit reasoning when Responses streams summary done events', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.reasoning_summary.done',
              item_id: 'rs_1',
              output_index: 0,
              summary_index: 0,
              text: '先检查模型配置，再输出结论。',
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                model: 'gpt-5-codex',
                output: [
                  {
                    id: 'rs_1',
                    type: 'reasoning',
                    summary: [{ text: '先检查模型配置，再输出结论。' }],
                  },
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: '已经处理好了。' }],
                  },
                ],
                usage: {
                  input_tokens: 8,
                  output_tokens: 4,
                  reasoning_tokens: 3,
                },
              },
            })}\n\n`,
          );
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5-codex',
      apiKey: 'sk-test',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: '帮我检查一下当前配置' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'thinking', thinking: '先检查模型配置，再输出结论。' },
      { type: 'text', text: '已经处理好了。' },
      {
        type: 'usage',
        usage: {
          inputTokens: 8,
          outputTokens: 4,
          thinkingTokens: 3,
        },
      },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
  });

  it('should emit reasoning from output_item.done snapshots when no deltas are present', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                id: 'rs_2',
                type: 'reasoning',
                summary: [{ text: '先读取会话，再归纳思路。' }],
              },
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                model: 'gpt-5.4',
                output: [
                  {
                    id: 'rs_2',
                    type: 'reasoning',
                    summary: [{ text: '先读取会话，再归纳思路。' }],
                  },
                ],
                usage: {
                  input_tokens: 6,
                  output_tokens: 2,
                  reasoning_tokens: 2,
                },
              },
            })}\n\n`,
          );
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: '总结一下刚才的会话' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'thinking', thinking: '先读取会话，再归纳思路。' },
      {
        type: 'usage',
        usage: {
          inputTokens: 6,
          outputTokens: 2,
          thinkingTokens: 2,
        },
      },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
  });

  it('should not replay streamed Responses tool calls from response.completed', async () => {
    const args = {
      questions: [
        {
          header: '要做什么',
          question: '你发的“1”目前缺少明确上下文，要我基于这批改动执行哪一种？',
          options: [
            { label: '代码审查', description: '基于当前改动检查代码质量、风险和潜在问题。' },
          ],
        },
      ],
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.output_item.added',
              item: {
                type: 'function_call',
                call_id: 'call_ask_1',
                name: 'AskUserQuestion',
              },
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.function_call_arguments.done',
              call_id: 'call_ask_1',
              arguments: JSON.stringify(args),
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                model: 'gpt-5.4',
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_ask_1',
                    name: 'AskUserQuestion',
                    arguments: JSON.stringify(args),
                  },
                ],
                usage: {
                  input_tokens: 8,
                  output_tokens: 3,
                },
              },
            })}\n\n`,
          );
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: '1' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'tool_use_start', id: 'call_ask_1', name: 'AskUserQuestion' },
      { type: 'tool_use_complete', id: 'call_ask_1', input: args },
      {
        type: 'usage',
        usage: {
          inputTokens: 8,
          outputTokens: 3,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'tool_use' },
    ]);
  });

  it('should keep a single canonical tool id when Responses stream mixes item id and call_id', async () => {
    const editArgs = {
      file_path: 'src/core/loop.ts',
      old_string: 'before',
      new_string: 'after',
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.output_item.added',
              item: {
                type: 'function_call',
                id: 'fc_edit_1',
                name: 'Edit',
              },
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.function_call_arguments.done',
              call_id: 'call_edit_1',
              arguments: JSON.stringify(editArgs),
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                model: 'gpt-5.4',
                output: [
                  {
                    type: 'function_call',
                    id: 'fc_edit_1',
                    call_id: 'call_edit_1',
                    name: 'Edit',
                    arguments: JSON.stringify(editArgs),
                  },
                ],
                usage: {
                  input_tokens: 12,
                  output_tokens: 3,
                },
              },
            })}\n\n`,
          );
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: '修一下 loop.ts' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'tool_use_start', id: 'fc_edit_1', name: 'Edit' },
      { type: 'tool_use_complete', id: 'fc_edit_1', input: editArgs },
      {
        type: 'usage',
        usage: {
          inputTokens: 12,
          outputTokens: 3,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'tool_use' },
    ]);
  });

  it('should dedupe fallback chat completions tool calls when a gateway replays the same call', async () => {
    const fallbackArgs = {
      file_path: 'src/core/loop.ts',
      old_string: 'foo',
      new_string: 'bar',
    };

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 501,
      statusText: 'Not Implemented',
      headers: new Headers({
        'content-type': 'application/json',
      }),
      text: async () => JSON.stringify({ message: 'convert_request_failed' }),
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_edit_2',
                        function: {
                          name: 'Edit',
                          arguments: '{"file_path":"src/core/loop.ts"',
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 1,
                        id: 'call_edit_2',
                        function: {
                          name: 'Edit',
                          arguments: JSON.stringify(fallbackArgs),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          );
          yield new TextEncoder().encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  finish_reason: 'tool_calls',
                },
              ],
              usage: {
                prompt_tokens: 14,
                completion_tokens: 5,
              },
            })}\n\n`,
          );
          yield new TextEncoder().encode('data: [DONE]\n\n');
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site/v1',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: '修一下 edit 逻辑' }],
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'tool_use_start', id: 'call_edit_2', name: 'Edit' },
      { type: 'tool_use_delta', id: 'call_edit_2', input: '{"file_path":"src/core/loop.ts"' },
      { type: 'tool_use_delta', id: 'call_edit_2', input: ',"old_string":"foo","new_string":"bar"}' },
      { type: 'tool_use_complete', id: 'call_edit_2', input: fallbackArgs },
      {
        type: 'usage',
        usage: {
          inputTokens: 14,
          outputTokens: 5,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'tool_use' },
    ]);
  });

  it('should use chat completions transport for custom non-codex models', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'kimi-k2.5',
        choices: [
          {
            message: {
              content: '我是 Kimi。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    const response = await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '你是谁' }],
      },
    ]);

    const [url, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chatbi.site/v1/chat/completions');
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('kimi-k2.5');
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '你是谁',
      },
    ]);
    expect(response.content).toEqual([{ type: 'text', text: '我是 Kimi。' }]);
    expect(response.stopReason).toBe('end_turn');
  });

  it('should include reasoning_content when replaying assistant tool-call history in chat completions', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'kimi-k2.5',
        choices: [
          {
            message: {
              content: '继续处理。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    await client.createMessage([
      {
        role: 'user',
        content: [{ type: 'text', text: '读一下配置' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取配置，再分析差异。' } as any,
          { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'config.json' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '配置内容' }],
      },
    ]);

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '读一下配置',
      },
      {
        role: 'assistant',
        content: null,
        reasoning_content: '先读取配置，再分析差异。',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'Read',
              arguments: JSON.stringify({ file_path: 'config.json' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: '配置内容',
      },
    ]);
  });

  it('should emit empty reasoning_content for assistant tool-call history when no thinking block is available', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'kimi-k2.5',
        choices: [
          {
            message: {
              content: '继续处理。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 3,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    await client.createMessage([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_2', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'README 内容' }],
      },
    ]);

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        reasoning_content: '',
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'Read',
              arguments: JSON.stringify({ file_path: 'README.md' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_2',
        content: 'README 内容',
      },
    ]);
  });

  it('should omit reasoning_content history when thinking is disabled for chat completions transport', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'kimi-k2.5',
        choices: [
          {
            message: {
              content: '继续处理。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 3,
        },
      }),
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    await client.createMessage([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取 README。' } as any,
          { type: 'tool_use', id: 'call_3', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_3', content: 'README 内容' }],
      },
    ], undefined, undefined, {
      enableThinking: false,
      reasoningEffort: 'none',
    });

    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_3',
            type: 'function',
            function: {
              name: 'Read',
              arguments: JSON.stringify({ file_path: 'README.md' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_3',
        content: 'README 内容',
      },
    ]);
    expect(body.messages[0]).not.toHaveProperty('reasoning_content');
  });

  it('should parse chat completions streaming payloads for custom non-codex models', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n');
          yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"，我是 Kimi。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":6}}\n');
          yield new TextEncoder().encode('data: [DONE]\n');
        },
      },
    });

    const client = new CodexConversationClient({
      provider: 'codex',
      model: 'kimi-k2.5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.chatbi.site',
    });

    const events = await collectStreamEvents(client, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
      },
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.chatbi.site/v1/chat/completions',
      expect.any(Object),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'response_headers' }),
      { type: 'text', text: '你好' },
      { type: 'text', text: '，我是 Kimi。' },
      {
        type: 'usage',
        usage: {
          inputTokens: 5,
          outputTokens: 6,
          thinkingTokens: 0,
        },
      },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
  });
});
