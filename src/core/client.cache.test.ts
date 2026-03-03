/**
 * client.ts 缓存相关功能单元测试
 *
 * v6.1 对齐官方缓存机制：
 *   1. formatMessages — 最后 2 条消息添加 cache_control，接受 querySource 参数
 *   2. isPromptCachingEnabled — DISABLE_PROMPT_CACHING 系列 env var 按型号控制
 *   3. buildCacheControl — 支持 global/org scope
 *   4. formatSystemPrompt — 支持 skipGlobalCacheForSystemPrompt 降级逻辑
 *   5. buildApiTools — 不给 tools 加 cache_control（对齐官方）
 *   6. trackCacheState + reportCacheBreak — 缓存破裂追踪系统
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isPromptCachingEnabled,
  buildCacheControl,
  formatMessages,
  formatSystemPrompt,
  buildApiTools,
  hashContent,
  stripCacheControlFields,
  getSystemCharCount,
  trackCacheState,
  reportCacheBreak,
  cacheBreakMap,
} from './client.js';

// ─── isPromptCachingEnabled ──────────────────────────────────────────────────

describe('isPromptCachingEnabled', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.DISABLE_PROMPT_CACHING;
    delete process.env.DISABLE_PROMPT_CACHING_HAIKU;
    delete process.env.DISABLE_PROMPT_CACHING_SONNET;
    delete process.env.DISABLE_PROMPT_CACHING_OPUS;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('默认情况下对所有模型启用', () => {
    expect(isPromptCachingEnabled('claude-sonnet-4-6')).toBe(true);
    expect(isPromptCachingEnabled('claude-haiku-4-5')).toBe(true);
    expect(isPromptCachingEnabled('claude-opus-4-6')).toBe(true);
  });

  it('DISABLE_PROMPT_CACHING 禁用所有模型', () => {
    process.env.DISABLE_PROMPT_CACHING = '1';
    expect(isPromptCachingEnabled('claude-sonnet-4-6')).toBe(false);
    expect(isPromptCachingEnabled('claude-haiku-4-5')).toBe(false);
    expect(isPromptCachingEnabled('claude-opus-4-6')).toBe(false);
  });

  it('DISABLE_PROMPT_CACHING_HAIKU 仅禁用 haiku', () => {
    process.env.DISABLE_PROMPT_CACHING_HAIKU = '1';
    expect(isPromptCachingEnabled('claude-haiku-4-5')).toBe(false);
    expect(isPromptCachingEnabled('claude-sonnet-4-6')).toBe(true);
    expect(isPromptCachingEnabled('claude-opus-4-6')).toBe(true);
  });

  it('DISABLE_PROMPT_CACHING_SONNET 仅禁用 sonnet', () => {
    process.env.DISABLE_PROMPT_CACHING_SONNET = '1';
    expect(isPromptCachingEnabled('claude-sonnet-4-6')).toBe(false);
    expect(isPromptCachingEnabled('claude-haiku-4-5')).toBe(true);
    expect(isPromptCachingEnabled('claude-opus-4-6')).toBe(true);
  });

  it('DISABLE_PROMPT_CACHING_OPUS 仅禁用 opus', () => {
    process.env.DISABLE_PROMPT_CACHING_OPUS = '1';
    expect(isPromptCachingEnabled('claude-opus-4-6')).toBe(false);
    expect(isPromptCachingEnabled('claude-sonnet-4-6')).toBe(true);
    expect(isPromptCachingEnabled('claude-haiku-4-5')).toBe(true);
  });
});

// ─── buildCacheControl ───────────────────────────────────────────────────────

describe('buildCacheControl', () => {
  it('org scope → 仅 type:ephemeral', () => {
    expect(buildCacheControl('org')).toEqual({ type: 'ephemeral' });
  });

  it('global scope → type:ephemeral + scope:global', () => {
    expect(buildCacheControl('global')).toEqual({ type: 'ephemeral', scope: 'global' });
  });
});

// ─── formatMessages ──────────────────────────────────────────────────────────

describe('formatMessages', () => {
  function makeMessages(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));
  }

  it('3 条消息时，最后 2 条得到 cache_control，第 1 条不加', () => {
    const msgs = makeMessages(3);
    const result = formatMessages(msgs);

    const content0 = result[0].content;
    const content1 = result[1].content;
    const content2 = result[2].content;

    // 第 0 条：无 cache_control
    expect(content0[0].cache_control).toBeUndefined();
    // 第 1、2 条：有 cache_control
    expect(content1[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(content2[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('5 条消息时，只有最后 2 条得到 cache_control', () => {
    const msgs = makeMessages(5);
    const result = formatMessages(msgs);

    for (let i = 0; i < 3; i++) {
      expect(result[i].content[0].cache_control).toBeUndefined();
    }
    expect(result[3].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(result[4].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('1 条消息时，那 1 条得到 cache_control', () => {
    const msgs = makeMessages(1);
    const result = formatMessages(msgs);
    expect(result[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('enableCaching=false 时所有消息都不加 cache_control', () => {
    const msgs = makeMessages(4);
    const result = formatMessages(msgs, false, false);
    for (const msg of result) {
      expect(msg.content[0].cache_control).toBeUndefined();
    }
  });

  it('接受 querySource 参数（保持接口对齐官方 S2z）', () => {
    const msgs = makeMessages(3);
    const result = formatMessages(msgs, false, true, 'repl_main_thread');

    // querySource 目前不影响输出（ttl 逻辑未实现），但接口需要对齐
    expect(result[1].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(result[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('thinking block 不加 cache_control（即使是最后一个 block）', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'some reasoning', signature: 'sig' },
        ],
      },
    ];
    const result = formatMessages(msgs, true);
    // thinking block 本身不加 cache_control
    expect(result[0].content[0].cache_control).toBeUndefined();
  });

  it('数组 content 中：最后一个非 thinking block 加 cache_control', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
        ],
      },
    ];
    const result = formatMessages(msgs);
    // 第一个 block 不加
    expect(result[0].content[0].cache_control).toBeUndefined();
    // 最后一个 block 加
    expect(result[0].content[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('enableThinking=false 时过滤掉历史 thinking blocks', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought', signature: 'sig' },
          { type: 'text', text: 'answer' },
        ],
      },
    ];
    const result = formatMessages(msgs, false);
    // thinking block 被过滤
    expect(result[0].content.length).toBe(1);
    expect(result[0].content[0].type).toBe('text');
  });
});

// ─── formatSystemPrompt ─────────────────────────────────────────────────────

describe('formatSystemPrompt', () => {
  it('enableCaching=false 时不加 cache_control', () => {
    const result = formatSystemPrompt('hello', false, undefined, false) as any[];
    expect(result[0].cache_control).toBeUndefined();
  });

  it('非 OAuth 模式：单 block 加 type:ephemeral', () => {
    const result = formatSystemPrompt('hello', false, undefined, true) as any[];
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('PromptBlock 中 cacheScope=global 加 scope:global', () => {
    const blocks = [{ text: 'static part', cacheScope: 'global' as const }];
    const result = formatSystemPrompt('static part', false, blocks, true) as any[];
    expect(result[0].cache_control).toEqual({ type: 'ephemeral', scope: 'global' });
  });

  it('PromptBlock 中 cacheScope=null 不加 cache_control', () => {
    const blocks = [{ text: 'dynamic part', cacheScope: null }];
    const result = formatSystemPrompt('dynamic part', false, blocks, true) as any[];
    expect(result[0].cache_control).toBeUndefined();
  });

  it('无 system prompt 且非 OAuth → undefined', () => {
    const result = formatSystemPrompt(undefined, false, undefined, true);
    expect(result).toBeUndefined();
  });

  it('空字符串 system prompt 且非 OAuth → undefined', () => {
    const result = formatSystemPrompt('', false, undefined, true);
    expect(result).toBeUndefined();
  });

  // v6.1: skipGlobalCacheForSystemPrompt 测试
  it('skipGlobalCacheForSystemPrompt="system_prompt" 时 global 降级为 org', () => {
    const blocks = [
      { text: 'static part', cacheScope: 'global' as const },
      { text: 'dynamic part', cacheScope: null },
    ];
    const result = formatSystemPrompt('combined', false, blocks, true, 'system_prompt') as any[];
    // static block: 原本 global → 降级为 org（无 scope 字段）
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
    // dynamic block: null → 不加 cache_control
    expect(result[1].cache_control).toBeUndefined();
  });

  it('skipGlobalCacheForSystemPrompt="none" 时保持 global', () => {
    const blocks = [
      { text: 'static part', cacheScope: 'global' as const },
      { text: 'dynamic part', cacheScope: null },
    ];
    const result = formatSystemPrompt('combined', false, blocks, true, 'none') as any[];
    expect(result[0].cache_control).toEqual({ type: 'ephemeral', scope: 'global' });
    expect(result[1].cache_control).toBeUndefined();
  });

  it('skipGlobalCacheForSystemPrompt 对 org scope blocks 无影响', () => {
    const blocks = [{ text: 'org text', cacheScope: 'org' as const }];
    const result1 = formatSystemPrompt('org text', false, blocks, true, 'none') as any[];
    const result2 = formatSystemPrompt('org text', false, blocks, true, 'system_prompt') as any[];
    // 两种模式下 org scope 都是 { type: 'ephemeral' }（无 scope 字段）
    expect(result1[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(result2[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

// ─── buildApiTools ───────────────────────────────────────────────────────────

describe('buildApiTools', () => {
  const dummyTools = [
    { name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} } },
    { name: 'Write', description: 'write', inputSchema: { type: 'object', properties: {} } },
  ] as any[];

  it('v6.1: tools 不加 cache_control（对齐官方）', () => {
    const result = buildApiTools(dummyTools, false, true, false)!;
    for (const tool of result) {
      expect(tool.cache_control).toBeUndefined();
    }
  });

  it('enableCaching=false 时也不加 cache_control', () => {
    const result = buildApiTools(dummyTools, false, false, false)!;
    for (const tool of result) {
      expect(tool.cache_control).toBeUndefined();
    }
  });

  it('始终包含 web_search server tool', () => {
    const result = buildApiTools(undefined, false, true, false)!;
    const webSearch = result.find((t: any) => t.name === 'web_search');
    expect(webSearch).toBeDefined();
    expect(webSearch.type).toBe('web_search_20250305');
  });

  it('无工具时只包含 web_search', () => {
    const result = buildApiTools(undefined, false, true, false)!;
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('web_search');
  });
});

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

describe('hashContent', () => {
  it('相同内容产生相同哈希', () => {
    const a = hashContent([{ type: 'text', text: 'hello' }]);
    const b = hashContent([{ type: 'text', text: 'hello' }]);
    expect(a).toBe(b);
  });

  it('不同内容产生不同哈希', () => {
    const a = hashContent([{ type: 'text', text: 'hello' }]);
    const b = hashContent([{ type: 'text', text: 'world' }]);
    expect(a).not.toBe(b);
  });
});

describe('stripCacheControlFields', () => {
  it('去除 cache_control 字段', () => {
    const items = [
      { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'b' },
    ];
    const result = stripCacheControlFields(items);
    expect(result[0]).toEqual({ type: 'text', text: 'a' });
    expect(result[1]).toEqual({ type: 'text', text: 'b' });
  });
});

describe('getSystemCharCount', () => {
  it('计算 text 字段的字符数总和', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(getSystemCharCount(blocks)).toBe(10);
  });
});

// ─── trackCacheState + reportCacheBreak ──────────────────────────────────────

describe('trackCacheState + reportCacheBreak', () => {
  beforeEach(() => {
    cacheBreakMap.clear();
  });

  it('首次调用只记录状态，不报告', () => {
    const system = [{ type: 'text', text: 'hello' }];
    const tools = [{ name: 'Bash' }];
    trackCacheState(system, tools, 'claude-sonnet-4-6', 'main', false);
    expect(cacheBreakMap.size).toBe(1);
  });

  it('连续相同调用不产生 pendingChanges', () => {
    const system = [{ type: 'text', text: 'hello' }];
    const tools = [{ name: 'Bash' }];
    trackCacheState(system, tools, 'claude-sonnet-4-6', 'main', false);
    trackCacheState(system, tools, 'claude-sonnet-4-6', 'main', false);

    const state = cacheBreakMap.get('main');
    expect(state?.pendingChanges).toBeNull();
  });

  it('system prompt 变化被检测到', () => {
    const tools = [{ name: 'Bash' }];
    trackCacheState([{ type: 'text', text: 'hello' }], tools, 'claude-sonnet-4-6', 'main', false);
    trackCacheState([{ type: 'text', text: 'hello world' }], tools, 'claude-sonnet-4-6', 'main', false);

    const state = cacheBreakMap.get('main');
    expect(state?.pendingChanges?.systemPromptChanged).toBe(true);
  });

  it('model 变化被检测到', () => {
    const system = [{ type: 'text', text: 'hello' }];
    const tools = [{ name: 'Bash' }];
    trackCacheState(system, tools, 'claude-sonnet-4-6', 'main', false);
    trackCacheState(system, tools, 'claude-opus-4-6', 'main', false);

    const state = cacheBreakMap.get('main');
    expect(state?.pendingChanges?.modelChanged).toBe(true);
  });
});
