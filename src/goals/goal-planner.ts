/**
 * GoalPlanner — 目标分解与策略规划
 * 调用 Claude API 将高层目标分解为可执行的策略和步骤
 */

import type { Goal, PlanResult, GoalStrategy } from './types.js';
import type { GoalStore } from './goal-store.js';

export class GoalPlanner {
  constructor(private store: GoalStore) {}

  /**
   * 为目标生成初始策略
   * 返回 AI 应执行的 prompt，由 daemon 的 executor 执行
   */
  buildPlanPrompt(goal: Goal): string {
    const metricsDesc = goal.metrics.map(m =>
      `- ${m.name}: 当前 ${m.current}${m.unit} / 目标 ${m.target}${m.unit}`
    ).join('\n');

    const existingStrategies = goal.strategies.length > 0
      ? goal.strategies.map(s =>
          `- [${s.status}] ${s.name} (score: ${s.score}): ${s.description}`
        ).join('\n')
      : '（暂无策略）';

    const recentLogs = this.store.readLogs(goal.id, 20);
    const logsDesc = recentLogs.length > 0
      ? recentLogs.map(l => `[${new Date(l.createdAt).toISOString()}] ${l.type}: ${l.message}`).join('\n')
      : '（暂无执行日志）';

    return `你是一个持久目标执行代理。你的任务是为以下目标制定具体可执行的策略。

## 目标
名称: ${goal.name}
描述: ${goal.description}

## 量化指标
${metricsDesc}

## 现有策略
${existingStrategies}

## 最近执行日志
${logsDesc}

## 约束条件
- 以下操作需要人工确认才能执行: ${goal.humanApprovalRequired.join(', ')}
- 你可以使用所有可用的工具（Bash、Browser、WebFetch、Read、Write 等）
- 每个策略需要分解为具体的、可自动化执行的步骤
- 标记哪些步骤需要人工介入（如验证码、支付确认等）

## 输出要求
请调用 GoalManage 工具，action 为 "add_strategy"，为这个目标添加 1-3 个可行策略。
每个策略包含：
1. name: 策略名称
2. description: 详细描述
3. priority: 优先级（1-10，数字越小越优先）
4. steps: 具体步骤列表，每个步骤包含 name、description、needsHuman（是否需要人工）、dependsOn（依赖的步骤）

请基于当前进度和已有策略的效果来规划。如果某个策略效果不佳（score < 30），建议替换它。`;
  }

  /**
   * 从 AI 响应中解析策略
   * 这个方法被 GoalDaemon 调用，解析 executor 的输出
   */
  parseAndApplyPlan(goalId: string, plan: PlanResult): GoalStrategy[] {
    const added: GoalStrategy[] = [];
    for (const strategyInput of plan.strategies) {
      const strategy = this.store.addStrategy(goalId, {
        name: strategyInput.name,
        description: strategyInput.description,
        status: 'active',
        priority: strategyInput.priority,
        steps: strategyInput.steps,
        score: strategyInput.score ?? 50,
        scoreReason: strategyInput.scoreReason,
        metricContributions: strategyInput.metricContributions ?? {},
      });
      if (strategy) added.push(strategy);
    }
    this.store.appendLog(goalId, 'plan', `Added ${added.length} strategies`, {
      strategyNames: added.map(s => s.name),
    });
    return added;
  }
}
