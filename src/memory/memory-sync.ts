/**
 * 记忆增量同步引擎
 * 扫描 memory、session summary、session transcript 文件，基于 hash 对比增量更新
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
   * 同步 sessions 目录下的会话 transcript（.json 文件）
   * 从 messages/chatHistory 中提取用户和助手的纯文本，转为 Markdown 索引
   */
  async syncTranscriptFiles(transcriptsDir: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    };

    try {
      const dirStat = await fs.stat(transcriptsDir).catch(() => null);
      if (!dirStat?.isDirectory()) return result;

      const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
      const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json'));

      // 用 "transcript:" 前缀区分，避免和 summary.md 路径冲突
      const processedPaths = new Set<string>();

      for (const dirent of jsonFiles) {
        const absPath = path.join(transcriptsDir, dirent.name);
        const indexPath = `transcript:${dirent.name}`;
        processedPaths.add(indexPath);

        try {
          const stat = await fs.stat(absPath);
          // 用 mtime+size 做轻量 hash，避免读取大文件
          const quickHash = crypto.createHash('sha256')
            .update(`${stat.mtimeMs}:${stat.size}`)
            .digest('hex');

          const existingHash = this.store.getFileHash(indexPath);
          if (existingHash === quickHash) {
            result.unchanged++;
            continue;
          }

          // 读取并解析 JSON
          const raw = await fs.readFile(absPath, 'utf-8');
          let data: any;
          try {
            data = JSON.parse(raw);
          } catch {
            continue; // 跳过损坏的 JSON
          }

          // 提取对话文本
          const markdown = this.extractTranscriptMarkdown(data);
          if (!markdown) {
            result.unchanged++;
            continue;
          }

          // 构建 FileEntry 并索引
          const entry: FileEntry = {
            path: indexPath,
            absPath,
            source: 'session',
            hash: quickHash,
            mtime: stat.mtimeMs,
            size: markdown.length,
          };

          this.store.indexFile(entry, markdown);
          result[existingHash ? 'updated' : 'added']++;
        } catch (error) {
          console.warn(`[MemorySync] Failed to process transcript ${dirent.name}:`, error);
        }
      }

      // 清理已删除的 transcript 索引
      const indexedPaths = this.store.listFilePaths('session');
      for (const p of indexedPaths) {
        if (p.startsWith('transcript:') && !processedPaths.has(p)) {
          this.store.removeFile(p);
          result.removed++;
        }
      }
    } catch (error) {
      console.error('[MemorySync] Failed to sync transcript files:', error);
    }

    return result;
  }

  /**
   * 从会话 JSON 中提取对话文本，转为 Markdown 格式
   * 只提取 user/assistant 的纯文本内容，跳过 tool_use/tool_result 噪音
   */
  private extractTranscriptMarkdown(data: any): string | null {
    const metadata = data?.metadata;
    const messages: any[] = data?.messages || [];
    const chatHistory: any[] = data?.chatHistory || [];

    // 优先用 chatHistory（已经是面向展示的格式），fallback 到 messages
    const source = chatHistory.length > 0 ? chatHistory : messages;
    if (source.length === 0) return null;

    const lines: string[] = [];

    // 标题
    const name = metadata?.name || metadata?.id || 'Untitled';
    const date = metadata?.createdAt
      ? new Date(metadata.createdAt).toISOString().split('T')[0]
      : '';
    lines.push(`# ${name}`);
    if (date) lines.push(`Date: ${date}`);
    if (metadata?.model) lines.push(`Model: ${metadata.model}`);
    if (metadata?.workingDirectory) lines.push(`Project: ${metadata.workingDirectory}`);
    lines.push('');

    // 提取对话（限制总长度，避免超大会话占太多索引空间）
    const MAX_CHARS = 20000;
    let totalChars = 0;

    for (const msg of source) {
      if (totalChars >= MAX_CHARS) {
        lines.push('\n[...truncated...]');
        break;
      }

      const role = msg.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const texts = this.extractTextFromContent(msg.content);
      if (!texts) continue;

      const prefix = role === 'user' ? '## User' : '## Assistant';
      lines.push(prefix);
      const text = texts.substring(0, MAX_CHARS - totalChars);
      lines.push(text);
      lines.push('');
      totalChars += text.length;
    }

    // 至少要有一条消息才有索引价值
    if (totalChars === 0) return null;

    return lines.join('\n');
  }

  /**
   * 从 message.content 中提取纯文本
   */
  private extractTextFromContent(content: any): string | null {
    if (!content) return null;

    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          texts.push(block.text);
        }
        // 跳过 tool_use, tool_result, image 等
      }
      return texts.length > 0 ? texts.join('\n') : null;
    }

    return null;
  }

  /**
   * 同步所有文件
   */
  async syncAll(opts?: {
    memoryDir?: string;
    sessionsDir?: string;
    transcriptsDir?: string;
  }): Promise<{
    memory: SyncResult;
    sessions: SyncResult;
    transcripts: SyncResult;
  }> {
    const memoryDir = opts?.memoryDir;
    const sessionsDir = opts?.sessionsDir;
    const transcriptsDir = opts?.transcriptsDir;

    const memoryResult: SyncResult = memoryDir
      ? await this.syncMemoryFiles(memoryDir)
      : { added: 0, updated: 0, removed: 0, unchanged: 0 };

    const sessionsResult: SyncResult = sessionsDir
      ? await this.syncSessionFiles(sessionsDir)
      : { added: 0, updated: 0, removed: 0, unchanged: 0 };

    const transcriptsResult: SyncResult = transcriptsDir
      ? await this.syncTranscriptFiles(transcriptsDir)
      : { added: 0, updated: 0, removed: 0, unchanged: 0 };

    return {
      memory: memoryResult,
      sessions: sessionsResult,
      transcripts: transcriptsResult,
    };
  }
}
