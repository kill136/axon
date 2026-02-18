/**
 * 长期记忆存储层
 * 基于 SQLite + FTS5 实现高效的 BM25 搜索
 */

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { MemorySource, MemorySearchResult } from './types.js';

// 时间衰减参数：半衰期 30 天（毫秒）
const HALF_LIFE = 30 * 24 * 60 * 60 * 1000;

/**
 * 文件条目
 */
export interface FileEntry {
  path: string;
  absPath: string;
  source: MemorySource;
  hash: string;
  mtime: number;
  size: number;
}

/**
 * 分块选项
 */
export interface ChunkOptions {
  tokens?: number;   // 目标 token 数（默认 400）
  overlap?: number;  // 重叠 token 数（默认 80）
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  source?: MemorySource;
  maxResults?: number;
  minScore?: number;
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 长期记忆存储管理器
 */
export class LongTermStore {
  private db: Database.Database;
  private hasFTS5: boolean = false;

  constructor(dbPath: string) {
    // 确保目录存在
    ensureDir(path.dirname(dbPath));

    // 打开数据库
    this.db = new Database(dbPath);
    
    // 初始化 schema
    this.initSchema();
  }

  /**
   * 初始化数据库 schema
   */
  private initSchema(): void {
    // 创建元数据表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 创建文件表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
    `);

    // 创建 chunk 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
    `);

    // 尝试创建 FTS5 虚拟表
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          id UNINDEXED,
          path UNINDEXED,
          source UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
      this.hasFTS5 = true;
    } catch (error) {
      console.warn('[LongTermStore] FTS5 not available, fallback to basic search');
      this.hasFTS5 = false;
    }

    // 设置版本
    const versionStmt = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    versionStmt.run('version', '1');
  }

  /**
   * 索引文件
   */
  indexFile(entry: FileEntry, content: string, chunkOpts?: ChunkOptions): void {
    const tokens = chunkOpts?.tokens ?? 400;
    const overlap = chunkOpts?.overlap ?? 80;
    const maxChars = tokens * 4; // 粗略估算：1 token ≈ 4 chars
    const overlapChars = overlap * 4;

    // 分块
    const lines = content.split('\n');
    const chunks: Array<{
      startLine: number;
      endLine: number;
      text: string;
    }> = [];

    let currentChunk: string[] = [];
    let currentStartLine = 1;
    let currentLength = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunk.push(line);
      currentLength += line.length;

      // 达到最大长度或最后一行
      if (currentLength >= maxChars || i === lines.length - 1) {
        if (currentChunk.length > 0) {
          chunks.push({
            startLine: currentStartLine,
            endLine: i + 1,
            text: currentChunk.join('\n'),
          });

          // 准备下一个 chunk，保留 overlap 行
          const overlapLineCount = Math.floor(overlapChars / (currentLength / currentChunk.length));
          const keepLines = Math.min(overlapLineCount, currentChunk.length - 1);
          
          if (keepLines > 0 && i < lines.length - 1) {
            currentChunk = currentChunk.slice(-keepLines);
            currentStartLine = i + 2 - keepLines;
            currentLength = currentChunk.reduce((sum, l) => sum + l.length, 0);
          } else {
            currentChunk = [];
            currentStartLine = i + 2;
            currentLength = 0;
          }
        }
      }
    }

    // 使用事务写入
    const transaction = this.db.transaction(() => {
      // 更新文件表
      const upsertFileStmt = this.db.prepare(`
        INSERT OR REPLACE INTO files (path, source, hash, mtime, size)
        VALUES (?, ?, ?, ?, ?)
      `);
      upsertFileStmt.run(entry.path, entry.source, entry.hash, entry.mtime, entry.size);

      // 删除旧 chunks
      const deleteChunksStmt = this.db.prepare('DELETE FROM chunks WHERE path = ?');
      deleteChunksStmt.run(entry.path);

      if (this.hasFTS5) {
        const deleteFtsStmt = this.db.prepare('DELETE FROM chunks_fts WHERE path = ?');
        deleteFtsStmt.run(entry.path);
      }

      // 插入新 chunks
      const insertChunkStmt = this.db.prepare(`
        INSERT INTO chunks (id, path, source, start_line, end_line, text, hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFtsStmt = this.hasFTS5 ? this.db.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?)
      `) : null;

      const now = Date.now();

      for (const chunk of chunks) {
        const chunkId = crypto.randomUUID();
        const chunkHash = crypto.createHash('sha256').update(chunk.text).digest('hex');

        insertChunkStmt.run(
          chunkId,
          entry.path,
          entry.source,
          chunk.startLine,
          chunk.endLine,
          chunk.text,
          chunkHash,
          now,
          now
        );

        if (insertFtsStmt) {
          insertFtsStmt.run(
            chunk.text,
            chunkId,
            entry.path,
            entry.source,
            chunk.startLine,
            chunk.endLine
          );
        }
      }
    });

    transaction();
  }

  /**
   * 删除文件的所有 chunk
   */
  removeFile(filePath: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
      if (this.hasFTS5) {
        this.db.prepare('DELETE FROM chunks_fts WHERE path = ?').run(filePath);
      }
      this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
    });
    transaction();
  }

  /**
   * 搜索（FTS5 + 时间衰减）
   */
  search(query: string, opts?: SearchOptions): MemorySearchResult[] {
    const maxResults = opts?.maxResults ?? 8;
    const minScore = opts?.minScore ?? 0.3;
    const source = opts?.source;

    let results: MemorySearchResult[] = [];

    if (this.hasFTS5) {
      // 使用 FTS5 搜索
      let sql = `
        SELECT 
          c.id,
          c.path,
          c.source,
          c.start_line,
          c.end_line,
          c.text,
          c.created_at,
          bm25(chunks_fts) as rank
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.id = c.id
        WHERE chunks_fts MATCH ?
      `;

      const params: any[] = [query];
      if (source) {
        sql += ` AND c.source = ?`;
        params.push(source);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(maxResults * 2);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Array<{
        id: string;
        path: string;
        source: string;
        start_line: number;
        end_line: number;
        text: string;
        created_at: number;
        rank: number;
      }>;

      const now = Date.now();

      for (const row of rows) {
        // 转换 FTS5 rank 为正分数
        const rawScore = 1 / (1 + Math.abs(row.rank));
        
        // 时间衰减
        const age = now - row.created_at;
        const decay = 1 / (1 + age / HALF_LIFE);
        const finalScore = rawScore * decay;

        if (finalScore >= minScore) {
          results.push({
            id: row.id,
            path: row.path,
            startLine: row.start_line,
            endLine: row.end_line,
            score: finalScore,
            snippet: this.extractSnippet(row.text, query),
            source: row.source as MemorySource,
            timestamp: new Date(row.created_at).toISOString(),
            age,
          });
        }
      }
    } else {
      // Fallback: 简单的 LIKE 搜索
      let sql = `
        SELECT id, path, source, start_line, end_line, text, created_at
        FROM chunks
        WHERE text LIKE ?
      `;

      const fallbackParams: any[] = [`%${query}%`];
      if (source) {
        sql += ` AND source = ?`;
        fallbackParams.push(source);
      }

      sql += ` LIMIT ?`;
      fallbackParams.push(maxResults * 2);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...fallbackParams) as Array<{
        id: string;
        path: string;
        source: string;
        start_line: number;
        end_line: number;
        text: string;
        created_at: number;
      }>;

      const now = Date.now();

      for (const row of rows) {
        const age = now - row.created_at;
        const decay = 1 / (1 + age / HALF_LIFE);
        const rawScore = 0.5; // 简单搜索给固定分数
        const finalScore = rawScore * decay;

        if (finalScore >= minScore) {
          results.push({
            id: row.id,
            path: row.path,
            startLine: row.start_line,
            endLine: row.end_line,
            score: finalScore,
            snippet: this.extractSnippet(row.text, query),
            source: row.source as MemorySource,
            timestamp: new Date(row.created_at).toISOString(),
            age,
          });
        }
      }
    }

    // 排序并限制结果
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * 提取摘要片段
   */
  private extractSnippet(text: string, query: string, maxLength: number = 200): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      // 未找到，返回开头
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }

    // 找到了，返回周围的文本
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 150);
    
    let snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    
    return snippet;
  }

  /**
   * 检查文件是否已索引
   */
  hasFile(filePath: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM files WHERE path = ? LIMIT 1');
    return stmt.get(filePath) !== undefined;
  }

  /**
   * 获取已索引文件的 hash
   */
  getFileHash(filePath: string): string | null {
    const stmt = this.db.prepare('SELECT hash FROM files WHERE path = ? LIMIT 1');
    const row = stmt.get(filePath) as { hash: string } | undefined;
    return row?.hash ?? null;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalFiles: number;
    totalChunks: number;
    dbSizeBytes: number;
  } {
    const filesStmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
    const chunksStmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    
    const filesCount = (filesStmt.get() as { count: number }).count;
    const chunksCount = (chunksStmt.get() as { count: number }).count;

    // 获取数据库文件大小
    let dbSize = 0;
    try {
      const dbPath = (this.db as any).name; // better-sqlite3 内部属性
      if (dbPath && fs.existsSync(dbPath)) {
        dbSize = fs.statSync(dbPath).size;
      }
    } catch {
      // 忽略错误
    }

    return {
      totalFiles: filesCount,
      totalChunks: chunksCount,
      dbSizeBytes: dbSize,
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
