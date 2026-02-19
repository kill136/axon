/**
 * 记忆增量同步引擎
 * 扫描 memory 和 session 文件，基于 hash 对比增量更新
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import type { LongTermStore, FileEntry } from './long-term-store.js';
import type { MemorySource } from './types.js';

/**
 * 同步结果统计
 */
export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * 递归列出目录下的所有 .md 文件
 */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    // 检查目录是否存在
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
      return [];
    }

    // 使用 glob 查找所有 .md 文件
    const pattern = path.join(dir, '**/*.md').replace(/\\/g, '/');
    const files = await glob(pattern, { 
      nodir: true,
      absolute: true,
    });

    return files;
  } catch (error) {
    // 目录不存在或无权限，返回空数组
    return [];
  }
}

/**
 * 计算文件 hash (SHA-256)
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 构建文件条目
 */
async function buildFileEntry(
  absPath: string,
  baseDir: string,
  source: MemorySource
): Promise<FileEntry> {
  const stats = await fs.stat(absPath);
  const hash = await computeFileHash(absPath);
  
  // 计算相对路径
  let relativePath = path.relative(baseDir, absPath);
  // 规范化路径（反斜杠转正斜杠）
  relativePath = relativePath.replace(/\\/g, '/');

  return {
    path: relativePath,
    absPath,
    source,
    hash,
    mtime: stats.mtimeMs,
    size: stats.size,
  };
}

/**
 * 记忆同步引擎
 */
export class MemorySyncEngine {
  private store: LongTermStore;
  private projectDir?: string;

  constructor(store: LongTermStore, opts?: { projectDir?: string }) {
    this.store = store;
    this.projectDir = opts?.projectDir;
  }

  /**
   * 同步 memory 目录下的 .md 文件
   */
  async syncMemoryFiles(memoryDir: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    };

    try {
      // 列出所有 .md 文件
      const files = await listMarkdownFiles(memoryDir);
      const processedPaths = new Set<string>();

      for (const absPath of files) {
        try {
          // 跳过符号链接
          const stats = await fs.lstat(absPath);
          if (stats.isSymbolicLink()) {
            continue;
          }

          // 构建文件条目
          const entry = await buildFileEntry(absPath, memoryDir, 'memory');
          processedPaths.add(entry.path);

          // 检查是否需要更新
          const existingHash = this.store.getFileHash(entry.path);

          if (!existingHash) {
            // 新文件
            const content = await fs.readFile(absPath, 'utf-8');
            this.store.indexFile(entry, content);
            result.added++;
          } else if (existingHash !== entry.hash) {
            // 文件已修改
            const content = await fs.readFile(absPath, 'utf-8');
            this.store.indexFile(entry, content);
            result.updated++;
          } else {
            // 未修改
            result.unchanged++;
          }
        } catch (error) {
          // 单个文件处理失败不影响其他文件
          console.warn(`[MemorySync] Failed to process file ${absPath}:`, error);
        }
      }

      // Delete indexed paths that no longer exist on disk (source: 'memory')
      const indexedPaths = this.store.listFilePaths('memory');
      for (const indexedPath of indexedPaths) {
        if (!processedPaths.has(indexedPath)) {
          this.store.removeFile(indexedPath);
          result.removed++;
        }
      }

    } catch (error) {
      console.error('[MemorySync] Failed to sync memory files:', error);
    }

    return result;
  }

  /**
   * 同步 session 目录下的 summary.md 文件
   */
  async syncSessionFiles(sessionsDir: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    };

    try {
      // 查找所有 session-memory/summary.md 文件
      const pattern = path.join(sessionsDir, '*/session-memory/summary.md').replace(/\\/g, '/');
      const files = await glob(pattern, { 
        nodir: true,
        absolute: true,
      });
      const processedPaths = new Set<string>();


      for (const absPath of files) {
        try {
          // 跳过符号链接
          const stats = await fs.lstat(absPath);
          if (stats.isSymbolicLink()) {
            continue;
          }

          // 构建文件条目
          const entry = await buildFileEntry(absPath, sessionsDir, 'session');
          processedPaths.add(entry.path);

          // 检查是否需要更新
          const existingHash = this.store.getFileHash(entry.path);

          if (!existingHash) {
            // 新文件
            const content = await fs.readFile(absPath, 'utf-8');
            this.store.indexFile(entry, content);
            result.added++;
          } else if (existingHash !== entry.hash) {
            // 文件已修改
            const content = await fs.readFile(absPath, 'utf-8');
            this.store.indexFile(entry, content);
            result.updated++;
          } else {
            // 未修改
            result.unchanged++;
          }
        } catch (error) {
          console.warn(`[MemorySync] Failed to process session file ${absPath}:`, error);
        }
      }
      // Delete indexed paths for 'session' source that no longer exist on disk
      const indexedSessionPaths = this.store.listFilePaths('session');
      for (const indexedPath of indexedSessionPaths) {
        if (!processedPaths.has(indexedPath)) {
          this.store.removeFile(indexedPath);
          result.removed++;
        }
      }


    } catch (error) {
      console.error('[MemorySync] Failed to sync session files:', error);
    }

    return result;
  }

  /**
   * 同步所有文件
   */
  async syncAll(opts?: {
    memoryDir?: string;
    sessionsDir?: string;
  }): Promise<{
    memory: SyncResult;
    sessions: SyncResult;
  }> {
    const memoryDir = opts?.memoryDir;
    const sessionsDir = opts?.sessionsDir;

    const memoryResult: SyncResult = memoryDir
      ? await this.syncMemoryFiles(memoryDir)
      : { added: 0, updated: 0, removed: 0, unchanged: 0 };

    const sessionsResult: SyncResult = sessionsDir
      ? await this.syncSessionFiles(sessionsDir)
      : { added: 0, updated: 0, removed: 0, unchanged: 0 };

    return {
      memory: memoryResult,
      sessions: sessionsResult,
    };
  }
}
