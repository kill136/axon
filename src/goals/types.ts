/**
 * 持久目标系统 — 类型定义
 */

// ============================================================================
// 目标状态
// ============================================================================

export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StrategyStatus = 'active' | 'paused' | 'exhausted' | 'completed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';

// ============================================================================
// 核心实体
// ============================================================================

/** 一个可度量的指标（如"累计收入"） */
export interface GoalMetric {
  name: string;
  current: number;
  target: number;
  unit: string;
}

/** 一个执行步骤 */
export interface GoalStep {
  id: string;
  strategyId: string;
  name: string;
  description: string;
  status: StepStatus;
  /** 需要人工介入 */
  needsHuman: boolean;
  /** 人工介入说明 */
  humanNote?: string;
  /** 依赖的步骤 ID */
  dependsOn: string[];
  /** 执行结果摘要 */
  result?: string;
  /** 执行错误 */
  error?: string;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

/** 一条策略（达成目标的路径） */
export interface GoalStrategy {
  id: string;
  goalId: string;
  name: string;
  description: string;
  status: StrategyStatus;
  /** 优先级，数值越小越优先 */
  priority: number;
  /** 该策略的步骤 */
  steps: GoalStep[];
  /** 策略评估分数 (0-100) */
  score: number;
  /** 评估理由 */
  scoreReason?: string;
  /** 策略对指标的贡献 */
  metricContributions: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

/** 一条执行日志 */
export interface GoalLog {
  id: string;
  goalId: string;
  strategyId?: string;
  stepId?: string;
  type: 'plan' | 'execute' | 'evaluate' | 'escalate' | 'replan' | 'info';
  message: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

/** 顶层目标 */
export interface Goal {
  id: string;
  name: string;
  description: string;
  status: GoalStatus;
  /** 可量化指标 */
  metrics: GoalMetric[];
  /** 策略列表 */
  strategies: GoalStrategy[];
  /** 执行间隔（ms），daemon 多久检查一次 */
  checkIntervalMs: number;
  /** 需要人确认才能执行的操作类型 */
  humanApprovalRequired: string[];
  /** 通知渠道 */
  notify: ('desktop' | 'feishu')[];
  /** 飞书会话 ID */
  feishuChatId?: string;
  /** 工作目录 */
  workingDir: string;
  /** 使用的模型 */
  model: string;
  /** API 认证快照 */
  authSnapshot?: {
    apiKey?: string;
    authToken?: string;
    baseUrl?: string;
  };
  /** 最后一次 daemon 检查时间 */
  lastCheckAt?: number;
  /** 下次检查时间 */
  nextCheckAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// 操作命令
// ============================================================================

export interface CreateGoalInput {
  name: string;
  description: string;
  metrics: GoalMetric[];
  checkIntervalMs?: number;
  humanApprovalRequired?: string[];
  notify?: ('desktop' | 'feishu')[];
  feishuChatId?: string;
  model?: string;
}

export interface EvaluationResult {
  goalId: string;
  overallProgress: number; // 0-100
  metricsSnapshot: GoalMetric[];
  strategyScores: { strategyId: string; score: number; reason: string }[];
  recommendation: 'continue' | 'replan' | 'pause' | 'escalate';
  reasoning: string;
  suggestedActions: string[];
}

export interface PlanResult {
  strategies: Omit<GoalStrategy, 'id' | 'goalId' | 'createdAt' | 'updatedAt'>[];
  reasoning: string;
}

export interface StepExecutionResult {
  stepId: string;
  status: 'completed' | 'failed' | 'blocked';
  result?: string;
  error?: string;
  metricUpdates?: Record<string, number>;
}
