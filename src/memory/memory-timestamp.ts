/**
 * Memory Timestamp 管理器
 * 实现 AXON v2.1.85 中的记忆时间戳功能
 *
 * 字段说明：
 * - createdAt: 记忆创建时间
 * - updatedAt: 记忆最后修改时间
 * - accessedAt: 记忆最后访问时间（自动更新）
 *
 * 自动排序：
 * - 按 accessedAt 降序排列（最近访问优先）
 * - 用于 LRU 淘汰策略
 */

/**
 * 扩展的记忆项（带时间戳）
 */
export interface TimestampedMemory {
  id: string;
  content: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  accessedAt?: Date;
  [key: string]: any;
}

/**
 * 时间戳统计
 */
export interface TimestampStats {
  oldestAccess: Date | null;
  newestAccess: Date | null;
  averageAccessAge: number; // 毫秒
  accessFrequency: number; // 每天
  staleThreshold: number; // 毫秒
}

/**
 * Memory Timestamp 管理器
 */
export class MemoryTimestampManager {
  private memories: Map<string, TimestampedMemory> = new Map();
  private staleThreshold: number = 90 * 24 * 60 * 60 * 1000; // 90 天
  private stats: TimestampStats = {
    oldestAccess: null,
    newestAccess: null,
    averageAccessAge: 0,
    accessFrequency: 0,
    staleThreshold: this.staleThreshold,
  };

  constructor(staleThreshold?: number) {
    if (staleThreshold !== undefined) {
      this.staleThreshold = staleThreshold;
      this.stats.staleThreshold = staleThreshold;
    }
  }

  /**
   * 添加记忆
   */
  addMemory(memory: TimestampedMemory): void {
    const now = new Date();
    const normalized: TimestampedMemory = {
      ...memory,
      createdAt: memory.createdAt || now,
      updatedAt: memory.updatedAt || now,
      accessedAt: memory.accessedAt || now,
    };
    this.memories.set(memory.id, normalized);
    this.updateStats();
  }

  /**
   * 访问记忆（自动更新 accessedAt）
   */
  accessMemory(memoryId: string): TimestampedMemory | null {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      return null;
    }

    // 更新 accessedAt
    memory.accessedAt = new Date();
    this.updateStats();

    return memory;
  }

  /**
   * 更新记忆
   */
  updateMemory(memoryId: string, updates: Partial<TimestampedMemory>): TimestampedMemory | null {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      return null;
    }

    const updated: TimestampedMemory = {
      ...memory,
      ...updates,
      updatedAt: new Date(),
      accessedAt: memory.accessedAt || new Date(),
    };

    this.memories.set(memoryId, updated);
    this.updateStats();

    return updated;
  }

  /**
   * 获取记忆
   */
  getMemory(memoryId: string): TimestampedMemory | null {
    return this.memories.get(memoryId) || null;
  }

  /**
   * 删除记忆
   */
  deleteMemory(memoryId: string): boolean {
    const deleted = this.memories.delete(memoryId);
    if (deleted) {
      this.updateStats();
    }
    return deleted;
  }

  /**
   * 按 accessedAt 排序获取所有记忆
   */
  getAllMemoriesSortedByAccess(descending: boolean = true): TimestampedMemory[] {
    const sorted = Array.from(this.memories.values()).sort((a, b) => {
      const aTime = a.accessedAt?.getTime() || 0;
      const bTime = b.accessedAt?.getTime() || 0;
      return descending ? bTime - aTime : aTime - bTime;
    });
    return sorted;
  }

  /**
   * 获取陈旧的记忆（超过阈值）
   */
  getStaleMemories(): TimestampedMemory[] {
    const now = Date.now();
    return Array.from(this.memories.values()).filter((mem) => {
      const accessTime = mem.accessedAt?.getTime() || mem.createdAt.getTime();
      return now - accessTime > this.staleThreshold;
    });
  }

  /**
   * 清理陈旧记忆
   */
  removeStaleMemories(): number {
    const stale = this.getStaleMemories();
    let removed = 0;

    for (const memory of stale) {
      if (this.memories.delete(memory.id)) {
        removed++;
      }
    }

    if (removed > 0) {
      this.updateStats();
    }

    return removed;
  }

  /**
   * 获取时间戳统计
   */
  getStats(): TimestampStats {
    return { ...this.stats };
  }

  /**
   * 更新统计信息
   */
  private updateStats(): void {
    if (this.memories.size === 0) {
      this.stats.oldestAccess = null;
      this.stats.newestAccess = null;
      this.stats.averageAccessAge = 0;
      this.stats.accessFrequency = 0;
      return;
    }

    const memories = Array.from(this.memories.values());
    const now = Date.now();
    let totalAge = 0;

    for (const memory of memories) {
      const accessTime = memory.accessedAt?.getTime() || memory.createdAt.getTime();
      totalAge += now - accessTime;
    }

    // 计算最旧和最新的访问时间
    const accessTimes = memories
      .map((m) => m.accessedAt?.getTime() || m.createdAt.getTime())
      .sort((a, b) => a - b);

    this.stats.oldestAccess = accessTimes.length > 0 ? new Date(accessTimes[0]) : null;
    this.stats.newestAccess = accessTimes.length > 0 ? new Date(accessTimes[accessTimes.length - 1]) : null;
    this.stats.averageAccessAge = Math.round(totalAge / memories.length);

    // 计算访问频率（每天）
    const oldestTime = this.stats.oldestAccess?.getTime() || now;
    const daySpan = Math.max(1, (now - oldestTime) / (24 * 60 * 60 * 1000));
    this.stats.accessFrequency = memories.length / daySpan;
  }

  /**
   * 清空所有记忆
   */
  clear(): void {
    this.memories.clear();
    this.stats = {
      oldestAccess: null,
      newestAccess: null,
      averageAccessAge: 0,
      accessFrequency: 0,
      staleThreshold: this.staleThreshold,
    };
  }

  /**
   * 获取记忆总数
   */
  size(): number {
    return this.memories.size;
  }

  /**
   * 导出所有记忆（用于持久化）
   */
  export(): TimestampedMemory[] {
    return Array.from(this.memories.values());
  }

  /**
   * 从数据导入记忆
   */
  import(memories: TimestampedMemory[]): void {
    this.memories.clear();
    for (const memory of memories) {
      this.addMemory(memory);
    }
  }
}
