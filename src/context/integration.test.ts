/**
 * Context/Memory 系统集成测试
 * 验证 PostCompact Hook、Auto-memory 打分和 Timestamp 管理的交互
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutoMemoryScorer, type MemoryItem } from '../memory/auto-memory-scorer.js';
import { MemoryTimestampManager, type TimestampedMemory } from '../memory/memory-timestamp.js';
import { PostCompactExecutor, type PostCompactInput } from './post-compact-integration.js';

describe('Context/Memory 系统集成', () => {
  let scorer: AutoMemoryScorer;
  let timestampManager: MemoryTimestampManager;
  let postCompactExecutor: PostCompactExecutor;

  beforeEach(() => {
    scorer = new AutoMemoryScorer(0.5);
    timestampManager = new MemoryTimestampManager();
    postCompactExecutor = new PostCompactExecutor(undefined, { logStats: false });
  });

  describe('完整的 Context 压缩流程', () => {
    it('应该处理完整的压缩和记忆保存流程', async () => {
      // 1. 执行 PostCompact
      const compactInput: PostCompactInput = {
        originalTokens: 10000,
        compressedTokens: 5000,
        sessionId: 'session-123',
      };

      const compactResult = await postCompactExecutor.execute(compactInput);
      expect(compactResult.success).toBe(true);
      expect(compactResult.savedTokens).toBe(5000);

      // 2. 对压缩相关的内容进行打分
      const now = Date.now();
      const memoriesToScore: MemoryItem[] = [
        {
          id: 'compact-summary',
          type: 'code',
          content: `Compression: ${compactResult.savedTokens} tokens saved`,
          relevance: 0.9,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
        {
          id: 'compression-metadata',
          type: 'docs',
          content: `Ratio: ${compactResult.compressionRatio.toFixed(2)}`,
          relevance: 0.8,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      ];

      const scoringResults = scorer.scoreMemories(memoriesToScore);
      expect(scoringResults).toHaveLength(2);
      expect(scoringResults[0].shouldSave).toBe(true); // code: 0.9 * 0.9 * 0.95 = 0.7695
      expect(scoringResults[1].shouldSave).toBe(true); // docs: 0.7 * 0.8 * 0.95 = 0.532

      // 3. 将评分通过的记忆保存到时间戳管理器
      for (const result of scoringResults) {
        if (result.shouldSave) {
          const memory = memoriesToScore.find((m) => m.id === result.memoryId);
          if (memory) {
            const timestampedMemory: TimestampedMemory = {
              ...memory,
              createdAt: memory.createdAt,
              updatedAt: memory.updatedAt,
              accessedAt: new Date(),
            };
            timestampManager.addMemory(timestampedMemory);
          }
        }
      }

      // 两个都通过了评分 (0.9 * 0.9 * 0.95 = 0.7695, 0.7 * 0.8 * 0.95 = 0.532)
      expect(timestampManager.size()).toBe(2);

      // 4. 验证保存的记忆可以被检索
      const savedMemory = timestampManager.getMemory('compact-summary');
      expect(savedMemory).not.toBeNull();
      expect(savedMemory?.content).toContain('5000');
    });
  });

  describe('记忆访问和刷新流程', () => {
    it('应该在访问时自动更新时间戳并维持相关度', async () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // 1. 创建一个记忆
      const memory: TimestampedMemory = {
        id: 'important-code',
        content: 'Important code snippet',
        type: 'code',
        createdAt: new Date(now - 30 * oneDayMs),
        updatedAt: new Date(now - 30 * oneDayMs),
        accessedAt: new Date(now - 30 * oneDayMs),
      };

      timestampManager.addMemory(memory);

      // 2. 访问时会更新 accessedAt
      const accessed = timestampManager.accessMemory('important-code');
      expect(accessed).not.toBeNull();
      expect(accessed?.accessedAt?.getTime()).toBeGreaterThanOrEqual(now);

      // 3. 根据新的 accessedAt 重新打分
      const memoryItem: MemoryItem = {
        ...memory,
        type: 'code',
        relevance: 0.8,
        updatedAt: accessed!.updatedAt, // 使用原始 updatedAt
        createdAt: memory.createdAt,
      };

      const result = scorer.score(memoryItem);
      expect(result.freshnessLevel).toBe('LOW'); // 30 天，仍然是 LOW 新鲜度

      // 如果我们更新了内容（重新访问视为编辑），新鲜度会改善
      const updatedMemory = timestampManager.updateMemory('important-code', {
        content: 'Updated important code snippet',
      });

      expect(updatedMemory?.updatedAt.getTime()).toBeGreaterThanOrEqual(now);

      // 重新打分（使用新的 updatedAt）
      const memoryItem2: MemoryItem = {
        ...updatedMemory!,
        type: 'code',
        relevance: 0.8,
        createdAt: updatedMemory!.createdAt,
      };

      const result2 = scorer.score(memoryItem2);
      expect(result2.freshnessLevel).toBe('HIGH'); // 现在是 HIGH 新鲜度
      expect(result2.shouldSave).toBe(true); // 0.9 * 0.8 * 0.95 = 0.684
    });
  });

  describe('批量压缩和记忆管理', () => {
    it('应该处理多次压缩和累积的记忆', async () => {
      const compressions: PostCompactInput[] = [
        { originalTokens: 5000, compressedTokens: 2500 },
        { originalTokens: 3000, compressedTokens: 1500 },
        { originalTokens: 4000, compressedTokens: 1600 },
      ];

      let totalSaved = 0;

      for (const compression of compressions) {
        const result = await postCompactExecutor.execute(compression);
        totalSaved += result.savedTokens;
      }

      // 实际saved = (5000-2500) + (3000-1500) + (4000-1600) = 2500 + 1500 + 2400 = 6400
      expect(totalSaved).toBe(6400);

      // 创建对应的记忆项
      const now = Date.now();
      for (let i = 0; i < compressions.length; i++) {
        const memory: TimestampedMemory = {
          id: `compression-${i}`,
          content: `Compression ${i + 1}`,
          type: 'docs',
          createdAt: new Date(now - i * 1000),
          updatedAt: new Date(now - i * 1000),
        };
        timestampManager.addMemory(memory);
      }

      // 按访问时间排序
      const sorted = timestampManager.getAllMemoriesSortedByAccess();
      expect(sorted).toHaveLength(3);
      expect(sorted[0].id).toBe('compression-0'); // 最新创建
    });
  });

  describe('记忆陈旧化管理', () => {
    it('应该正确识别和清理陈旧记忆', async () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // 添加混合的新鲜和陈旧记忆
      const memories: TimestampedMemory[] = [
        {
          id: 'fresh-1',
          content: 'Fresh 1',
          type: 'code',
          createdAt: new Date(now - oneDayMs),
          updatedAt: new Date(now - oneDayMs),
          accessedAt: new Date(now - oneDayMs),
        },
        {
          id: 'stale-1',
          content: 'Stale 1',
          type: 'code',
          createdAt: new Date(now - 100 * oneDayMs),
          updatedAt: new Date(now - 100 * oneDayMs),
          accessedAt: new Date(now - 100 * oneDayMs),
        },
        {
          id: 'fresh-2',
          content: 'Fresh 2',
          type: 'code',
          createdAt: new Date(now - 2 * oneDayMs),
          updatedAt: new Date(now - 2 * oneDayMs),
          accessedAt: new Date(now - 2 * oneDayMs),
        },
      ];

      for (const memory of memories) {
        timestampManager.addMemory(memory);
      }

      // 识别陈旧记忆
      const stale = timestampManager.getStaleMemories();
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe('stale-1');

      // 清理陈旧记忆
      const removed = timestampManager.removeStaleMemories();
      expect(removed).toBe(1);
      expect(timestampManager.size()).toBe(2);

      // 剩下的应该都是新鲜的
      const remaining = timestampManager.getAllMemoriesSortedByAccess();
      expect(remaining).toHaveLength(2);
      expect(remaining.every((m) => m.id !== 'stale-1')).toBe(true);
    });
  });

  describe('统计和分析', () => {
    it('应该提供完整的系统统计信息', async () => {
      const now = Date.now();

      // 创建多样化的记忆
      const memories: MemoryItem[] = [
        {
          id: '1',
          type: 'code',
          content: 'Code 1',
          relevance: 0.95,
          createdAt: new Date(now - 1000),
          updatedAt: new Date(now - 1000),
        },
        {
          id: '2',
          type: 'design',
          content: 'Design 1',
          relevance: 0.7,
          createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
        },
        {
          id: '3',
          type: 'bugs',
          content: 'Bug fix',
          relevance: 0.8,
          createdAt: new Date(now - 50 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now - 50 * 24 * 60 * 60 * 1000),
        },
      ];

      const results = scorer.scoreMemories(memories);
      const stats = scorer.getStats();

      // 评分计算：
      // code: 0.9 * 0.95 * 0.95 = 0.8122 (HIGH)
      // design: 0.85 * 0.7 * 0.6 = 0.357 (MEDIUM) < 0.5
      // bugs: 0.8 * 0.8 * 0.2 = 0.128 (LOW) < 0.5
      expect(stats.totalMemories).toBe(3);
      expect(stats.savedMemories).toBe(1); // 只有第一个
      expect(stats.discardedMemories).toBe(2);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.distribution.code).toBe(1);
      expect(stats.distribution.design).toBe(1);
      expect(stats.distribution.bugs).toBe(1);

      // 保存评分通过的记忆到时间戳管理器
      for (const result of results) {
        if (result.shouldSave) {
          const mem = memories.find((m) => m.id === result.memoryId);
          if (mem) {
            timestampManager.addMemory({
              ...mem,
              accessedAt: new Date(),
            });
          }
        }
      }

      expect(timestampManager.size()).toBe(1); // 只有评分通过的
      const tsStats = timestampManager.getStats();
      expect(tsStats.oldestAccess).not.toBeNull();
      expect(tsStats.newestAccess).not.toBeNull();
      expect(tsStats.accessFrequency).toBeGreaterThan(0);
    });
  });
});
