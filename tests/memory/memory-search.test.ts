/**
 * MemorySearchManager 测试
 * 测试同步竞态修复和单例管理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initMemorySearchManager, getMemorySearchManager, resetMemorySearchManager } from '../../src/memory/memory-search.js';
import { getRecallSourceKind } from '../../src/memory/recall-source-kind.js';
import { planLayeredRecallFromResults } from '../../src/memory/recall-planner.js';

// 使用临时目录作为 config dir，避免污染真实数据
const tmpDir = path.join(os.tmpdir(), `axon-mem-test-${Date.now()}`);

describe('MemorySearchManager', () => {
  beforeEach(() => {
    process.env.AXON_CONFIG_DIR = tmpDir;
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    resetMemorySearchManager();
    delete process.env.AXON_CONFIG_DIR;
    delete process.env.AXON_DISABLE_BUILTIN_EMBEDDING;
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('singleton management', () => {
    it('should return null before init', () => {
      expect(getMemorySearchManager()).toBeNull();
    });

    it('should return manager after init', async () => {
      await initMemorySearchManager('/test/project', 'testHash123');
      expect(getMemorySearchManager()).not.toBeNull();
    });

    it('should reset to null', async () => {
      await initMemorySearchManager('/test/project', 'testHash123');
      expect(getMemorySearchManager()).not.toBeNull();
      resetMemorySearchManager();
      expect(getMemorySearchManager()).toBeNull();
    });
  });

  describe('hybridSearch', () => {
    it('should return empty array for no-data database', async () => {
      const manager = await initMemorySearchManager('/test/project', 'testHash123');
      const results = await manager.hybridSearch('test query');
      expect(results).toEqual([]);
    });

    it('should disable embedding after provider failure and fallback to keyword search', async () => {
      const fetchSpy = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchSpy);

      try {
        const manager = await initMemorySearchManager('/test/project', 'testHash123', {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://example.com/v1',
          model: 'text-embedding-3-small',
        });

        await expect(manager.hybridSearch('test query')).resolves.toEqual([]);
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(manager.getEmbeddingProvider()).toBeNull();
        expect(manager.getEmbeddingCache()).toBeNull();

        const callsAfterFailure = fetchSpy.mock.calls.length;
        await expect(manager.hybridSearch('test query again')).resolves.toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(callsAfterFailure);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should handle markDirty and re-sync', async () => {
      const manager = await initMemorySearchManager('/test/project', 'testHash123');
      
      // First search triggers sync
      await manager.hybridSearch('test');
      
      // Mark dirty and search again — should not throw
      manager.markDirty();
      const results = await manager.hybridSearch('test again');
      expect(results).toEqual([]);
    });
  });

  describe('recall', () => {
    it('should return null for short queries (< 3 chars)', async () => {
      const manager = await initMemorySearchManager('/test/project', 'testHash123');
      expect(await manager.recall('ab')).toBeNull();
      expect(await manager.recall('')).toBeNull();
      expect(await manager.recall('  ')).toBeNull();
    });

    it('should return null when no results found', async () => {
      const manager = await initMemorySearchManager('/test/project', 'testHash123');
      const result = await manager.recall('nonexistent topic xyz');
      expect(result).toBeNull();
    });
  });

  describe('layered recall helpers', () => {
    it('classifies recall source kinds from indexed paths', () => {
      expect(getRecallSourceKind({ path: 'notebook:project.md', source: 'notebook' })).toBe('notebook');
      expect(getRecallSourceKind({ path: 'transcript:session-1', source: 'session' })).toBe('transcript');
      expect(getRecallSourceKind({ path: 'abc/session-memory/summary.md', source: 'session' })).toBe('session-summary');
      expect(getRecallSourceKind({ path: 'notes/decision.md', source: 'memory' })).toBe('memory-doc');
    });

    it('builds layered recall with notebook first and current session summary as fallback', () => {
      const now = Date.now();
      const result = planLayeredRecallFromResults([
        {
          id: 'nb-1',
          path: 'notebook:project.md',
          startLine: 1,
          endLine: 3,
          score: 0.9,
          snippet: 'Project notebook says use direct, honest answers.',
          source: 'notebook',
          timestamp: new Date(now).toISOString(),
          age: 3600000,
        },
        {
          id: 'ss-1',
          path: 'session-123/session-memory/summary.md',
          startLine: 5,
          endLine: 8,
          score: 0.7,
          snippet: 'Current session is evaluating layered recall for summary.md.',
          source: 'session',
          timestamp: new Date(now).toISOString(),
          age: 7200000,
        },
        {
          id: 'ss-2',
          path: 'other-session/session-memory/summary.md',
          startLine: 1,
          endLine: 2,
          score: 0.8,
          snippet: 'Other session summary should not appear.',
          source: 'session',
          timestamp: new Date(now).toISOString(),
          age: 1800000,
        },
      ], {
        sessionId: 'session-123',
        hasCompactSummary: false,
      });

      expect(result.notebookResults).toHaveLength(1);
      expect(result.sessionSummaryResults).toHaveLength(1);
      expect(result.transcriptResults).toHaveLength(0);
      expect(result.formatted).toContain('[Notebook]');
      expect(result.formatted).toContain('[Current session background]');
      expect(result.formatted).toContain('Project notebook says use direct, honest answers.');
      expect(result.formatted).toContain('Current session is evaluating layered recall for summary.md.');
      expect(result.formatted).not.toContain('Other session summary should not appear.');
    });

    it('adds transcript evidence only as a secondary layer after notebook and current session background', () => {
      const now = Date.now();
      const result = planLayeredRecallFromResults([
        {
          id: 'nb-1',
          path: 'notebook:project.md',
          startLine: 1,
          endLine: 3,
          score: 0.9,
          snippet: 'Project notebook says prefer direct root-cause analysis.',
          source: 'notebook',
          timestamp: new Date(now).toISOString(),
          age: 3600000,
        },
        {
          id: 'ss-1',
          path: 'session-123/session-memory/summary.md',
          startLine: 5,
          endLine: 8,
          score: 0.7,
          snippet: 'Current session is debugging layered recall rollout.',
          source: 'session',
          timestamp: new Date(now).toISOString(),
          age: 7200000,
        },
        {
          id: 'tr-1',
          path: 'transcript:old-session.json',
          startLine: 12,
          endLine: 20,
          score: 0.65,
          snippet: '# Past session\nDate: 2026-03-20\nModel: sonnet\nProject: /repo\n\n## User\nWe hit the same recall bug before.\n\n## Assistant\nThe fix was to align summary indexing paths.',
          source: 'session',
          timestamp: new Date(now).toISOString(),
          age: 10800000,
        },
      ], {
        sessionId: 'session-123',
        hasCompactSummary: false,
        transcriptLimit: 1,
      });

      expect(result.notebookResults).toHaveLength(1);
      expect(result.sessionSummaryResults).toHaveLength(1);
      expect(result.transcriptResults).toHaveLength(1);
      expect(result.formatted).toContain('[Past session evidence]');
      expect(result.formatted).toContain('We hit the same recall bug before.');
      expect(result.formatted).toContain('The fix was to align summary indexing paths.');
      expect(result.formatted).not.toContain('Project: /repo');
      expect(result.formatted).not.toContain('## User');
    });

    it('skips session summary fallback when compact summary already exists in messages', () => {
      const now = Date.now();
      const result = planLayeredRecallFromResults([
        {
          id: 'nb-1',
          path: 'notebook:project.md',
          startLine: 1,
          endLine: 3,
          score: 0.9,
          snippet: 'Notebook memory.',
          source: 'notebook',
          timestamp: new Date(now).toISOString(),
          age: 3600000,
        },
        {
          id: 'ss-1',
          path: 'session-123/session-memory/summary.md',
          startLine: 5,
          endLine: 8,
          score: 0.7,
          snippet: 'Session summary memory.',
          source: 'session',
          timestamp: new Date(now).toISOString(),
          age: 7200000,
        },
      ], {
        sessionId: 'session-123',
        hasCompactSummary: true,
      });

      expect(result.notebookResults).toHaveLength(1);
      expect(result.sessionSummaryResults).toHaveLength(0);
      expect(result.formatted).toContain('[Notebook]');
      expect(result.formatted).not.toContain('[Current session background]');
    });
  });

  describe('status', () => {
    it('should return store status', async () => {
      const manager = await initMemorySearchManager('/test/project', 'testHash123');
      const status = manager.status();
      expect(status).toHaveProperty('totalFiles');
      expect(status).toHaveProperty('totalChunks');
      expect(status).toHaveProperty('dirty');
      expect(status.totalFiles).toBe(0);
      expect(status.totalChunks).toBe(0);
    });
  });
});
