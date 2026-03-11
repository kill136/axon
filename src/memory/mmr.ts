/**
 * Maximal Marginal Relevance (MMR) 多样性重排算法
 *
 * MMR 平衡相关性与多样性，迭代选择最大化目标函数的结果：
 *   MMR = λ * relevance - (1-λ) * max_similarity_to_selected
 *
 * 参考: Carbonell & Goldstein (1998)
 * 移植自 moltbot/src/memory/mmr.ts，简化版
 */

export interface MMRItem {
  id: string;
  score: number;
  content: string;
}

export interface MMRConfig {
  enabled: boolean;
  /** Lambda: 0=最大多样性, 1=最大相关性。默认 0.7 */
  lambda: number;
}

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: false,
  lambda: 0.7,
};

/**
 * 分词（用于 Jaccard 相似度计算）
 */
function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? [];
  return new Set(tokens);
}

/**
 * Jaccard 相似度
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * MMR 重排
 */
export function mmrRerank<T extends MMRItem>(items: T[], config: Partial<MMRConfig> = {}): T[] {
  const lambda = Math.max(0, Math.min(1, config.lambda ?? DEFAULT_MMR_CONFIG.lambda));

  if (!config.enabled || items.length <= 1) return [...items];
  if (lambda === 1) return [...items].sort((a, b) => b.score - a.score);

  // 预计算 token 集合
  const tokenCache = new Map<string, Set<string>>();
  for (const item of items) {
    tokenCache.set(item.id, tokenize(item.content));
  }

  // 归一化分数到 [0, 1]
  const maxScore = Math.max(...items.map(i => i.score));
  const minScore = Math.min(...items.map(i => i.score));
  const range = maxScore - minScore;
  const normalize = (s: number) => range === 0 ? 1 : (s - minScore) / range;

  const selected: T[] = [];
  const remaining = new Set(items);

  while (remaining.size > 0) {
    let best: T | null = null;
    let bestMMR = -Infinity;

    for (const candidate of remaining) {
      const relevance = normalize(candidate.score);

      // 计算与已选择项的最大相似度
      let maxSim = 0;
      const candidateTokens = tokenCache.get(candidate.id)!;
      for (const sel of selected) {
        const sim = jaccardSimilarity(candidateTokens, tokenCache.get(sel.id)!);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMMR || (mmrScore === bestMMR && candidate.score > (best?.score ?? -Infinity))) {
        bestMMR = mmrScore;
        best = candidate;
      }
    }

    if (!best) break;
    selected.push(best);
    remaining.delete(best);
  }

  return selected;
}

/**
 * 将混合搜索结果适配为 MMR 格式并重排
 */
export function applyMMRToResults<T extends { score: number; text: string; path: string; startLine: number }>(
  results: T[],
  config: Partial<MMRConfig> = {},
): T[] {
  if (results.length === 0 || !config.enabled) return results;

  const itemMap = new Map<string, T>();
  const mmrItems: MMRItem[] = results.map((r, i) => {
    const id = `${r.path}:${r.startLine}:${i}`;
    itemMap.set(id, r);
    return { id, score: r.score, content: r.text };
  });

  const reranked = mmrRerank(mmrItems, config);
  return reranked.map(item => itemMap.get(item.id)!);
}
