/**
 * Memory 系统
 * 持久化存储用户偏好和项目上下文
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MemoryEntry {
  key: string;
  value: string;
  scope: 'global' | 'project';
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  version: string;
}

const MEMORY_VERSION = '1.0.0';

/**
 * 获取全局 memory 目录
 */
function getGlobalMemoryDir(): string {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'memory');
}

/**
 * 获取项目 memory 目录
 */
function getProjectMemoryDir(projectDir?: string): string {
  const dir = projectDir || process.cwd();
  return path.join(dir, '.claude', 'memory');
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
 * 加载 memory store
 */
function loadStore(filePath: string): MemoryStore {
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { entries: {}, version: MEMORY_VERSION };
    }
  }
  return { entries: {}, version: MEMORY_VERSION };
}

/**
 * 保存 memory store
 */
function saveStore(filePath: string, store: MemoryStore): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

/**
 * Memory 管理器
 */
export class MemoryManager {
  private globalStorePath: string;
  private projectStorePath: string;
  private globalStore: MemoryStore;
  private projectStore: MemoryStore;

  constructor(projectDir?: string) {
    this.globalStorePath = path.join(getGlobalMemoryDir(), 'memory.json');
    this.projectStorePath = path.join(getProjectMemoryDir(projectDir), 'memory.json');
    this.globalStore = loadStore(this.globalStorePath);
    this.projectStore = loadStore(this.projectStorePath);
  }

  /**
   * 设置 memory 值
   */
  set(key: string, value: string, scope: 'global' | 'project' = 'project'): void {
    const store = scope === 'global' ? this.globalStore : this.projectStore;
    const storePath = scope === 'global' ? this.globalStorePath : this.projectStorePath;

    const now = new Date();
    const existing = store.entries[key];

    store.entries[key] = {
      key,
      value,
      scope,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    saveStore(storePath, store);
  }

  /**
   * 获取 memory 值
   */
  get(key: string, scope?: 'global' | 'project'): string | undefined {
    if (scope === 'global') {
      return this.globalStore.entries[key]?.value;
    }
    if (scope === 'project') {
      return this.projectStore.entries[key]?.value;
    }
    // 默认：先查项目，再查全局
    return this.projectStore.entries[key]?.value ?? this.globalStore.entries[key]?.value;
  }

  /**
   * 删除 memory 值
   */
  delete(key: string, scope: 'global' | 'project' = 'project'): boolean {
    const store = scope === 'global' ? this.globalStore : this.projectStore;
    const storePath = scope === 'global' ? this.globalStorePath : this.projectStorePath;

    if (store.entries[key]) {
      delete store.entries[key];
      saveStore(storePath, store);
      return true;
    }
    return false;
  }

  /**
   * 列出所有 memory 条目
   */
  list(scope?: 'global' | 'project'): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    if (scope !== 'project') {
      entries.push(...Object.values(this.globalStore.entries));
    }
    if (scope !== 'global') {
      entries.push(...Object.values(this.projectStore.entries));
    }

    return entries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * 清空 memory
   */
  clear(scope: 'global' | 'project' = 'project'): void {
    const store = scope === 'global' ? this.globalStore : this.projectStore;
    const storePath = scope === 'global' ? this.globalStorePath : this.projectStorePath;

    store.entries = {};
    saveStore(storePath, store);
  }

  /**
   * 获取 memory 摘要（用于 system prompt）
   */
  getSummary(): string {
    const entries = this.list();
    if (entries.length === 0) return '';

    const lines = entries.slice(0, 20).map(e => `- ${e.key}: ${e.value}`);
    return `User Memory:\n${lines.join('\n')}`;
  }

  /**
   * 搜索 memory
   */
  search(query: string): MemoryEntry[] {
    const entries = this.list();
    const lowerQuery = query.toLowerCase();
    return entries.filter(e =>
      e.key.toLowerCase().includes(lowerQuery) ||
      e.value.toLowerCase().includes(lowerQuery)
    );
  }
}

// 默认实例
let defaultMemoryManager: MemoryManager | null = null;

export function getMemoryManager(projectDir?: string): MemoryManager {
  if (!defaultMemoryManager) {
    defaultMemoryManager = new MemoryManager(projectDir);
  }
  return defaultMemoryManager;
}

export function resetMemoryManager(): void {
  defaultMemoryManager = null;
}

// v2.1.32: Agent Memory (MEMORY.md 系统)
export * from './agent-memory.js';
