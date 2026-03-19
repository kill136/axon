/**
 * 统一记忆搜索接口
 * 协调 LongTermStore 和 MemorySyncEngine
 */

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LongTermStore } from './long-term-store.js';
import { MemorySyncEngine } from './memory-sync.js';
import type { MemorySource, MemorySearchResult } from './types.js';
import { createOpenAIEmbeddingProvider, type EmbeddingProvider } from './embedding-provider.js';
import { EmbeddingCache } from './embedding-cache.js';
import { mergeHybridResults } from './hybrid-search.js';
import { applyMMRToResults, type MMRConfig } from './mmr.js';

/**
 * 搜索选项
 */
export interface MemorySearchOptions {
  source?: MemorySource | 'all';
  maxResults?: number;
}

/**
 * 记忆存储状态
 */
export interface MemoryStoreStatus {
  totalFiles: number;
  totalChunks: number;
  dbSizeBytes: number;
  dirty: boolean;
  hasEmbeddings?: boolean;
  chunksWithoutEmbedding?: number;
}

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  provider: 'openai';
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  hybrid?: {
    enabled: boolean;
    vectorWeight?: number;
    textWeight?: number;
  };
  mmr?: {
    enabled: boolean;
    lambda?: number;
  };
}

/**
 * Axon 内置 embedding 服务（Railway 部署的 EmbeddingGemma）
 * 所有 Axon 用户免费使用，无需配置
 */
const AXON_BUILTIN_EMBEDDING: EmbeddingConfig = {
  provider: 'openai',
  apiKey: 'axon-emb-20f9e10397ef4feca670eff179a219a2',
  baseUrl: 'https://auth-proxy-production-cee3.up.railway.app/v1',
  model: 'embeddinggemma:300m',
  dimensions: 768,
};

/**
 * 获取 Claude 配置目录
 */
function getClaudeDir(): string {
  return process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon');
}

/**
 * 将项目路径转为安全的哈希
 */
function hashProjectPath(projectPath: string): string {
  return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
}

/**
 * 将项目路径转为安全的目录名
 */
function sanitizeProjectPath(projectPath: string): string {
  const hash = hashProjectPath(projectPath);
  const projectName = path.basename(projectPath)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `${projectName}-${hash}`;
}

/**
 * 记忆搜索管理器
 */
export class MemorySearchManager {
  private projectDir: string;
  private projectHash: string;
  private store!: LongTermStore;
  private syncEngine!: MemorySyncEngine;
  private dirty: boolean = true;
  private syncPromise: Promise<void> | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private embeddingCache: EmbeddingCache | null = null;
  private embeddingConfig: EmbeddingConfig | null = null;

  private constructor(opts: { projectDir: string; projectHash: string }) {
    this.projectDir = opts.projectDir;
    this.projectHash = opts.projectHash;
  }

  static async create(opts: {
    projectDir: string;
    projectHash: string;
    embeddingConfig?: EmbeddingConfig;
  }): Promise<MemorySearchManager> {
    const manager = new MemorySearchManager(opts);
    const claudeDir = getClaudeDir();
    const memoryProjectDir = path.join(claudeDir, 'memory', 'projects', manager.projectHash);
    const dbPath = path.join(memoryProjectDir, 'ltm.sqlite');
    const dimensions = opts.embeddingConfig?.dimensions ?? 1536;
    manager.store = await LongTermStore.create(dbPath, dimensions);
    manager.syncEngine = new MemorySyncEngine(manager.store, { projectDir: manager.projectDir });

    // 初始化 embedding（如果配置了）
    if (opts.embeddingConfig?.apiKey) {
      manager.embeddingConfig = opts.embeddingConfig;
      try {
        manager.embeddingProvider = createOpenAIEmbeddingProvider({
          apiKey: opts.embeddingConfig.apiKey,
          baseUrl: opts.embeddingConfig.baseUrl,
          model: opts.embeddingConfig.model,
        });

        const cachePath = path.join(memoryProjectDir, 'embedding-cache.sqlite');
        manager.embeddingCache = await EmbeddingCache.create(cachePath);
      } catch (e) {
        console.warn('[MemorySearch] Failed to init embedding provider:', e);
      }
    }

    return manager;
  }

  /**
   * 搜索记忆
   */
  search(query: string, opts?: MemorySearchOptions): MemorySearchResult[] {
    // 如果 dirty，触发后台同步（不阻塞，首次搜索可能在旧数据上执行）
    // 对于需要保证数据新鲜度的场景，请使用 hybridSearch() 或 recall()
    if (this.dirty) {
      this.triggerSync();
    }

    // 调用 store.search
    const source = opts?.source === 'all' ? undefined : opts?.source;
    return this.store.search(query, {
      source,
      maxResults: opts?.maxResults,
    });
  }

  /**
   * 同步记忆文件（异步）
   */
  async sync(reason?: string): Promise<void> {
    const claudeDir = getClaudeDir();
    const memoryDir = path.join(claudeDir, 'memory', 'projects', this.projectHash);
    const sessionsDir = path.join(claudeDir, 'projects', sanitizeProjectPath(this.projectDir));
    const transcriptsDir = path.join(claudeDir, 'sessions');

    const result = await this.syncEngine.syncAll({
      memoryDir,
      sessionsDir,
      transcriptsDir,
    });

    if (process.env.AXON_DEBUG) {
      console.log(`[MemorySearch] Synced (${reason || 'manual'}):`, result);
    }

    // 异步补齐 embedding（不阻塞主流程）
    if (this.embeddingProvider) {
      this.syncEngine.backfillEmbeddings(
        this.embeddingProvider,
        this.embeddingCache,
      ).then(count => {
        if (count > 0 && process.env.AXON_DEBUG) {
          console.log(`[MemorySearch] Backfilled ${count} embeddings`);
        }
      }).catch(e => {
        if (process.env.AXON_DEBUG) {
          console.warn('[MemorySearch] Embedding backfill failed:', e);
        }
      });
    }

    this.dirty = false;
  }

  /**
   * 触发异步同步（不阻塞调用方，但会跟踪 Promise 状态）
   * search() 使用此方法：首次搜索触发后台同步，不阻塞返回结果。
   * 后续 hybridSearch() / recall() 的 await sync() 会等待同一个 Promise。
   */
  private triggerSync(): void {
    if (!this.syncPromise) {
      this.syncPromise = this.sync('auto').catch(err => {
        console.warn('[MemorySearch] Sync failed:', err);
      }).finally(() => {
        this.syncPromise = null;
      });
    }
    this.dirty = false;
  }

  /**
   * 标记为需要同步
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * 自动回忆（autoRecall）
   * 根据查询从长期记忆中检索相关片段，格式化为可注入 system prompt 的文本
   * 使用混合搜索（向量 + FTS5），无 embedding 时自动降级到纯 FTS5
   * @param query 查询文本（通常是用户的最新消息）
   * @param maxResults 最大结果数（默认 5，避免占用太多 prompt 空间）
   */
  async recall(query: string, maxResults: number = 5): Promise<string | null> {
    if (!query || query.trim().length < 3) return null;

    const results = await this.hybridSearch(query, { maxResults });
    if (results.length === 0) return null;

    // 过滤低分结果（混合搜索 + 时间衰减后 score < 0.1 的没有参考价值）
    const relevant = results.filter(r => r.score > 0.1);
    if (relevant.length === 0) return null;

    // 格式化为简洁的回忆片段
    const snippets = relevant.map((r, i) => {
      const ageStr = this.formatAge(r.age);
      return `[${i + 1}] (${r.source}, ${ageStr} ago)\n${r.snippet}`;
    });

    return snippets.join('\n\n');
  }

  /**
   * 格式化时间差
   */
  private formatAge(ms: number): string {
    const hours = ms / 3600000;
    if (hours < 1) return `${Math.round(ms / 60000)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 30) return `${Math.round(days)}d`;
    return `${Math.round(days / 30)}mo`;
  }

  /**
   * 混合搜索（向量 + 关键词），如果 embedding 不可用则降级到纯关键词
   */
  async hybridSearch(query: string, opts?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    if (this.dirty) {
      this.triggerSync();
    }
    // Wait for any in-flight sync to complete before searching
    if (this.syncPromise) {
      await this.syncPromise;
    }

    const source = (opts?.source === 'all' ? undefined : opts?.source) as MemorySource | undefined;
    const maxResults = opts?.maxResults ?? 8;
    const HALF_LIFE = 30 * 24 * 60 * 60 * 1000;

    if (!this.embeddingProvider) {
      // 无 embedding，降级到纯关键词搜索
      return this.store.search(query, { source, maxResults });
    }

    try {
      // 生成查询向量
      let queryVec: number[];
      const cacheModel = this.embeddingConfig?.model ?? 'text-embedding-3-small';
      if (this.embeddingCache) {
        const cached = this.embeddingCache.get(cacheModel, query);
        if (cached) {
          queryVec = cached;
        } else {
          queryVec = await this.embeddingProvider.embedQuery(query);
          this.embeddingCache.set(cacheModel, query, queryVec);
        }
      } else {
        queryVec = await this.embeddingProvider.embedQuery(query);
      }

      // 并行执行向量搜索和关键词搜索
      const vectorResults = this.store.searchVector(queryVec, { source, maxResults: maxResults * 3 });
      const keywordResults = this.store.searchKeyword(query, { source, maxResults: maxResults * 3 });

      // 混合合并
      const hybridConfig = this.embeddingConfig?.hybrid;
      const mmrConfig = this.embeddingConfig?.mmr;

      const merged = mergeHybridResults({
        vector: vectorResults,
        keyword: keywordResults,
        vectorWeight: hybridConfig?.vectorWeight ?? 0.6,
        textWeight: hybridConfig?.textWeight ?? 0.4,
        mmr: mmrConfig ? { enabled: mmrConfig.enabled, lambda: mmrConfig.lambda ?? 0.7 } : undefined,
      });

      // 应用时间衰减并转为 MemorySearchResult 格式
      const now = Date.now();
      const chunkTexts = this.store.getChunkTexts(merged.map(r => r.id));

      return merged.slice(0, maxResults).map(r => {
        const age = now - r.timestamp;
        const decay = 1 / (1 + age / HALF_LIFE);
        const text = chunkTexts.get(r.id) ?? r.text;
        return {
          id: r.id,
          path: r.path,
          startLine: r.startLine,
          endLine: r.endLine,
          score: r.score * decay,
          snippet: text.length > 200 ? text.substring(0, 200) + '...' : text,
          source: r.source as MemorySource,
          timestamp: new Date(r.timestamp).toISOString(),
          age,
        };
      });
    } catch (e) {
      // embedding 失败，降级到纯关键词搜索
      if (process.env.AXON_DEBUG) {
        console.warn('[MemorySearch] Hybrid search failed, fallback to keyword:', e);
      }
      return this.store.search(query, { source, maxResults });
    }
  }

  /**
   * 获取 embedding provider（供外部使用，如 sync 时批量生成 embedding）
   */
  getEmbeddingProvider(): EmbeddingProvider | null {
    return this.embeddingProvider;
  }

  /**
   * 获取 embedding 缓存（供外部使用）
   */
  getEmbeddingCache(): EmbeddingCache | null {
    return this.embeddingCache;
  }

  /**
   * 获取 store（供 sync 使用）
   */
  getStore(): LongTermStore {
    return this.store;
  }

  /**
   * 获取状态
   */
  status(): MemoryStoreStatus {
    const stats = this.store.getStats();
    return {
      ...stats,
      dirty: this.dirty,
      hasEmbeddings: this.store.hasEmbeddings(),
      chunksWithoutEmbedding: this.store.countChunksWithoutEmbedding(),
    };
  }

  /**
   * 关闭
   */
  close(): void {
    this.store.close();
    // 不关闭 embeddingCache — 它自己管理生命周期
  }
}

// ============================================================================
// 单例管理
// ============================================================================

let managerInstance: MemorySearchManager | null = null;

/**
 * 解析 embedding 配置：用户配置 > 内置默认
 * 可通过环境变量 AXON_DISABLE_BUILTIN_EMBEDDING=1 禁用内置服务
 */
export function resolveEmbeddingConfig(userConfig?: EmbeddingConfig): EmbeddingConfig {
  if (userConfig?.apiKey) {
    return userConfig;
  }
  if (process.env.AXON_DISABLE_BUILTIN_EMBEDDING === '1') {
    return userConfig as any; // undefined, 降级到纯 FTS5
  }
  return AXON_BUILTIN_EMBEDDING;
}

/**
 * 初始化 MemorySearchManager
 */
export async function initMemorySearchManager(
  projectDir: string,
  projectHash: string,
  embeddingConfig?: EmbeddingConfig,
): Promise<MemorySearchManager> {
  // Close previous instance to avoid SQLite connection leak
  if (managerInstance) {
    try { managerInstance.close(); } catch { /* ignore */ }
  }
  const resolved = resolveEmbeddingConfig(embeddingConfig);
  managerInstance = await MemorySearchManager.create({ projectDir, projectHash, embeddingConfig: resolved });
  return managerInstance;
}

/**
 * 获取 MemorySearchManager 实例
 */
export function getMemorySearchManager(): MemorySearchManager | null {
  return managerInstance;
}

/**
 * 重置 MemorySearchManager 实例
 */
export function resetMemorySearchManager(): void {
  if (managerInstance) {
    managerInstance.close();
    managerInstance = null;
  }
}
