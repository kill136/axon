/**
 * 提示词缓存系统
 * 实现 system_prompt_hash 计算和缓存优化
 */

import { createHash } from 'crypto';
import type { PromptHashInfo } from './types.js';
import { estimateTokens } from '../utils/token-estimate.js';

/**
 * 提示词缓存类
 */
export class PromptCache {
  private cache: Map<string, {
    content: string;
    hashInfo: PromptHashInfo;
    expiresAt: number;
  }> = new Map();

  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000; // 5 分钟
    this.maxEntries = options?.maxEntries ?? 100;
  }

  /**
   * 计算提示词哈希
   */
  computeHash(content: string): PromptHashInfo {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const estimatedTokens = estimateTokens(content);

    return {
      hash,
      computedAt: Date.now(),
      length: content.length,
      estimatedTokens,
    };
  }

  /**
   * 获取缓存的提示词
   */
  get(key: string): { content: string; hashInfo: PromptHashInfo } | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return {
      content: entry.content,
      hashInfo: entry.hashInfo,
    };
  }

  /**
   * 设置缓存
   */
  set(key: string, content: string, hashInfo?: PromptHashInfo): PromptHashInfo {
    // 清理过期条目
    this.cleanup();

    // 检查容量
    if (this.cache.size >= this.maxEntries) {
      // 删除最旧的条目
      const oldest = Array.from(this.cache.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    const computedHashInfo = hashInfo ?? this.computeHash(content);

    this.cache.set(key, {
      content,
      hashInfo: computedHashInfo,
      expiresAt: Date.now() + this.ttlMs,
    });

    return computedHashInfo;
  }

  /**
   * 检查缓存是否有效
   */
  isValid(key: string, hash: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return entry.hashInfo.hash === hash;
  }

  /**
   * 清理过期条目
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    totalBytes: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    let totalBytes = 0;
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;

    for (const entry of this.cache.values()) {
      totalBytes += entry.content.length;
      const computedAt = entry.hashInfo.computedAt;

      if (oldestEntry === null || computedAt < oldestEntry) {
        oldestEntry = computedAt;
      }
      if (newestEntry === null || computedAt > newestEntry) {
        newestEntry = computedAt;
      }
    }

    return {
      size: this.cache.size,
      totalBytes,
      oldestEntry,
      newestEntry,
    };
  }
}

/**
 * 全局缓存实例
 */
export const promptCache = new PromptCache();

function normalizeForCache(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Set) {
    return Array.from(value.values())
      .map(item => normalizeForCache(item))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (value instanceof Map) {
    return Array.from(value.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, mapValue]) => [key, normalizeForCache(mapValue)]);
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeForCache(item));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, normalizeForCache(entryValue)]);

    return Object.fromEntries(entries);
  }

  return String(value);
}

/**
 * 生成缓存键
 */
export function generateCacheKey(context: object): string {
  const normalized = normalizeForCache(context);
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 24);
}
