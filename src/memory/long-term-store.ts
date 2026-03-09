/**
 * 长期记忆存储层
 * 基于 SQLite + FTS5 + sqlite-vec 实现混合搜索（BM25 + 向量）
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { MemorySource, MemorySearchResult } from './types.js';
import { extractKeywords } from './query-expansion.js';
import { cosineSimilarity } from './embedding-provider.js';
import type { VectorSearchResult, KeywordSearchResult } from './hybrid-search.js';

// 时间衰减参数：半衰期 30 天（毫秒）
const HALF_LIFE = 30 * 24 * 60 * 60 * 1000;

// CJK Unicode 范围正则
const CJK_RE = /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g;

/**
 * 中文字级分词：在每个 CJK 字符间插入空格
 * "会话消息丢失" → "会 话 消 息 丢 失"
 * 非 CJK 字符保持原样，英文单词照常按空格分词
 */
function tokenizeChinese(text: string): string {
  return text.replace(CJK_RE, ' $1 ').replace(/\s{2,}/g, ' ').trim();
}

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
  private db!: import('better-sqlite3').Database;
  private hasFTS5: boolean = false;
  private hasVecSearch: boolean = false;
  private vecDimensions: number = 1536;

  private constructor(dbPath: string) {
    // 确保目录存在
    ensureDir(path.dirname(dbPath));
  }

  static async create(dbPath: string, dimensions?: number): Promise<LongTermStore> {
    const store = new LongTermStore(dbPath);
    if (dimensions) store.vecDimensions = dimensions;
    await store._init(dbPath);
    return store;
  }

  private async _init(dbPath: string): Promise<void> {
    const mod = await import('better-sqlite3').catch(e => {
      throw new Error(
        'Failed to load better-sqlite3 module. Please ensure build dependencies are installed:\n' +
        '  Ubuntu/Debian: apt-get install python3 make g++\n' +
        '  Then re-run: npm install better-sqlite3\n' +
        'Original error: ' + (e.message)
      );
    });
    this.db = new mod.default(dbPath);

    // 尝试加载 sqlite-vec 扩展
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(this.db);
      this.hasVecSearch = true;
    } catch {
      // sqlite-vec 不可用，降级到纯 FTS5 或内存向量搜索
    }

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

    // 版本迁移
    const CURRENT_VERSION = '3';
    const versionRow = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('version') as { value: string } | undefined;
    const existingVersion = versionRow?.value;

    if (!existingVersion || existingVersion < '2') {
      // v1→v2：引入中文字级分词，需要重建 FTS 索引
      this.db.exec('DELETE FROM chunks');
      this.db.exec('DELETE FROM files');
      if (this.hasFTS5) {
        this.db.exec('DELETE FROM chunks_fts');
      }
    }

    if (!existingVersion || existingVersion < '3') {
      // v2→v3：新增 embedding 列（不清空数据，旧 chunk 无 embedding 值为 NULL）
      try {
        this.db.exec('ALTER TABLE chunks ADD COLUMN embedding TEXT');
      } catch {
        // 列已存在，忽略
      }
    }

    // 创建 sqlite-vec 虚拟表（如果扩展可用）
    if (this.hasVecSearch) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            chunk_id TEXT PRIMARY KEY,
            embedding float[${this.vecDimensions}]
          );
        `);
      } catch (e) {
        // 创建失败，禁用向量搜索
        this.hasVecSearch = false;
      }
    }

    const versionStmt = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    versionStmt.run('version', CURRENT_VERSION);
  }

  /**
   * 索引文件
   * @param embeddings 可选的 embedding 数组，与分块一一对应
   */
  indexFile(entry: FileEntry, content: string, chunkOpts?: ChunkOptions, embeddings?: number[][]): void {
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

      // 删除旧的向量数据（必须在删除 chunks 之前，因为需要旧 chunk ids）
      if (this.hasVecSearch) {
        const oldIds = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(entry.path) as { id: string }[];
        if (oldIds.length > 0) {
          const deleteVecStmt = this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?');
          for (const row of oldIds) {
            try { deleteVecStmt.run(row.id); } catch { /* ignore */ }
          }
        }
      }

      // 删除旧 chunks
      const deleteChunksStmt = this.db.prepare('DELETE FROM chunks WHERE path = ?');
      deleteChunksStmt.run(entry.path);

      if (this.hasFTS5) {
        const deleteFtsStmt = this.db.prepare('DELETE FROM chunks_fts WHERE path = ?');
        deleteFtsStmt.run(entry.path);
      }

      // 插入新 chunks
      const insertChunkStmt = this.db.prepare(`
        INSERT INTO chunks (id, path, source, start_line, end_line, text, hash, embedding, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFtsStmt = this.hasFTS5 ? this.db.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?)
      `) : null;

      const insertVecStmt = this.hasVecSearch ? this.db.prepare(`
        INSERT INTO chunks_vec (chunk_id, embedding)
        VALUES (?, ?)
      `) : null;

      const now = Date.now();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = crypto.randomUUID();
        const chunkHash = crypto.createHash('sha256').update(chunk.text).digest('hex');
        const embedding = embeddings?.[i] ?? null;
        const embeddingJson = embedding ? JSON.stringify(embedding) : null;

        insertChunkStmt.run(
          chunkId,
          entry.path,
          entry.source,
          chunk.startLine,
          chunk.endLine,
          chunk.text,
          chunkHash,
          embeddingJson,
          now,
          now
        );

        if (insertFtsStmt) {
          insertFtsStmt.run(
            tokenizeChinese(chunk.text),
            chunkId,
            entry.path,
            entry.source,
            chunk.startLine,
            chunk.endLine
          );
        }

        if (insertVecStmt && embedding) {
          try {
            insertVecStmt.run(chunkId, new Float32Array(embedding));
          } catch {
            // 向量插入失败不阻塞
          }
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
      // 删除向量数据（先于 chunks 删除）
      if (this.hasVecSearch) {
        const oldIds = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(filePath) as { id: string }[];
        const deleteVecStmt = this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?');
        for (const row of oldIds) {
          try { deleteVecStmt.run(row.id); } catch { /* ignore */ }
        }
      }

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
    const source = opts?.source;

    let results: MemorySearchResult[] = [];

    if (this.hasFTS5) {
      // 对查询做中文字级分词，与入库时一致
      // 转义 FTS5 特殊字符，防止搜索语法错误
      const escaped = query.replace(/["\-*(){}:^~\[\]\\+.]/g, ' ');
      const ftsQuery = tokenizeChinese(escaped);

      // 第一轮：原始 query 搜索
      results = this.fts5Search(ftsQuery, source, maxResults * 2);

      // 第二轮：关键词扩展搜索（结果不足时补充）
      if (results.length < Math.ceil(maxResults / 2)) {
        const keywords = extractKeywords(query);
        if (keywords.length > 0) {
          // 对每个关键词做中文分词，用 OR 连接
          const keywordQuery = keywords
            .map(kw => tokenizeChinese(kw.replace(/["\-*(){}:^~\[\]\\+.]/g, ' ')))
            .filter(kw => kw.trim().length > 0)
            .join(' OR ');

          if (keywordQuery.trim()) {
            const supplementary = this.fts5Search(keywordQuery, source, maxResults * 2);

            // 合并去重（按 id）
            const seenIds = new Set(results.map(r => r.id));
            for (const r of supplementary) {
              if (!seenIds.has(r.id)) {
                // 降权补充结果（乘以 0.8 表示关键词匹配比原文匹配弱）
                r.score *= 0.8;
                results.push(r);
                seenIds.add(r.id);
              }
            }
          }
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

    // 排序并限制结果
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * FTS5 搜索（BM25 评分 + 时间衰减）
   */
  private fts5Search(ftsQuery: string, source: MemorySource | undefined, limit: number): MemorySearchResult[] {
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

    const params: any[] = [ftsQuery];
    if (source) {
      sql += ` AND c.source = ?`;
      params.push(source);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

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

    // BM25 rank 是负数，绝对值越大匹配越好
    // 用最佳 rank 做归一化，保证最佳结果 score 接近 1.0
    const bestRank = rows.length > 0 ? Math.abs(rows[0].rank) : 1;
    const results: MemorySearchResult[] = [];

    for (const row of rows) {
      const rawScore = Math.abs(row.rank) / bestRank;

      // 时间衰减
      const age = now - row.created_at;
      const decay = 1 / (1 + age / HALF_LIFE);
      const finalScore = rawScore * decay;

      results.push({
        id: row.id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        score: finalScore,
        snippet: this.extractSnippet(row.text, ftsQuery),
        source: row.source as MemorySource,
        timestamp: new Date(row.created_at).toISOString(),
        age,
      });
    }

    return results;
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
   * List indexed file paths, optionally filtered by source
   */
  listFilePaths(source?: import('./types.js').MemorySource): string[] {
    if (source !== undefined) {
      const stmt = this.db.prepare('SELECT path FROM files WHERE source = ?');
      const rows = stmt.all(source) as { path: string }[];
      return rows.map(r => r.path);
    } else {
      const stmt = this.db.prepare('SELECT path FROM files');
      const rows = stmt.all() as { path: string }[];
      return rows.map(r => r.path);
    }
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
   * 向量搜索（用 sqlite-vec 或降级到内存计算）
   */
  searchVector(queryVec: number[], opts?: SearchOptions): VectorSearchResult[] {
    const maxResults = opts?.maxResults ?? 20;
    const source = opts?.source;

    if (this.hasVecSearch) {
      // 使用 sqlite-vec 原生向量搜索
      let sql = `
        SELECT
          cv.chunk_id,
          cv.distance,
          c.path,
          c.source,
          c.start_line,
          c.end_line,
          c.text,
          c.created_at
        FROM chunks_vec cv
        JOIN chunks c ON cv.chunk_id = c.id
        WHERE cv.embedding MATCH ?
      `;
      const params: any[] = [new Float32Array(queryVec)];

      if (source) {
        sql += ` AND c.source = ?`;
        params.push(source);
      }

      sql += ` ORDER BY cv.distance LIMIT ?`;
      params.push(maxResults);

      const rows = this.db.prepare(sql).all(...params) as Array<{
        chunk_id: string;
        distance: number;
        path: string;
        source: string;
        start_line: number;
        end_line: number;
        text: string;
        created_at: number;
      }>;

      return rows.map(row => ({
        id: row.chunk_id,
        path: row.path,
        source: row.source as MemorySource,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        // cosine distance → similarity: sim = 1 - distance
        score: Math.max(0, 1 - row.distance),
        timestamp: row.created_at,
      }));
    }

    // 降级：从 chunks 表读取存储的 embedding，在内存中计算余弦相似度
    let sql = `
      SELECT id, path, source, start_line, end_line, text, embedding, created_at
      FROM chunks
      WHERE embedding IS NOT NULL
    `;
    const params: any[] = [];
    if (source) {
      sql += ` AND source = ?`;
      params.push(source);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      path: string;
      source: string;
      start_line: number;
      end_line: number;
      text: string;
      embedding: string;
      created_at: number;
    }>;

    const scored: VectorSearchResult[] = [];
    for (const row of rows) {
      try {
        const vec = JSON.parse(row.embedding) as number[];
        const sim = cosineSimilarity(queryVec, vec);
        scored.push({
          id: row.id,
          path: row.path,
          source: row.source as MemorySource,
          startLine: row.start_line,
          endLine: row.end_line,
          text: row.text,
          score: sim,
          timestamp: row.created_at,
        });
      } catch {
        // JSON 解析失败，跳过
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  /**
   * 关键词搜索（BM25 + 时间衰减）— 返回标准化格式供混合搜索使用
   */
  searchKeyword(query: string, opts?: SearchOptions): KeywordSearchResult[] {
    const maxResults = opts?.maxResults ?? 20;
    const source = opts?.source;

    if (!this.hasFTS5) {
      // 无 FTS5 降级到 LIKE
      const results = this.search(query, opts);
      return results.map(r => ({
        id: r.id,
        path: r.path,
        source: r.source,
        startLine: r.startLine,
        endLine: r.endLine,
        text: r.snippet,
        score: r.score,
        timestamp: typeof r.timestamp === 'string' ? new Date(r.timestamp).getTime() : r.timestamp as number,
      }));
    }

    // FTS5 BM25 搜索（不带时间衰减，由混合搜索层统一处理）
    const escaped = query.replace(/["\-*(){}:^~\[\]\\+.]/g, ' ');
    const ftsQuery = tokenizeChinese(escaped);

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
    const params: any[] = [ftsQuery];
    if (source) {
      sql += ` AND c.source = ?`;
      params.push(source);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(maxResults);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      path: string;
      source: string;
      start_line: number;
      end_line: number;
      text: string;
      created_at: number;
      rank: number;
    }>;

    // BM25 rank 归一化到 0-1
    const bestRank = rows.length > 0 ? Math.abs(rows[0].rank) : 1;

    return rows.map(row => ({
      id: row.id,
      path: row.path,
      source: row.source as MemorySource,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      score: Math.abs(row.rank) / bestRank,
      timestamp: row.created_at,
    }));
  }

  /**
   * 获取 chunk 文本（用于 snippet 提取）
   */
  getChunkTexts(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT id, text FROM chunks WHERE id IN (${placeholders})`
    ).all(...ids) as { id: string; text: string }[];
    return new Map(rows.map(r => [r.id, r.text]));
  }

  /**
   * 是否支持向量搜索
   */
  get supportsVectorSearch(): boolean {
    return this.hasVecSearch;
  }

  /**
   * 是否有存储 embedding 的 chunk（判断是否需要重建索引）
   */
  hasEmbeddings(): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM chunks WHERE embedding IS NOT NULL LIMIT 1'
    ).get();
    return row !== undefined;
  }

  /**
   * 获取没有 embedding 的 chunk 数量（用于增量补齐）
   */
  countChunksWithoutEmbedding(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM chunks WHERE embedding IS NULL'
    ).get() as { count: number };
    return row.count;
  }

  /**
   * 批量更新 chunk 的 embedding
   */
  updateEmbeddings(updates: Array<{ id: string; embedding: number[] }>): void {
    const updateStmt = this.db.prepare(
      'UPDATE chunks SET embedding = ? WHERE id = ?'
    );
    const insertVecStmt = this.hasVecSearch
      ? this.db.prepare('INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)')
      : null;

    const transaction = this.db.transaction(() => {
      for (const { id, embedding } of updates) {
        updateStmt.run(JSON.stringify(embedding), id);
        if (insertVecStmt) {
          try {
            insertVecStmt.run(id, new Float32Array(embedding));
          } catch { /* ignore */ }
        }
      }
    });
    transaction();
  }

  /**
   * 获取没有 embedding 的 chunk（用于批量生成）
   */
  getChunksWithoutEmbedding(limit: number = 100): Array<{ id: string; text: string }> {
    return this.db.prepare(
      'SELECT id, text FROM chunks WHERE embedding IS NULL LIMIT ?'
    ).all(limit) as Array<{ id: string; text: string }>;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
