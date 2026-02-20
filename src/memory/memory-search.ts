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
}

/**
 * 获取 Claude 配置目录
 */
function getClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
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

  private constructor(opts: { projectDir: string; projectHash: string }) {
    this.projectDir = opts.projectDir;
    this.projectHash = opts.projectHash;
  }

  static async create(opts: { projectDir: string; projectHash: string }): Promise<MemorySearchManager> {
    const manager = new MemorySearchManager(opts);
    const claudeDir = getClaudeDir();
    const dbPath = path.join(claudeDir, 'memory', 'projects', manager.projectHash, 'ltm.sqlite');
    manager.store = await LongTermStore.create(dbPath);
    manager.syncEngine = new MemorySyncEngine(manager.store, { projectDir: manager.projectDir });
    return manager;
  }

  /**
   * 搜索记忆
   */
  search(query: string, opts?: MemorySearchOptions): MemorySearchResult[] {
    // 如果 dirty，先同步
    if (this.dirty) {
      this.syncSync();
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

    if (process.env.CLAUDE_DEBUG) {
      console.log(`[MemorySearch] Synced (${reason || 'manual'}):`, result);
    }

    this.dirty = false;
  }

  /**
   * 同步记忆文件（同步）
   */
  private syncSync(): void {
    // 使用 Promise 立即执行（不阻塞）
    this.sync('auto').catch(err => {
      console.warn('[MemorySearch] Sync failed:', err);
    });
    // 标记为非 dirty，避免重复同步
    this.dirty = false;
  }

  /**
   * 标记为需要同步
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * 获取状态
   */
  status(): MemoryStoreStatus {
    const stats = this.store.getStats();
    return {
      ...stats,
      dirty: this.dirty,
    };
  }

  /**
   * 关闭
   */
  close(): void {
    this.store.close();
  }
}

// ============================================================================
// 单例管理
// ============================================================================

let managerInstance: MemorySearchManager | null = null;

/**
 * 初始化 MemorySearchManager
 */
export async function initMemorySearchManager(
  projectDir: string,
  projectHash: string
): Promise<MemorySearchManager> {
  managerInstance = await MemorySearchManager.create({ projectDir, projectHash });
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
