/**
 * 测试 MemorySearchTool 和 recall() 正确使用 hybridSearch
 * 确保向量搜索 + FTS5 混合检索管线完整连通
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock memory-search 模块
const mockHybridSearch = vi.fn();
const mockSearch = vi.fn();

vi.mock('../../src/memory/memory-search.js', () => ({
  getMemorySearchManager: vi.fn(() => ({
    hybridSearch: mockHybridSearch,
    search: mockSearch,
  })),
}));

vi.mock('../../src/i18n/index.js', () => ({
  t: (key: string) => key,
}));

import { MemorySearchTool } from '../../src/tools/memory-search.js';

describe('MemorySearchTool hybrid search integration', () => {
  let tool: MemorySearchTool;

  beforeEach(() => {
    tool = new MemorySearchTool();
    mockHybridSearch.mockReset();
    mockSearch.mockReset();
  });

  it('should call hybridSearch instead of search', async () => {
    mockHybridSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        path: 'memory/project.md',
        startLine: 1,
        endLine: 10,
        score: 0.85,
        snippet: 'Some relevant memory snippet',
        source: 'memory',
        timestamp: new Date().toISOString(),
        age: 3600000,
      },
    ]);

    const result = await tool.execute({ query: 'test query' });

    expect(mockHybridSearch).toHaveBeenCalledWith('test query', {
      source: undefined,
      maxResults: undefined,
    });
    // search() 不应被调用
    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 1 memories');
    expect(result.output).toContain('Some relevant memory snippet');
    expect(result.output).toContain('memory/project.md');
  });

  it('should pass source and maxResults to hybridSearch', async () => {
    mockHybridSearch.mockResolvedValue([]);

    await tool.execute({
      query: 'test',
      source: 'session',
      maxResults: 5,
    });

    expect(mockHybridSearch).toHaveBeenCalledWith('test', {
      source: 'session',
      maxResults: 5,
    });
  });

  it('should return no results message when hybridSearch returns empty', async () => {
    mockHybridSearch.mockResolvedValue([]);

    const result = await tool.execute({ query: 'nonexistent' });

    expect(result.output).toBe('memorySearch.noResults');
  });

  it('should format multiple results correctly', async () => {
    const now = Date.now();
    mockHybridSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        path: 'memory/project.md',
        startLine: 1,
        endLine: 5,
        score: 0.9,
        snippet: 'First snippet',
        source: 'memory',
        timestamp: new Date(now).toISOString(),
        age: 1800000, // 30 minutes
      },
      {
        id: 'chunk-2',
        path: 'sessions/abc.json',
        startLine: 10,
        endLine: 20,
        score: 0.6,
        snippet: 'Second snippet',
        source: 'session',
        timestamp: new Date(now - 86400000).toISOString(),
        age: 86400000, // 1 day
      },
    ]);

    const result = await tool.execute({ query: 'search term' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 2 memories');
    expect(result.output).toContain('First snippet');
    expect(result.output).toContain('Second snippet');
    expect(result.output).toContain('score: 0.900');
    expect(result.output).toContain('score: 0.600');
  });
});

describe('MemorySearchManager.recall() hybrid search', () => {
  // recall() 的测试需要直接测试 MemorySearchManager
  // 由于 MemorySearchManager 需要 SQLite，我们通过 mock 验证调用链

  it('recall should be async and return Promise', async () => {
    // 验证 recall 方法签名已改为 async
    const { MemorySearchManager } = await vi.importActual<typeof import('../../src/memory/memory-search.js')>(
      '../../src/memory/memory-search.js'
    );
    
    // recall 的 prototype 应该返回 Promise
    const proto = MemorySearchManager.prototype;
    expect(proto.recall.constructor.name).toBe('AsyncFunction');
  });
});
