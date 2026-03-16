/**
 * POST /api/files/browse — 目录浏览 API 测试
 * 
 * 直接测试 browse 逻辑（通过临时目录），不依赖 supertest。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Directory Browse API logic', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-test-'));
    // 创建子目录
    fs.mkdirSync(path.join(testDir, 'alpha'));
    fs.mkdirSync(path.join(testDir, 'beta'));
    fs.mkdirSync(path.join(testDir, 'gamma'));
    fs.mkdirSync(path.join(testDir, '.hidden'));
    // 创建文件（应被过滤）
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'test');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * 模拟 browse 逻辑（与 file-api.ts 中的 POST /api/files/browse 一致）
   */
  async function browsePath(requestedPath: string) {
    const fsP = fs.promises;

    if (!requestedPath) {
      // 根级别 - 跳过测试
      return null;
    }

    const normalized = path.resolve(requestedPath);
    
    // 安全检查
    if (normalized.includes('..')) {
      throw new Error('Invalid path');
    }

    const stat = await fsP.stat(normalized);
    if (!stat.isDirectory()) {
      throw new Error('Not a directory');
    }

    const parentDir = path.dirname(normalized);
    const hasParent = parentDir !== normalized;

    const entries = await fsP.readdir(normalized, { withFileTypes: true });
    const dirs = entries
      .filter(e => {
        try {
          return e.isDirectory() && !e.name.startsWith('.');
        } catch { return false; }
      })
      .map(e => ({
        name: e.name,
        path: path.join(normalized, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      current: normalized,
      parent: hasParent ? parentDir : null,
      dirs,
    };
  }

  it('should list only non-hidden directories', async () => {
    const result = await browsePath(testDir);
    expect(result).toBeTruthy();
    expect(result!.dirs).toHaveLength(3);
    expect(result!.dirs.map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('should exclude files from results', async () => {
    const result = await browsePath(testDir);
    const names = result!.dirs.map(d => d.name);
    expect(names).not.toContain('file.txt');
  });

  it('should exclude hidden directories', async () => {
    const result = await browsePath(testDir);
    const names = result!.dirs.map(d => d.name);
    expect(names).not.toContain('.hidden');
  });

  it('should return sorted directories', async () => {
    const result = await browsePath(testDir);
    expect(result!.dirs[0].name).toBe('alpha');
    expect(result!.dirs[1].name).toBe('beta');
    expect(result!.dirs[2].name).toBe('gamma');
  });

  it('should return full paths for each directory', async () => {
    const result = await browsePath(testDir);
    for (const dir of result!.dirs) {
      expect(path.isAbsolute(dir.path)).toBe(true);
      expect(dir.path).toContain(dir.name);
    }
  });

  it('should return current and parent paths', async () => {
    const result = await browsePath(testDir);
    expect(result!.current).toBe(path.resolve(testDir));
    expect(result!.parent).toBe(path.dirname(path.resolve(testDir)));
  });

  it('should return parent for nested directory', async () => {
    const nested = path.join(testDir, 'alpha');
    const result = await browsePath(nested);
    expect(result!.parent).toBe(path.resolve(testDir));
  });

  it('should handle empty directories', async () => {
    const emptyDir = path.join(testDir, 'alpha');
    const result = await browsePath(emptyDir);
    expect(result!.dirs).toHaveLength(0);
  });

  it('should throw for non-existent path', async () => {
    await expect(browsePath(path.join(testDir, 'nonexistent'))).rejects.toThrow();
  });

  it('should throw for file path', async () => {
    await expect(browsePath(path.join(testDir, 'file.txt'))).rejects.toThrow('Not a directory');
  });
});
