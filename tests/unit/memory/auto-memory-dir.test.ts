/**
 * Auto-memory 目录管理测试
 *
 * 策略：由于 os.homedir() 不可 spyOn，使用 vi.mock('os') 来 mock，
 * 并通过传入显式目录参数来避免依赖 homedir mock 的测试。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock os 模块，让 homedir 可被动态修改
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
  };
});

import {
  getAutoMemoryDir,
  getProjectAutoMemoryDir,
  ensureAutoMemoryDir,
  loadMemoryIndex,
  isAutoMemoryPath,
  getAllMemoryFiles,
} from '../../../src/memory/auto-memory-dir.js';

describe('auto-memory-dir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-memory-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getAutoMemoryDir', () => {
    it('应该返回正确路径 (~/.axon/auto-memory/)', () => {
      const result = getAutoMemoryDir();
      expect(result).toBe(path.join(tmpDir, '.axon', 'auto-memory'));
    });
  });

  describe('ensureAutoMemoryDir', () => {
    it('应该创建目录', () => {
      const memDir = getAutoMemoryDir();
      expect(fs.existsSync(memDir)).toBe(false);

      const result = ensureAutoMemoryDir();
      expect(fs.existsSync(result)).toBe(true);
      expect(result).toBe(memDir);
    });

    it('应该接受自定义目录路径', () => {
      const customDir = path.join(tmpDir, 'custom-memory');
      const result = ensureAutoMemoryDir(customDir);
      expect(fs.existsSync(customDir)).toBe(true);
      expect(result).toBe(customDir);
    });

    it('目录已存在时不应报错', () => {
      ensureAutoMemoryDir();
      expect(() => ensureAutoMemoryDir()).not.toThrow();
    });
  });

  describe('loadMemoryIndex', () => {
    let memDir: string;

    beforeEach(() => {
      memDir = ensureAutoMemoryDir();
    });

    it('应该正常加载 MEMORY.md', () => {
      const content = '# AXON Memory\n\n- Item 1\n- Item 2';
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content);

      const result = loadMemoryIndex(memDir);
      expect(result).toBe(content.trim());
    });

    it('超过200行时应截断并添加警告', () => {
      const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`);
      const content = lines.join('\n');
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content);

      const result = loadMemoryIndex(memDir);
      expect(result).not.toBeNull();

      const resultLines = result!.split('\n');
      expect(resultLines[0]).toBe('Line 1');
      expect(resultLines[199]).toBe('Line 200');
      expect(result).toContain('WARNING');
      expect(result).toContain('200');
    });

    it('超过40000字符时应截断并添加警告', () => {
      // 创建一个超过40000字符但不到200行的内容
      const longLine = 'x'.repeat(5000);
      const lines = Array.from({ length: 10 }, () => longLine);
      const content = lines.join('\n'); // 10行，每行5000字符 = 50000+ 字符
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), content);

      const result = loadMemoryIndex(memDir);
      expect(result).not.toBeNull();
      expect(result).toContain('WARNING');
      expect(result).toContain('40000');
    });

    it('文件不存在时应返回 null', () => {
      const result = loadMemoryIndex(memDir);
      expect(result).toBeNull();
    });

    it('不指定目录时应使用默认目录', () => {
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# Test');

      const result = loadMemoryIndex();
      expect(result).toBe('# Test');
    });
  });

  describe('isAutoMemoryPath', () => {
    it('应该正确判断 auto-memory 目录内的路径', () => {
      const memDir = getAutoMemoryDir();
      const filePath = path.join(memDir, 'MEMORY.md');
      expect(isAutoMemoryPath(filePath)).toBe(true);
    });

    it('应该正确判断子目录内的路径', () => {
      const memDir = getAutoMemoryDir();
      const filePath = path.join(memDir, 'project', 'notes.md');
      expect(isAutoMemoryPath(filePath)).toBe(true);
    });

    it('应该正确拒绝非 auto-memory 路径', () => {
      expect(isAutoMemoryPath('/tmp/other/file.md')).toBe(false);
    });

    it('应该正确拒绝相似但不同的路径', () => {
      expect(isAutoMemoryPath(path.join(tmpDir, '.axon', 'sessions', 'file.md'))).toBe(false);
    });
  });

  describe('getAllMemoryFiles', () => {
    let memDir: string;

    beforeEach(() => {
      memDir = ensureAutoMemoryDir();
    });

    it('应该列出所有 .md 文件', () => {
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# Index');
      fs.writeFileSync(path.join(memDir, 'debugging.md'), '# Debugging');
      fs.writeFileSync(path.join(memDir, 'patterns.md'), '# Patterns');
      fs.writeFileSync(path.join(memDir, 'notes.txt'), 'not a markdown file');

      const files = getAllMemoryFiles(memDir);
      expect(files).toHaveLength(3);
      expect(files).toContain(path.join(memDir, 'MEMORY.md'));
      expect(files).toContain(path.join(memDir, 'debugging.md'));
      expect(files).toContain(path.join(memDir, 'patterns.md'));
    });

    it('目录不存在时应返回空数组', () => {
      const result = getAllMemoryFiles(path.join(tmpDir, 'nonexistent'));
      expect(result).toEqual([]);
    });

    it('目录为空时应返回空数组', () => {
      const result = getAllMemoryFiles(memDir);
      expect(result).toEqual([]);
    });

    it('应该忽略子目录', () => {
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# Index');
      fs.mkdirSync(path.join(memDir, 'subdir'));
      fs.writeFileSync(path.join(memDir, 'subdir', 'nested.md'), '# Nested');

      const files = getAllMemoryFiles(memDir);
      expect(files).toHaveLength(1);
      expect(files).toContain(path.join(memDir, 'MEMORY.md'));
    });
  });

  describe('getProjectAutoMemoryDir', () => {
    it('无项目路径时应返回基础目录', () => {
      const result = getProjectAutoMemoryDir();
      expect(result).toBe(getAutoMemoryDir());
    });

    it('有项目路径时应返回项目特定子目录', () => {
      const result = getProjectAutoMemoryDir('/home/user/my-project');
      const baseDir = getAutoMemoryDir();
      expect(result.startsWith(baseDir)).toBe(true);
      expect(result).not.toBe(baseDir);
    });

    it('应该将路径中的特殊字符转换为安全字符', () => {
      const result = getProjectAutoMemoryDir('/home/user/my-project');
      const subDir = path.basename(result);
      expect(subDir).not.toContain('/');
      // 前导/被去掉，其余/变-
      expect(subDir).toBe('home-user-my-project');
    });

    it('应该处理含特殊字符的项目路径', () => {
      const result = getProjectAutoMemoryDir('/home/user/my project@v2');
      const subDir = path.basename(result);
      expect(subDir).not.toContain('/');
      expect(subDir).not.toContain(' ');
      expect(subDir).not.toContain('@');
    });
  });
});
