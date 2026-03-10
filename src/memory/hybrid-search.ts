/**
 * 混合搜索：向量搜索 + 关键词搜索结果的加权合并
 * 移植自 moltbot/src/memory/hybrid.ts，简化版
 */

import { applyMMRToResults, type MMRConfig } from './mmr.js';

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  text: string;
  score: number; // cosine similarity, 0-1
  timestamp: number;
}

/**
 * 关键词搜索结果
 */
export interface KeywordSearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  text: string;
  score: number; // BM25 normalized, 0-1
  timestamp: number;
}

/**
 * 合并后的搜索结果
 */
export interface HybridResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  text: string;
  score: number;
  timestamp: number;
}

/**
 * 合并向量搜索和关键词搜索结果
 *
 * @param vectorWeight 向量搜索权重，默认 0.6
 * @param textWeight 关键词搜索权重，默认 0.4
 */
export function mergeHybridResults(params: {
  vector: VectorSearchResult[];
  keyword: KeywordSearchResult[];
  vectorWeight?: number;
  textWeight?: number;
  mmr?: Partial<MMRConfig>;
}): HybridResult[] {
  const vectorWeight = params.vectorWeight ?? 0.6;
  const textWeight = params.textWeight ?? 0.4;

  // 按 ID 合并去重
  const byId = new Map<string, {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    source: string;
    text: string;
    vectorScore: number;
    textScore: number;
    timestamp: number;
  }>();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      text: r.text,
      vectorScore: r.score,
      textScore: 0,
      timestamp: r.timestamp,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.score;
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        text: r.text,
        vectorScore: 0,
        textScore: r.score,
        timestamp: r.timestamp,
      });
    }
  }

  // 加权合并评分
  const merged: HybridResult[] = Array.from(byId.values()).map(entry => ({
    id: entry.id,
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    source: entry.source,
    text: entry.text,
    score: vectorWeight * entry.vectorScore + textWeight * entry.textScore,
    timestamp: entry.timestamp,
  }));

  // 排序
  merged.sort((a, b) => b.score - a.score);

  // 可选 MMR 重排
  if (params.mmr?.enabled) {
    return applyMMRToResults(merged, params.mmr);
  }

  return merged;
}
