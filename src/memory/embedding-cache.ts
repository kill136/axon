/**
 * Embedding 缓存
 * 使用 SQLite 表存储已计算的 embedding，避免重复调用 API
 */

import { embeddingCacheKey } from './embedding-provider.js';

/**
 * Embedding 缓存管理器
 */
export class EmbeddingCache {
  private db: import('better-sqlite3').Database;

  private constructor(db: import('better-sqlite3').Database) {
    this.db = db;
    this.initSchema();
  }

  static async create(dbPath: string): Promise<EmbeddingCache> {
    const mod = await import('better-sqlite3');
    const { default: Database } = mod;
    const db = new Database(dbPath);
    return new EmbeddingCache(db);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * 查询缓存
   */
  get(model: string, text: string): number[] | null {
    const hash = embeddingCacheKey(model, text);
    const stmt = this.db.prepare('SELECT embedding FROM embedding_cache WHERE hash = ?');
    const row = stmt.get(hash) as { embedding: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.embedding);
    } catch {
      return null;
    }
  }

  /**
   * 批量查询缓存
   * 返回与 texts 等长的数组，未命中为 null
   */
  getBatch(model: string, texts: string[]): (number[] | null)[] {
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const stmt = this.db.prepare('SELECT embedding FROM embedding_cache WHERE hash = ?');

    for (let i = 0; i < texts.length; i++) {
      const hash = embeddingCacheKey(model, texts[i]);
      const row = stmt.get(hash) as { embedding: string } | undefined;
      if (row) {
        try {
          results[i] = JSON.parse(row.embedding);
        } catch {
          // 忽略损坏的缓存
        }
      }
    }

    return results;
  }

  /**
   * 写入缓存
   */
  set(model: string, text: string, embedding: number[]): void {
    const hash = embeddingCacheKey(model, text);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (hash, model, embedding, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(hash, model, JSON.stringify(embedding), Date.now());
  }

  /**
   * 批量写入缓存
   */
  setBatch(model: string, entries: Array<{ text: string; embedding: number[] }>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (hash, model, embedding, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const now = Date.now();

    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        const hash = embeddingCacheKey(model, entry.text);
        stmt.run(hash, model, JSON.stringify(entry.embedding), now);
      }
    });

    transaction();
  }

  /**
   * 获取缓存统计
   */
  getStats(): { entries: number } {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache');
    const row = stmt.get() as { count: number };
    return { entries: row.count };
  }
}
