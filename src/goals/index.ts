/**
 * Goals 模块入口
 */

import { GoalStore } from './goal-store.js';
import type { Goal } from './types.js';

export { GoalStore } from './goal-store.js';
export { GoalPlanner } from './goal-planner.js';
export { GoalEvaluator } from './goal-evaluator.js';
export { GoalDaemon, getGoalDaemon } from './goal-daemon.js';
export type {
  Goal,
  GoalStatus,
  GoalMetric,
  GoalStrategy,
  StrategyStatus,
  GoalStep,
  StepStatus,
  GoalLog,
  CreateGoalInput,
  EvaluationResult,
  PlanResult,
  StepExecutionResult,
} from './types.js';

/**
 * 加载当前项目的活跃目标
 * 供 ConversationLoop 在启动时注入 system prompt
 */
export function loadActiveGoals(_workingDir: string): Goal[] {
  try {
    const store = new GoalStore();
    return store.listGoals('active');
  } catch {
    return [];
  }
}
