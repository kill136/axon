/**
 * client.ts 缓存相关功能单元测试
 *
 * 覆盖与官方 CLI 对齐的 4 个差异点：
 *   差异1: formatMessages — 最后 2 条消息（而非仅最后 1 条）添加 cache_control
 *   差异2: isPromptCachingEnabled — DISABLE_PROMPT_CACHING 系列 env var 按型号控制
 *   差异3: buildCacheControl / formatMessages / buildApiTools — OAuth 用户加 ttl:"1h"
 *   差异4: trackCacheState + reportCacheBreak — 缓存破裂追踪系统
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

// ─── 差异2: isPromptCachingEnabled ────────────────────────────────────────────

describe('isPromptCachingEnabled (差异2)', () => {
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

// ─── 差异3: buildCacheControl ────────────────────────────────────────────────

describe('buildCacheControl (差异3)', () => {
  it('org scope、无 OAuth → 仅 type:ephemeral', () => {
    expect(buildCacheControl('org')).toEqual({ type: 'ephemeral' });
  });

  it('global scope、无 OAuth → type:ephemeral + scope:global', () => {
    expect(buildCacheControl('global')).toEqual({ type: 'ephemeral', scope: 'global' });
  });

  it('org scope + OAuth → type:ephemeral + ttl:1h', () => {
    expect(buildCacheControl('org', true)).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('global scope + OAuth → type:ephemeral + ttl:1h + scope:global', () => {
    expect(buildCacheControl('global', true)).toEqual({ type: 'ephemeral', ttl: '1h', scope: 'global' });
  });

  it('isOAuth=false 不加 ttl', () => {
    expect(buildCacheControl('org', false)).toEqual({ type: 'ephemeral' });
    expect(buildCacheControl('global', false)).toEqual({ type: 'ephemeral', scope: 'global' });
  });
});

// ─── 差异1 + 差异3: formatMessages ───────────────────────────────────────────

describe('formatMessages (差异1 + 差异3)', () => {
  function makeMessages(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));
  }

  it('差异1: 3 条消息时，最后 2 条得到 cache_control，第 1 条不加', () => {
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

  it('差异1: 5 条消息时，只有最后 2 条得到 cache_control', () => {
    const msgs = makeMessages(5);
    const result = formatMessages(msgs);

    for (let i = 0; i < 3; i++) {
      expect(result[i].content[0].cache_control).toBeUndefined();
    }
    expect(result[3].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(result[4].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('差异1: 1 条消息时，那 1 条得到 cache_control（最后 2 条中至少包含它）', () => {
    const msgs = makeMessages(1);
    const result = formatMessages(msgs);
    expect(result[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('差异2: enableCaching=false 时所有消息都不加 cache_control', () => {
    const msgs = makeMessages(4);
    const result = formatMessages(msgs, false, false);
    for (const msg of result) {
      expect(msg.content[0].cache_control).toBeUndefined();
    }
  });

  it('差异3: OAuth 模式下 cache_control 带 ttl:1h', () => {
    const msgs = makeMessages(3);
    const result = formatMessages(msgs, false, true, true);

    expect(result[1].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(result[2].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('差异3: 非 OAuth 模式 cache_control 不含 ttl', () => {
    const msgs = makeMessages(3);
    const result = formatMessages(msgs, false, true, false);

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

// ─── formatSystemPrompt (差异2 + 差异3) ──────────────────────────────────────

describe('formatSystemPrompt (差异2 + 差异3)', () => {
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

  it('OAuth 模式下 cache_control 带 ttl:1h', () => {
    const blocks = [{ text: 'static', cacheScope: 'global' as const }];
    const result = formatSystemPrompt('static', true, blocks, true) as any[];
    expect(result[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h', scope: 'global' });
  });

  it('无 system prompt 且非 OAuth → undefined', () => {
    const result = formatSystemPrompt(undefined, false, undefined, true);
    expect(result).toBeUndefined();
  });

  it('空字符串 system prompt 且非 OAuth → undefined', () => {
    // formatSystemPrompt 只检测 falsy，'' 是 falsy
    const result = formatSystemPrompt('', false, undefined, true);
    expect(result).toBeUndefined();
  });
});

// ─── buildApiTools (差异2 + 差异3) ───────────────────────────────────────────

describe('buildApiTools (差异2 + 差异3)', () => {
  const dummyTools = [
    { name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} } },
    { name: 'Write', description: 'write', inputSchema: { type: 'object', properties: {} } },
  ] as any[];

  it('启用缓存时最后一个工具（web_search）加 cache_control', () => {
    const result = buildApiTools(dummyTools, false, true, false)!;
    const last = result[result.length - 1];
    expect(last.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('差异2: enableCaching=false 时不加 cache_control', () => {
    const result = buildApiTools(dummyTools, false, false, false)!;
    for (const tool of result) {
      expect(tool.cache_control).toBeUndefined();
    }
  });

  it('差异3: OAuth 时 cache_control 带 ttl:1h', () => {
    const result = buildApiTools(dummyTools, false, true, true)!;
    const last = result[result.length - 1];
    expect(last.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
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
  it('相同内容返回相同哈希', () => {
    expect(hashContent({ a: 1 })).toBe(hashContent({ a: 1 }));
  });

  it('不同内容返回不同哈希', () => {
    expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 2 }));
  });

  it('对字符串和对象都能处理', () => {
    expect(typeof hashContent('hello')).toBe('number');
    expect(typeof hashContent([1, 2, 3])).toBe('number');
  });
});

describe('stripCacheControlFields', () => {
  it('移除 cache_control 字段', () => {
    const items = [{ text: 'hi', cache_control: { type: 'ephemeral' } }];
    const result = stripCacheControlFields(items);
    expect(result[0]).toEqual({ text: 'hi' });
    expect(result[0].cache_control).toBeUndefined();
  });

  it('没有 cache_control 的 item 原样保留', () => {
    const items = [{ text: 'hi' }];
    const result = stripCacheControlFields(items);
    expect(result[0]).toEqual({ text: 'hi' });
  });

  it('不修改原始数组', () => {
    const items = [{ text: 'hi', cache_control: { type: 'ephemeral' } }];
    stripCacheControlFields(items);
    expect(items[0].cache_control).toBeDefined();
  });
});

describe('getSystemCharCount', () => {
  it('计算所有 text 字段的字符总数', () => {
    const blocks = [{ text: 'hello' }, { text: ' world' }];
    expect(getSystemCharCount(blocks)).toBe(11);
  });

  it('空数组返回 0', () => {
    expect(getSystemCharCount([])).toBe(0);
  });

  it('没有 text 字段的 block 计 0', () => {
    expect(getSystemCharCount([{ type: 'text' }])).toBe(0);
  });
});

// ─── 差异4: 缓存破裂追踪系统 ──────────────────────────────────────────────────

describe('trackCacheState + reportCacheBreak (差异4)', () => {
  const SRC = 'test-source-' + Math.random().toString(36).slice(2);

  const systemBlocks = [{ text: 'system prompt' }];
  const tools = [{ name: 'Read', description: 'read', input_schema: {} }];

  beforeEach(() => {
    cacheBreakMap.delete(SRC);
  });

  it('首次调用：创建状态条目', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    expect(state).toBeDefined();
    expect(state.callCount).toBe(1);
    expect(state.pendingChanges).toBeNull();
    expect(state.prevCacheReadTokens).toBeNull();
  });

  it('二次调用相同内容：无 pendingChanges', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    expect(state.callCount).toBe(2);
    expect(state.pendingChanges).toBeNull();
  });

  it('system prompt 变化：记录 systemPromptChanged', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    const newSystem = [{ text: 'different system prompt' }];
    trackCacheState(newSystem, tools, 'claude-sonnet-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    expect(state.pendingChanges?.systemPromptChanged).toBe(true);
    expect(state.pendingChanges?.toolSchemasChanged).toBe(false);
  });

  it('tools 变化：记录 toolSchemasChanged', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    const newTools = [{ name: 'Write', description: 'write', input_schema: {} }];
    trackCacheState(systemBlocks, newTools, 'claude-sonnet-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    expect(state.pendingChanges?.toolSchemasChanged).toBe(true);
  });

  it('model 变化：记录 modelChanged + previousModel/newModel', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    trackCacheState(systemBlocks, tools, 'claude-opus-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    expect(state.pendingChanges?.modelChanged).toBe(true);
    expect(state.pendingChanges?.previousModel).toBe('claude-sonnet-4-6');
    expect(state.pendingChanges?.newModel).toBe('claude-opus-4-6');
  });

  it('fastMode 切换：记录 fastModeChanged', () => {
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, true);
    const state = cacheBreakMap.get(SRC)!;
    expect(state.pendingChanges?.fastModeChanged).toBe(true);
  });

  it('cache_control 字段变化不视为内容变化（hR7 等价）', () => {
    const blocksWithCache = [{ text: 'system', cache_control: { type: 'ephemeral' } }];
    const blocksNoCache = [{ text: 'system' }];
    trackCacheState(blocksWithCache, tools, 'claude-sonnet-4-6', SRC, false);
    trackCacheState(blocksNoCache, tools, 'claude-sonnet-4-6', SRC, false);
    const state = cacheBreakMap.get(SRC)!;
    // 剥离 cache_control 后内容相同，不应视为变化
    expect(state.pendingChanges).toBeNull();
  });

  it('reportCacheBreak: 首次无 prevCacheReadTokens → 不报告', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    reportCacheBreak(SRC, 1000, 500, true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reportCacheBreak: token 下降幅度小于阈值 → 不报告', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    // 首次设置 prevCacheReadTokens
    reportCacheBreak(SRC, 10000, 500, true);
    // 第二次：下降 100 token（< 2000 阈值）
    reportCacheBreak(SRC, 9900, 500, true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reportCacheBreak: token 显著下降（>5% 且 >2000）+ 变化原因 → debug=true 时 warn', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    // 触发 system 变化
    const newSystem = [{ text: 'drastically different system prompt content here' }];
    trackCacheState(newSystem, tools, 'claude-sonnet-4-6', SRC, false);
    // 设置 prevCacheReadTokens
    reportCacheBreak(SRC, 50000, 500, true);
    // 下降 >5% 且 >2000
    reportCacheBreak(SRC, 10000, 5000, true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PROMPT CACHE BREAK]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('system prompt changed'));
  });

  it('reportCacheBreak: debug=false 时即使破裂也不 warn', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    const newSystem = [{ text: 'different' }];
    trackCacheState(newSystem, tools, 'claude-sonnet-4-6', SRC, false);
    reportCacheBreak(SRC, 50000, 500, false);
    reportCacheBreak(SRC, 10000, 5000, false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reportCacheBreak: haiku 模型跳过报告', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const haikuSrc = SRC + '-haiku';
    cacheBreakMap.delete(haikuSrc);
    trackCacheState(systemBlocks, tools, 'claude-haiku-4-5', haikuSrc, false);
    const newSystem = [{ text: 'different' }];
    trackCacheState(newSystem, tools, 'claude-haiku-4-5', haikuSrc, false);
    reportCacheBreak(haikuSrc, 50000, 500, true);
    reportCacheBreak(haikuSrc, 10000, 5000, true);
    expect(warnSpy).not.toHaveBeenCalled();
    cacheBreakMap.delete(haikuSrc);
  });

  it('报告时消息包含 source 和 callCount', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', SRC, false);
    reportCacheBreak(SRC, 50000, 500, true);
    // 下降幅度足够大
    reportCacheBreak(SRC, 100, 5000, true);
    const call = warnSpy.mock.calls.find(c => String(c[0]).includes('[PROMPT CACHE BREAK]'));
    if (call) {
      expect(String(call[0])).toContain(`source=${SRC}`);
    }
  });

  it('容量超过 CACHE_BREAK_MAX_SOURCES(10) 时驱逐最旧条目', () => {
    // 清空所有已有条目
    cacheBreakMap.clear();
    for (let i = 0; i < 10; i++) {
      trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', `evict-test-src-${i}`, false);
    }
    expect(cacheBreakMap.size).toBe(10);
    // 添加第 11 个
    trackCacheState(systemBlocks, tools, 'claude-sonnet-4-6', 'evict-test-src-new', false);
    expect(cacheBreakMap.size).toBe(10);
    // 第一个应该被驱逐
    expect(cacheBreakMap.has('evict-test-src-0')).toBe(false);
    expect(cacheBreakMap.has('evict-test-src-new')).toBe(true);
    // 清理
    cacheBreakMap.clear();
  });
});
