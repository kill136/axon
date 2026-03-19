/**
 * MemorySearchManager 测试
 * 测试同步竞态修复和单例管理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initMemorySearchManager, getMemorySearchManager, resetMemorySearchManager } from '../../src/memory/memory-search.js';

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
