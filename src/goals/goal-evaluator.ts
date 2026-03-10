/**
 * GoalEvaluator — 进度评估与策略调整
 * 定期评估目标进度，打分策略效果，决定是否需要重新规划
 */

import type { Goal, EvaluationResult } from './types.js';
import type { GoalStore } from './goal-store.js';

export class GoalEvaluator {
  constructor(private store: GoalStore) {}

  /**
   * 构建评估 prompt，让 AI 评估当前进度
   */
  buildEvaluatePrompt(goal: Goal): string {
    const metricsDesc = goal.metrics.map(m => {
      const progress = m.target > 0 ? ((m.current / m.target) * 100).toFixed(1) : '0';
      return `- ${m.name}: ${m.current}${m.unit} / ${m.target}${m.unit} (${progress}%)`;
    }).join('\n');

    const strategiesDesc = goal.strategies.map(s => {
      const completedSteps = s.steps.filter(st => st.status === 'completed').length;
      const totalSteps = s.steps.length;
      const failedSteps = s.steps.filter(st => st.status === 'failed').length;
      const blockedSteps = s.steps.filter(st => st.status === 'blocked').length;
      return `- [${s.status}] ${s.name} (优先级: ${s.priority}, 评分: ${s.score})
    进度: ${completedSteps}/${totalSteps} 步完成, ${failedSteps} 失败, ${blockedSteps} 阻塞
    描述: ${s.description}
    步骤详情:
${s.steps.map(st => `      - [${st.status}] ${st.name}${st.needsHuman ? ' ⚠️需人工' : ''}${st.error ? ` (错误: ${st.error})` : ''}${st.result ? ` → ${st.result}` : ''}`).join('\n')}`;
    }).join('\n');

    const recentLogs = this.store.readLogs(goal.id, 30);
    const logsDesc = recentLogs.slice(-15).map(l =>
      `[${new Date(l.createdAt).toISOString()}] ${l.type}: ${l.message}`
    ).join('\n');

    return `你是一个持久目标执行代理。请评估以下目标的当前进度并决定下一步行动。

## 目标
名称: ${goal.name}
描述: ${goal.description}
创建时间: ${new Date(goal.createdAt).toISOString()}
已运行时长: ${this.formatDuration(Date.now() - goal.createdAt)}

## 量化指标
${metricsDesc}

## 当前策略与执行状态
${strategiesDesc || '（暂无策略）'}

## 最近执行日志
${logsDesc || '（暂无日志）'}

## 你需要做的事
1. **评估**：分析每个策略的效果，给出 0-100 的评分和理由
2. **决策**：选择以下之一
   - continue: 继续执行当前计划，找到下一个可执行的步骤去执行
   - replan: 当前策略效果不佳，需要制定新策略
   - escalate: 遇到无法自动解决的问题，需要通知人类
   - pause: 所有可自动执行的步骤都完成了，等待外部条件变化
3. **执行**：如果决策是 continue，立即执行下一个可执行的步骤

## 执行规则
- 用 GoalManage 工具更新步骤状态和指标
- 如果步骤需要人工（needsHuman=true），跳过它并标记为 blocked
- 如果步骤失败且重试次数未超限，可以重试
- 如果策略得分低于 30，建议淘汰并创建新策略
- 更新指标时使用 action="update_metric"`;
  }

  /**
   * 计算目标的整体进度百分比
   */
  calculateProgress(goal: Goal): number {
    if (goal.metrics.length === 0) return 0;
    const progresses = goal.metrics.map(m =>
      m.target > 0 ? Math.min(m.current / m.target, 1) : 0
    );
    return Math.round((progresses.reduce((a, b) => a + b, 0) / progresses.length) * 100);
  }

  /**
   * 检查目标是否已完成（所有指标达标）
   */
  isGoalCompleted(goal: Goal): boolean {
    return goal.metrics.length > 0 && goal.metrics.every(m => m.current >= m.target);
  }

  /**
   * 构建执行下一步的 prompt
   */
  buildExecuteStepPrompt(goal: Goal, strategyId: string, stepId: string): string {
    const strategy = goal.strategies.find(s => s.id === strategyId);
    const step = strategy?.steps.find(s => s.id === stepId);
    if (!strategy || !step) return '';

    return `你是一个持久目标执行代理。请执行以下步骤。

## 目标: ${goal.name}
## 策略: ${strategy.name}
## 当前步骤: ${step.name}
## 步骤描述: ${step.description}

## 约束
- 需要人工确认的操作类型: ${goal.humanApprovalRequired.join(', ')}
- 如果这个步骤涉及上述操作，请标记为需要人工介入而不是自行执行

## 执行完成后
使用 GoalManage 工具更新步骤状态:
- 成功: action="update_step", status="completed", result="执行结果摘要"
- 失败: action="update_step", status="failed", error="失败原因"
- 需要人工: action="update_step", status="blocked", needsHuman=true, humanNote="需要人做什么"

如果执行成功且对指标有贡献，同时更新指标:
- action="update_metric", metricName="指标名", value=新数值`;
  }

  private formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}天${hours % 24}小时`;
    if (hours > 0) return `${hours}小时`;
    return `${Math.floor(ms / 60000)}分钟`;
  }
}
