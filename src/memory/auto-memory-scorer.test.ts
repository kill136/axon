/**
 * Auto-memory 打分系统测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutoMemoryScorer,
  scoreMemory,
  scoreMemories,
  type MemoryItem,
  type ScoringResult,
} from './auto-memory-scorer.js';

describe('AutoMemoryScorer', () => {
  let scorer: AutoMemoryScorer;
  let sampleMemories: MemoryItem[];

  beforeEach(() => {
    scorer = new AutoMemoryScorer(0.5);

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    sampleMemories = [
      {
        id: 'code-1',
        type: 'code',
        content: 'Function implementation',
        relevance: 0.9,
        createdAt: new Date(now - oneDay),
        updatedAt: new Date(now - oneDay),
      },
      {
        id: 'design-1',
        type: 'design',
        content: 'UI design note',
        relevance: 0.8,
        createdAt: new Date(now - 5 * oneDay),
        updatedAt: new Date(now - 5 * oneDay),
      },
      {
        id: 'bugs-1',
        type: 'bugs',
        content: 'Bug fix solution',
        relevance: 0.7,
        createdAt: new Date(now - 20 * oneDay),
        updatedAt: new Date(now - 20 * oneDay),
      },
      {
        id: 'docs-1',
        type: 'docs',
        content: 'Documentation',
        relevance: 0.5,
        createdAt: new Date(now - 100 * oneDay),
        updatedAt: new Date(now - 100 * oneDay),
      },
    ];
  });

  describe('单个记忆打分', () => {
    it('应该计算高新鲜度高权重记忆的高分数', () => {
      const result = scorer.score(sampleMemories[0]);

      expect(result.memoryId).toBe('code-1');
      expect(result.typeWeight).toBe(0.9);
      expect(result.freshnessLevel).toBe('HIGH');
      expect(result.freshnessFactor).toBe(0.95);
      expect(result.score).toBeCloseTo(0.9 * 0.9 * 0.95, 2); // 0.7695
      expect(result.shouldSave).toBe(true);
    });

    it('应该计算低新鲜度的陈旧记忆低分数', () => {
      const result = scorer.score(sampleMemories[3]);

      expect(result.memoryId).toBe('docs-1');
      expect(result.typeWeight).toBe(0.7);
      expect(result.freshnessLevel).toBe('STALE');
      expect(result.freshnessFactor).toBe(0.05);
      expect(result.score).toBeCloseTo(0.7 * 0.5 * 0.05, 2); // 0.0175
      expect(result.shouldSave).toBe(false);
    });

    it('应该处理中等新鲜度的记忆', () => {
      const result = scorer.score(sampleMemories[1]);

      expect(result.freshnessLevel).toBe('MEDIUM');
      expect(result.freshnessFactor).toBe(0.6);
      const expected = 0.85 * 0.8 * 0.6; // 0.408
      expect(result.score).toBeCloseTo(expected, 2);
      expect(result.shouldSave).toBe(false); // 0.408 < 0.5（默认阈值）
    });

    it('应该尊重阈值设置', () => {
      scorer.setThreshold(0.8);
      const result = scorer.score(sampleMemories[1]);

      expect(result.shouldSave).toBe(false); // 0.408 < 0.8
    });
  });

  describe('批量打分', () => {
    it('应该打分多个记忆', () => {
      const results = scorer.scoreMemories(sampleMemories);

      expect(results).toHaveLength(4);
      expect(results[0].shouldSave).toBe(true); // 0.9 * 0.9 * 0.95 = 0.7695
      expect(results[1].shouldSave).toBe(false); // 0.85 * 0.8 * 0.6 = 0.408 < 0.5
      expect(results[2].shouldSave).toBe(false); // 0.8 * 0.7 * 0.2 = 0.112 < 0.5
      expect(results[3].shouldSave).toBe(false); // 0.7 * 0.5 * 0.05 = 0.0175 < 0.5
    });

    it('应该更新统计信息', () => {
      scorer.scoreMemories(sampleMemories);
      const stats = scorer.getStats();

      expect(stats.totalMemories).toBe(4);
      expect(stats.savedMemories).toBe(1); // 只有 code-1 的分数 >= 0.5
      expect(stats.discardedMemories).toBe(3);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.distribution.code).toBe(1);
      expect(stats.distribution.design).toBe(1);
      expect(stats.distribution.bugs).toBe(1);
      expect(stats.distribution.docs).toBe(1);
    });
  });

  describe('新鲜度计算', () => {
    it('应该识别 HIGH 新鲜度（3 天内）', () => {
      const now = new Date();
      const oneDay = 24 * 60 * 60 * 1000;

      const memory: MemoryItem = {
        id: 'test-1',
        type: 'code',
        content: 'Fresh content',
        relevance: 1.0,
        createdAt: new Date(now.getTime() - oneDay),
        updatedAt: new Date(now.getTime() - oneDay),
      };

      const result = scorer.score(memory);
      expect(result.freshnessLevel).toBe('HIGH');
      expect(result.freshnessFactor).toBe(0.95);
    });

    it('应该识别 MEDIUM 新鲜度（3-14 天）', () => {
      const now = new Date();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      const memory: MemoryItem = {
        id: 'test-2',
        type: 'code',
        content: 'Medium fresh content',
        relevance: 1.0,
        createdAt: new Date(now.getTime() - sevenDays),
        updatedAt: new Date(now.getTime() - sevenDays),
      };

      const result = scorer.score(memory);
      expect(result.freshnessLevel).toBe('MEDIUM');
      expect(result.freshnessFactor).toBe(0.6);
    });

    it('应该识别 LOW 新鲜度（14-90 天）', () => {
      const now = new Date();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      const memory: MemoryItem = {
        id: 'test-3',
        type: 'code',
        content: 'Old content',
        relevance: 1.0,
        createdAt: new Date(now.getTime() - thirtyDays),
        updatedAt: new Date(now.getTime() - thirtyDays),
      };

      const result = scorer.score(memory);
      expect(result.freshnessLevel).toBe('LOW');
      expect(result.freshnessFactor).toBe(0.2);
    });

    it('应该识别 STALE 新鲜度（>90 天）', () => {
      const now = new Date();
      const oneHundredDays = 100 * 24 * 60 * 60 * 1000;

      const memory: MemoryItem = {
        id: 'test-4',
        type: 'code',
        content: 'Stale content',
        relevance: 1.0,
        createdAt: new Date(now.getTime() - oneHundredDays),
        updatedAt: new Date(now.getTime() - oneHundredDays),
      };

      const result = scorer.score(memory);
      expect(result.freshnessLevel).toBe('STALE');
      expect(result.freshnessFactor).toBe(0.05);
    });
  });

  describe('权重配置', () => {
    it('应该应用正确的类型权重', () => {
      const memories: MemoryItem[] = [
        {
          id: 'c1',
          type: 'code',
          content: 'Code',
          relevance: 1.0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'c2',
          type: 'design',
          content: 'Design',
          relevance: 1.0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'c3',
          type: 'bugs',
          content: 'Bug',
          relevance: 1.0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'c4',
          type: 'docs',
          content: 'Doc',
          relevance: 1.0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const results = scorer.scoreMemories(memories);

      expect(results[0].typeWeight).toBe(0.9); // code
      expect(results[1].typeWeight).toBe(0.85); // design
      expect(results[2].typeWeight).toBe(0.8); // bugs
      expect(results[3].typeWeight).toBe(0.7); // docs
    });
  });

  describe('阈值管理', () => {
    it('应该支持动态阈值调整', () => {
      const memory: MemoryItem = {
        id: 'test',
        type: 'code',
        content: 'Test',
        relevance: 0.5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      scorer.setThreshold(0.2);
      expect(scorer.score(memory).shouldSave).toBe(true);

      scorer.setThreshold(0.9);
      expect(scorer.score(memory).shouldSave).toBe(false);
    });

    it('应该限制阈值在 0-1 之间', () => {
      scorer.setThreshold(-1);
      expect(scorer.getThreshold()).toBe(0);

      scorer.setThreshold(2);
      expect(scorer.getThreshold()).toBe(1);
    });
  });

  describe('便利函数', () => {
    it('scoreMemory 应该快速打分单个记忆', () => {
      const memory: MemoryItem = {
        id: 'test',
        type: 'code',
        content: 'Test',
        relevance: 0.8,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = scoreMemory(memory);
      expect(result.memoryId).toBe('test');
      expect(result.typeWeight).toBe(0.9);
    });

    it('scoreMemories 应该快速打分多个记忆', () => {
      const results = scoreMemories(sampleMemories);
      expect(results).toHaveLength(4);
    });
  });

  describe('统计信息', () => {
    it('应该提供详细的统计信息', () => {
      scorer.scoreMemories(sampleMemories);
      const stats = scorer.getStats();

      expect(stats).toHaveProperty('totalMemories');
      expect(stats).toHaveProperty('savedMemories');
      expect(stats).toHaveProperty('discardedMemories');
      expect(stats).toHaveProperty('averageScore');
      expect(stats).toHaveProperty('distribution');
    });

    it('应该支持重置统计信息', () => {
      scorer.scoreMemories(sampleMemories);
      scorer.resetStats();
      const stats = scorer.getStats();

      expect(stats.totalMemories).toBe(0);
      expect(stats.savedMemories).toBe(0);
      expect(stats.discardedMemories).toBe(0);
      expect(stats.averageScore).toBe(0);
    });
  });

  describe('边界情况', () => {
    it('应该处理空数组', () => {
      const results = scorer.scoreMemories([]);
      expect(results).toHaveLength(0);

      const stats = scorer.getStats();
      expect(stats.totalMemories).toBe(0);
      expect(stats.averageScore).toBe(0);
    });

    it('应该处理零相关度', () => {
      const memory: MemoryItem = {
        id: 'test',
        type: 'code',
        content: 'Test',
        relevance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = scorer.score(memory);
      expect(result.score).toBe(0);
      expect(result.shouldSave).toBe(false);
    });

    it('应该处理完全相关性', () => {
      const memory: MemoryItem = {
        id: 'test',
        type: 'code',
        content: 'Test',
        relevance: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = scorer.score(memory);
      expect(result.score).toBeCloseTo(0.9 * 1.0 * 0.95, 2); // 0.855
      expect(result.shouldSave).toBe(true);
    });
  });
});
