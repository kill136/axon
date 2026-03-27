/**
 * Auto-memory 打分系统
 * 实现 AXON v2.1.85 中的自动记忆管理功能
 *
 * 打分逻辑：
 * Score = (类型权重 * 相关度 * 新鲜度因子)
 *
 * 权重配置：
 * - code: 0.9
 * - design: 0.85
 * - bugs: 0.8
 * - docs: 0.7
 *
 * 新鲜度衰减策略：
 * - HIGH (3天内): 95%
 * - MEDIUM (3-14天): 60%
 * - LOW (14-90天): 20%
 * - STALE (>90天): 5%
 *
 * 阈值过滤: Score ≥ 0.5 才保存
 */

/**
 * 记忆类型
 */
export type MemoryType = 'code' | 'design' | 'bugs' | 'docs' | 'general';

/**
 * 新鲜度等级
 */
export type FreshnessLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'STALE';

/**
 * 记忆项配置
 */
export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  relevance: number; // 0-1，相关度评分
  createdAt: Date;
  updatedAt: Date;
  accessedAt?: Date;
  tags?: string[];
  source?: string; // 来源标识
}

/**
 * 打分结果
 */
export interface ScoringResult {
  memoryId: string;
  score: number; // 最终分数
  typeWeight: number;
  freshnessLevel: FreshnessLevel;
  freshnessFactor: number;
  shouldSave: boolean; // score >= 0.5
}

/**
 * 打分统计
 */
export interface ScoringStats {
  totalMemories: number;
  savedMemories: number;
  discardedMemories: number;
  averageScore: number;
  distribution: Record<MemoryType, number>;
}

/**
 * 类型权重配置
 */
const TYPE_WEIGHTS: Record<MemoryType, number> = {
  code: 0.9,
  design: 0.85,
  bugs: 0.8,
  docs: 0.7,
  general: 0.5,
};

/**
 * 新鲜度衰减因子配置
 */
const FRESHNESS_FACTORS: Record<FreshnessLevel, number> = {
  HIGH: 0.95,
  MEDIUM: 0.6,
  LOW: 0.2,
  STALE: 0.05,
};

/**
 * 新鲜度时间边界（毫秒）
 */
const FRESHNESS_BOUNDARIES = {
  HIGH: 3 * 24 * 60 * 60 * 1000, // 3 天
  MEDIUM: 14 * 24 * 60 * 60 * 1000, // 14 天
  LOW: 90 * 24 * 60 * 60 * 1000, // 90 天
};

/**
 * 计算新鲜度等级
 */
function calculateFreshnessLevel(updatedAt: Date): FreshnessLevel {
  const now = Date.now();
  const age = now - updatedAt.getTime();

  if (age <= FRESHNESS_BOUNDARIES.HIGH) {
    return 'HIGH';
  } else if (age <= FRESHNESS_BOUNDARIES.MEDIUM) {
    return 'MEDIUM';
  } else if (age <= FRESHNESS_BOUNDARIES.LOW) {
    return 'LOW';
  } else {
    return 'STALE';
  }
}

/**
 * Auto-memory 打分引擎
 */
export class AutoMemoryScorer {
  private threshold: number = 0.5;
  private stats: ScoringStats = {
    totalMemories: 0,
    savedMemories: 0,
    discardedMemories: 0,
    averageScore: 0,
    distribution: {
      code: 0,
      design: 0,
      bugs: 0,
      docs: 0,
      general: 0,
    },
  };

  constructor(threshold: number = 0.5) {
    this.threshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 对单个记忆项进行打分
   */
  score(memory: MemoryItem): ScoringResult {
    const typeWeight = TYPE_WEIGHTS[memory.type] || TYPE_WEIGHTS.general;
    const freshnessLevel = calculateFreshnessLevel(memory.updatedAt);
    const freshnessFactor = FRESHNESS_FACTORS[freshnessLevel];

    // 计算最终分数
    const score = typeWeight * memory.relevance * freshnessFactor;

    return {
      memoryId: memory.id,
      score,
      typeWeight,
      freshnessLevel,
      freshnessFactor,
      shouldSave: score >= this.threshold,
    };
  }

  /**
   * 批量打分
   */
  scoreMemories(memories: MemoryItem[]): ScoringResult[] {
    const results = memories.map((mem) => this.score(mem));

    // 更新统计信息
    this.stats.totalMemories = memories.length;
    this.stats.savedMemories = results.filter((r) => r.shouldSave).length;
    this.stats.discardedMemories = memories.length - this.stats.savedMemories;

    if (results.length > 0) {
      this.stats.averageScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    }

    // 更新类型分布
    for (const type of Object.keys(TYPE_WEIGHTS) as MemoryType[]) {
      this.stats.distribution[type] = memories.filter((m) => m.type === type).length;
    }

    return results;
  }

  /**
   * 获取打分统计
   */
  getStats(): ScoringStats {
    return { ...this.stats };
  }

  /**
   * 设置阈值
   */
  setThreshold(threshold: number): void {
    this.threshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 获取阈值
   */
  getThreshold(): number {
    return this.threshold;
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalMemories: 0,
      savedMemories: 0,
      discardedMemories: 0,
      averageScore: 0,
      distribution: {
        code: 0,
        design: 0,
        bugs: 0,
        docs: 0,
        general: 0,
      },
    };
  }
}

/**
 * 便利函数：快速打分单个记忆
 */
export function scoreMemory(memory: MemoryItem, threshold: number = 0.5): ScoringResult {
  const scorer = new AutoMemoryScorer(threshold);
  return scorer.score(memory);
}

/**
 * 便利函数：快速打分多个记忆
 */
export function scoreMemories(
  memories: MemoryItem[],
  threshold: number = 0.5
): ScoringResult[] {
  const scorer = new AutoMemoryScorer(threshold);
  return scorer.scoreMemories(memories);
}
