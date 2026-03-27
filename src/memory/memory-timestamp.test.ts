/**
 * Memory Timestamp 管理器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryTimestampManager,
  type TimestampedMemory,
} from './memory-timestamp.js';

describe('MemoryTimestampManager', () => {
  let manager: MemoryTimestampManager;

  beforeEach(() => {
    manager = new MemoryTimestampManager();
  });

  describe('基本操作', () => {
    it('应该添加记忆并自动设置时间戳', () => {
      const memory: TimestampedMemory = {
        id: 'test-1',
        content: 'Test content',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);

      expect(manager.size()).toBe(1);
      const retrieved = manager.getMemory('test-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('test-1');
      expect(retrieved?.createdAt).toBeDefined();
      expect(retrieved?.updatedAt).toBeDefined();
      expect(retrieved?.accessedAt).toBeDefined();
    });

    it('应该获取记忆', () => {
      const memory: TimestampedMemory = {
        id: 'test-2',
        content: 'Test content',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);
      const retrieved = manager.getMemory('test-2');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('Test content');
    });

    it('应该返回不存在的记忆为 null', () => {
      const retrieved = manager.getMemory('non-existent');
      expect(retrieved).toBeNull();
    });

    it('应该删除记忆', () => {
      const memory: TimestampedMemory = {
        id: 'test-3',
        content: 'Test content',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);
      expect(manager.size()).toBe(1);

      const deleted = manager.deleteMemory('test-3');
      expect(deleted).toBe(true);
      expect(manager.size()).toBe(0);
    });

    it('删除不存在的记忆应该返回 false', () => {
      const deleted = manager.deleteMemory('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('访问时间戳更新', () => {
    it('应该在访问时更新 accessedAt', async () => {
      const memory: TimestampedMemory = {
        id: 'test-4',
        content: 'Test content',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);
      const original = manager.getMemory('test-4');

      // 等待一段时间以确保时间戳有变化
      await new Promise((resolve) => setTimeout(resolve, 50));

      const accessed = manager.accessMemory('test-4');

      expect(accessed).not.toBeNull();
      expect(accessed?.accessedAt?.getTime()).toBeGreaterThanOrEqual(
        original?.accessedAt?.getTime() || 0
      );
    });

    it('访问不存在的记忆应该返回 null', () => {
      const result = manager.accessMemory('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('更新操作', () => {
    it('应该更新记忆内容并自动更新 updatedAt', async () => {
      const memory: TimestampedMemory = {
        id: 'test-5',
        content: 'Original content',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);

      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = manager.updateMemory('test-5', {
        content: 'Updated content',
      });

      expect(updated).not.toBeNull();
      expect(updated?.content).toBe('Updated content');
      expect(updated?.updatedAt?.getTime()).toBeGreaterThan(
        memory.updatedAt.getTime()
      );
    });

    it('更新不存在的记忆应该返回 null', () => {
      const result = manager.updateMemory('non-existent', { content: 'New' });
      expect(result).toBeNull();
    });
  });

  describe('排序功能', () => {
    it('应该按 accessedAt 降序排列记忆', async () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      const memories: TimestampedMemory[] = [
        {
          id: 'old',
          content: 'Old',
          type: 'code',
          createdAt: new Date(now - 3 * oneDayMs),
          updatedAt: new Date(now - 3 * oneDayMs),
          accessedAt: new Date(now - 3 * oneDayMs),
        },
        {
          id: 'recent',
          content: 'Recent',
          type: 'code',
          createdAt: new Date(now - oneDayMs),
          updatedAt: new Date(now - oneDayMs),
          accessedAt: new Date(now - oneDayMs),
        },
        {
          id: 'newest',
          content: 'Newest',
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
          accessedAt: new Date(),
        },
      ];

      for (const memory of memories) {
        manager.addMemory(memory);
      }

      const sorted = manager.getAllMemoriesSortedByAccess(true);

      expect(sorted[0].id).toBe('newest');
      expect(sorted[1].id).toBe('recent');
      expect(sorted[2].id).toBe('old');
    });

    it('应该支持升序排列', async () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      const memories: TimestampedMemory[] = [
        {
          id: 'old',
          content: 'Old',
          type: 'code',
          createdAt: new Date(now - 3 * oneDayMs),
          updatedAt: new Date(now - 3 * oneDayMs),
          accessedAt: new Date(now - 3 * oneDayMs),
        },
        {
          id: 'recent',
          content: 'Recent',
          type: 'code',
          createdAt: new Date(now - oneDayMs),
          updatedAt: new Date(now - oneDayMs),
          accessedAt: new Date(now - oneDayMs),
        },
      ];

      for (const memory of memories) {
        manager.addMemory(memory);
      }

      const sorted = manager.getAllMemoriesSortedByAccess(false);

      expect(sorted[0].id).toBe('old');
      expect(sorted[1].id).toBe('recent');
    });
  });

  describe('陈旧记忆管理', () => {
    it('应该识别陈旧记忆', () => {
      const now = Date.now();
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      const oneHundredDays = 100 * 24 * 60 * 60 * 1000;

      const memories: TimestampedMemory[] = [
        {
          id: 'fresh',
          content: 'Fresh',
          type: 'code',
          createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
          accessedAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
        },
        {
          id: 'stale',
          content: 'Stale',
          type: 'code',
          createdAt: new Date(now - oneHundredDays),
          updatedAt: new Date(now - oneHundredDays),
          accessedAt: new Date(now - oneHundredDays),
        },
      ];

      for (const memory of memories) {
        manager.addMemory(memory);
      }

      const stale = manager.getStaleMemories();
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe('stale');
    });

    it('应该清理陈旧记忆', () => {
      const now = Date.now();
      const oneHundredDays = 100 * 24 * 60 * 60 * 1000;

      const memory: TimestampedMemory = {
        id: 'stale',
        content: 'Stale',
        type: 'code',
        createdAt: new Date(now - oneHundredDays),
        updatedAt: new Date(now - oneHundredDays),
        accessedAt: new Date(now - oneHundredDays),
      };

      manager.addMemory(memory);
      expect(manager.size()).toBe(1);

      const removed = manager.removeStaleMemories();
      expect(removed).toBe(1);
      expect(manager.size()).toBe(0);
    });

    it('应该支持自定义陈旧阈值', () => {
      const customManager = new MemoryTimestampManager(10 * 24 * 60 * 60 * 1000); // 10 days
      const now = Date.now();
      const twentyDays = 20 * 24 * 60 * 60 * 1000;

      const memory: TimestampedMemory = {
        id: 'test',
        content: 'Test',
        type: 'code',
        createdAt: new Date(now - twentyDays),
        updatedAt: new Date(now - twentyDays),
        accessedAt: new Date(now - twentyDays),
      };

      customManager.addMemory(memory);
      const stale = customManager.getStaleMemories();
      expect(stale).toHaveLength(1);
    });
  });

  describe('统计信息', () => {
    it('应该提供访问统计信息', async () => {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      const memories: TimestampedMemory[] = [
        {
          id: '1',
          content: 'First',
          type: 'code',
          createdAt: new Date(now - 3 * oneDayMs),
          updatedAt: new Date(now - 3 * oneDayMs),
          accessedAt: new Date(now - 3 * oneDayMs),
        },
        {
          id: '2',
          content: 'Second',
          type: 'code',
          createdAt: new Date(now - oneDayMs),
          updatedAt: new Date(now - oneDayMs),
          accessedAt: new Date(now - oneDayMs),
        },
      ];

      for (const memory of memories) {
        manager.addMemory(memory);
      }

      const stats = manager.getStats();

      expect(stats.oldestAccess).not.toBeNull();
      expect(stats.newestAccess).not.toBeNull();
      expect(stats.averageAccessAge).toBeGreaterThan(0);
      expect(stats.accessFrequency).toBeGreaterThan(0);
      expect(stats.staleThreshold).toBeDefined();
    });

    it('空管理器应该有空统计信息', () => {
      const stats = manager.getStats();

      expect(stats.oldestAccess).toBeNull();
      expect(stats.newestAccess).toBeNull();
      expect(stats.averageAccessAge).toBe(0);
      expect(stats.accessFrequency).toBe(0);
    });
  });

  describe('导入导出', () => {
    it('应该导出所有记忆', () => {
      const memories: TimestampedMemory[] = [
        {
          id: '1',
          content: 'First',
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          content: 'Second',
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const memory of memories) {
        manager.addMemory(memory);
      }

      const exported = manager.export();
      expect(exported).toHaveLength(2);
      expect(exported[0].id).toBe('1');
      expect(exported[1].id).toBe('2');
    });

    it('应该导入记忆', () => {
      const memories: TimestampedMemory[] = [
        {
          id: '1',
          content: 'First',
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          content: 'Second',
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      manager.import(memories);

      expect(manager.size()).toBe(2);
      expect(manager.getMemory('1')).not.toBeNull();
      expect(manager.getMemory('2')).not.toBeNull();
    });

    it('导入应该清空现有记忆', () => {
      const memory1: TimestampedMemory = {
        id: '1',
        content: 'First',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory1);
      expect(manager.size()).toBe(1);

      const memory2: TimestampedMemory = {
        id: '2',
        content: 'Second',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.import([memory2]);

      expect(manager.size()).toBe(1);
      expect(manager.getMemory('1')).toBeNull();
      expect(manager.getMemory('2')).not.toBeNull();
    });
  });

  describe('清空操作', () => {
    it('应该清空所有记忆', () => {
      const memory: TimestampedMemory = {
        id: 'test',
        content: 'Test',
        type: 'code',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      manager.addMemory(memory);
      expect(manager.size()).toBe(1);

      manager.clear();

      expect(manager.size()).toBe(0);
      const stats = manager.getStats();
      expect(stats.oldestAccess).toBeNull();
      expect(stats.newestAccess).toBeNull();
    });
  });

  describe('性能测试', () => {
    it('应该在 500ms 内加载 1000 条记忆', () => {
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        const memory: TimestampedMemory = {
          id: `memory-${i}`,
          content: `Content ${i}`,
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        manager.addMemory(memory);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(500);
      expect(manager.size()).toBe(1000);
    });

    it('应该快速排序 1000 条记忆', () => {
      for (let i = 0; i < 1000; i++) {
        const memory: TimestampedMemory = {
          id: `memory-${i}`,
          content: `Content ${i}`,
          type: 'code',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        manager.addMemory(memory);
      }

      const startTime = Date.now();
      const sorted = manager.getAllMemoriesSortedByAccess();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(sorted).toHaveLength(1000);
    });
  });
});
