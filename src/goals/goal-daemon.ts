/**
 * GoalDaemon — 后台持续执行引擎
 * 与现有 Daemon 系统集成，定期检查活跃目标并驱动执行
 *
 * 设计原则：
 * - 利用现有 daemon 的 interval 机制，注册为一个特殊的定时任务
 * - 每次触发时：加载目标 → 评估 → 执行/重规划
 * - 完全持久化，进程重启后无缝恢复
 */

import { GoalStore } from './goal-store.js';
import { GoalPlanner } from './goal-planner.js';
import { GoalEvaluator } from './goal-evaluator.js';
import type { Goal, GoalStep } from './types.js';

export class GoalDaemon {
  private store: GoalStore;
  private planner: GoalPlanner;
  private evaluator: GoalEvaluator;

  constructor() {
    this.store = new GoalStore();
    this.planner = new GoalPlanner(this.store);
    this.evaluator = new GoalEvaluator(this.store);
  }

  /**
   * 核心调度：获取到期目标，为每个目标生成执行 prompt
   * 由 daemon scheduler 定期调用
   *
   * 返回值是一组 { goalId, prompt } ，daemon executor 负责实际执行
   */
  async tick(): Promise<Array<{ goalId: string; prompt: string; model: string; workingDir: string; authSnapshot?: Goal['authSnapshot'] }>> {
    this.store.reload();
    const dueGoals = this.store.getDueGoals();

    if (dueGoals.length === 0) return [];

    const jobs: Array<{ goalId: string; prompt: string; model: string; workingDir: string; authSnapshot?: Goal['authSnapshot'] }> = [];

    for (const goal of dueGoals) {
      // 标记为正在检查，防止重复触发
      this.store.markChecking(goal.id);

      // 检查是否已完成
      if (this.evaluator.isGoalCompleted(goal)) {
        this.store.updateGoal(goal.id, { status: 'completed' });
        this.store.appendLog(goal.id, 'info', 'Goal completed! All metrics met targets.');
        // 通知用户
        jobs.push({
          goalId: goal.id,
          prompt: `目标「${goal.name}」已完成！所有指标已达标。请生成一份完成报告。`,
          model: goal.model,
          workingDir: goal.workingDir,
          authSnapshot: goal.authSnapshot,
        });
        continue;
      }

      // 决定执行什么
      const prompt = this.buildTickPrompt(goal);
      jobs.push({
        goalId: goal.id,
        prompt,
        model: goal.model,
        workingDir: goal.workingDir,
        authSnapshot: goal.authSnapshot,
      });
    }

    return jobs;
  }

  /**
   * 根据目标当前状态，构建本轮执行的 prompt
   */
  private buildTickPrompt(goal: Goal): string {
    // 如果没有策略，先做规划
    const activeStrategies = goal.strategies.filter(s => s.status === 'active');
    if (activeStrategies.length === 0) {
      this.store.appendLog(goal.id, 'plan', 'No active strategies, requesting planning');
      return this.planner.buildPlanPrompt(goal);
    }

    // 找到下一个可执行的步骤
    const nextStep = this.findNextExecutableStep(goal);
    if (nextStep) {
      this.store.appendLog(goal.id, 'execute', `Executing step: ${nextStep.step.name}`, {
        strategyId: nextStep.strategyId,
        stepId: nextStep.step.id,
      });
      return this.evaluator.buildExecuteStepPrompt(goal, nextStep.strategyId, nextStep.step.id);
    }

    // 没有可执行的步骤 → 评估并重新规划
    this.store.appendLog(goal.id, 'evaluate', 'No executable steps, evaluating progress');
    return this.evaluator.buildEvaluatePrompt(goal);
  }

  /**
   * 按优先级找到下一个可执行的步骤
   * 规则：
   * 1. 按策略优先级排序
   * 2. 跳过 needsHuman=true 的步骤
   * 3. 跳过依赖未完成的步骤
   * 4. 失败的步骤如果未超重试上限，可以重试
   */
  private findNextExecutableStep(goal: Goal): { strategyId: string; step: GoalStep } | null {
    const activeStrategies = goal.strategies
      .filter(s => s.status === 'active')
      .sort((a, b) => a.priority - b.priority);

    for (const strategy of activeStrategies) {
      for (const step of strategy.steps) {
        // 已完成或已跳过
        if (step.status === 'completed' || step.status === 'skipped') continue;
        // 正在运行
        if (step.status === 'running') continue;
        // 需要人工且已标记
        if (step.needsHuman && step.status === 'blocked') continue;

        // 失败但可重试
        if (step.status === 'failed' && step.retryCount >= step.maxRetries) continue;

        // 检查依赖
        if (step.dependsOn.length > 0) {
          const allDepsCompleted = step.dependsOn.every(depId => {
            const depStep = strategy.steps.find(s => s.id === depId);
            return depStep && depStep.status === 'completed';
          });
          if (!allDepsCompleted) continue;
        }

        return { strategyId: strategy.id, step };
      }
    }

    return null;
  }

  /**
   * 获取目标摘要（用于 Goal 工具展示）
   */
  getGoalSummary(goalId: string): string {
    const goal = this.store.getGoal(goalId);
    if (!goal) return 'Goal not found';

    const progress = this.evaluator.calculateProgress(goal);
    const metricsLines = goal.metrics.map(m =>
      `  ${m.name}: ${m.current}${m.unit} / ${m.target}${m.unit}`
    ).join('\n');

    const strategiesLines = goal.strategies.map(s => {
      const done = s.steps.filter(st => st.status === 'completed').length;
      const total = s.steps.length;
      return `  [${s.status}] ${s.name} (${done}/${total} steps, score: ${s.score})`;
    }).join('\n');

    const recentLogs = this.store.readLogs(goalId, 5);
    const logsLines = recentLogs.map(l =>
      `  [${new Date(l.createdAt).toLocaleString()}] ${l.message}`
    ).join('\n');

    return `# 目标: ${goal.name}
状态: ${goal.status} | 进度: ${progress}%
描述: ${goal.description}

## 指标
${metricsLines || '  （无指标）'}

## 策略
${strategiesLines || '  （无策略）'}

## 最近活动
${logsLines || '  （无日志）'}

检查间隔: ${goal.checkIntervalMs / 60000}分钟
下次检查: ${goal.nextCheckAt ? new Date(goal.nextCheckAt).toLocaleString() : 'now'}`;
  }

  // 暴露内部组件供工具使用
  getStore(): GoalStore { return this.store; }
  getPlanner(): GoalPlanner { return this.planner; }
  getEvaluator(): GoalEvaluator { return this.evaluator; }
}

/** 全局单例 */
let _instance: GoalDaemon | null = null;

export function getGoalDaemon(): GoalDaemon {
  if (!_instance) {
    _instance = new GoalDaemon();
  }
  return _instance;
}
