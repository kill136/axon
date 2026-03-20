/**
 * GoalManage 工具 — 让 AI 能创建、管理、执行持久目标
 *
 * 这是 AI 与目标系统交互的唯一入口。支持：
 * - 创建目标、添加策略、管理步骤
 * - 更新指标、查看进度
 * - daemon 后台持续执行
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { getGoalDaemon } from '../goals/index.js';
import type { GoalMetric, GoalStep } from '../goals/types.js';
import { snapshotAuthCredentials } from '../auth/snapshot.js';

interface GoalManageInput {
  action:
    | 'create'          // 创建目标
    | 'list'            // 列出所有目标
    | 'status'          // 查看目标详情
    | 'pause'           // 暂停目标
    | 'resume'          // 恢复目标
    | 'cancel'          // 取消目标
    | 'add_strategy'    // 添加策略
    | 'update_step'     // 更新步骤状态
    | 'update_metric'   // 更新指标
    | 'logs'            // 查看执行日志
    | 'run_now';        // 立即触发一次检查

  // create
  name?: string;
  description?: string;
  metrics?: GoalMetric[];
  checkIntervalMs?: number;
  humanApprovalRequired?: string[];
  notify?: ('desktop' | 'feishu')[];
  feishuChatId?: string;
  model?: string;

  // status / pause / resume / cancel / logs / run_now
  goalId?: string;

  // add_strategy
  strategyName?: string;
  strategyDescription?: string;
  priority?: number;
  steps?: Array<{
    name: string;
    description: string;
    needsHuman?: boolean;
    dependsOn?: string[];
    maxRetries?: number;
  }>;

  // update_step
  strategyId?: string;
  stepId?: string;
  stepStatus?: GoalStep['status'];
  result?: string;
  error?: string;
  needsHuman?: boolean;
  humanNote?: string;

  // update_metric
  metricName?: string;
  value?: number;
}

export class GoalManageTool extends BaseTool<GoalManageInput> {
  name = 'GoalManage';
  shouldDefer = true;
  searchHint = 'long-term goal, OKR, track progress, autonomous objective, milestone, metrics';
  description = `Create and manage persistent long-term goals that execute autonomously via the daemon.
Goals persist across sessions and the daemon continuously works towards them.
Actions: create, list, status, pause, resume, cancel, add_strategy, update_step, update_metric, logs, run_now.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'status', 'pause', 'resume', 'cancel', 'add_strategy', 'update_step', 'update_metric', 'logs', 'run_now'],
          description: 'The action to perform',
        },
        name: { type: 'string', description: 'Goal name (for create)' },
        description: { type: 'string', description: 'Goal description (for create)' },
        metrics: {
          type: 'array',
          description: 'Measurable metrics (for create)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              current: { type: 'number' },
              target: { type: 'number' },
              unit: { type: 'string' },
            },
          },
        },
        checkIntervalMs: { type: 'number', description: 'How often to check progress in ms (default: 30min)' },
        humanApprovalRequired: { type: 'array', items: { type: 'string' }, description: 'Operation types that need human approval' },
        notify: { type: 'array', items: { type: 'string', enum: ['desktop', 'feishu'] } },
        feishuChatId: { type: 'string' },
        model: { type: 'string', description: 'Model to use (default: sonnet)' },
        goalId: { type: 'string', description: 'Goal ID (for status/pause/resume/cancel/logs/run_now/add_strategy)' },
        strategyName: { type: 'string', description: 'Strategy name (for add_strategy)' },
        strategyDescription: { type: 'string', description: 'Strategy description (for add_strategy)' },
        priority: { type: 'number', description: 'Strategy priority 1-10 (for add_strategy)' },
        steps: {
          type: 'array',
          description: 'Steps for the strategy (for add_strategy)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              needsHuman: { type: 'boolean' },
              dependsOn: { type: 'array', items: { type: 'string' } },
              maxRetries: { type: 'number' },
            },
          },
        },
        strategyId: { type: 'string', description: 'Strategy ID (for update_step)' },
        stepId: { type: 'string', description: 'Step ID (for update_step)' },
        stepStatus: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'blocked', 'skipped'] },
        result: { type: 'string', description: 'Step execution result' },
        error: { type: 'string', description: 'Step error message' },
        needsHuman: { type: 'boolean' },
        humanNote: { type: 'string' },
        metricName: { type: 'string', description: 'Metric name (for update_metric)' },
        value: { type: 'number', description: 'New metric value (for update_metric)' },
      },
      required: ['action'],
    };
  }

  async execute(input: GoalManageInput): Promise<ToolResult> {
    const daemon = getGoalDaemon();
    const store = daemon.getStore();

    switch (input.action) {
      // =====================================================================
      // CREATE
      // =====================================================================
      case 'create': {
        if (!input.name) return this.error('name is required');
        if (!input.description) return this.error('description is required');
        if (!input.metrics || input.metrics.length === 0) {
          return this.error('At least one metric is required to track progress');
        }

        // 获取认证信息
        const authSnapshot = this.getAuthSnapshot();

        const goal = store.createGoal(
          {
            name: input.name,
            description: input.description,
            metrics: input.metrics,
            checkIntervalMs: input.checkIntervalMs,
            humanApprovalRequired: input.humanApprovalRequired,
            notify: input.notify,
            feishuChatId: input.feishuChatId,
            model: input.model,
          },
          process.cwd(),
          authSnapshot,
        );

        return this.success(
          `Goal created successfully!\n\n` +
          `ID: ${goal.id}\n` +
          `Name: ${goal.name}\n` +
          `Status: ${goal.status}\n` +
          `Check interval: ${goal.checkIntervalMs / 60000} minutes\n` +
          `Metrics: ${goal.metrics.map(m => `${m.name} (${m.current}/${m.target} ${m.unit})`).join(', ')}\n\n` +
          `The daemon will start working on this goal. Use add_strategy to define execution strategies.`
        );
      }

      // =====================================================================
      // LIST
      // =====================================================================
      case 'list': {
        const goals = store.listGoals();
        if (goals.length === 0) {
          return this.success('No goals found. Use action="create" to create one.');
        }
        const evaluator = daemon.getEvaluator();
        const lines = goals.map(g => {
          const progress = evaluator.calculateProgress(g);
          const strategies = g.strategies.length;
          return `[${g.status}] ${g.name} (${progress}%) — ${strategies} strategies — ID: ${g.id}`;
        });
        return this.success(`Goals (${goals.length}):\n${lines.join('\n')}`);
      }

      // =====================================================================
      // STATUS
      // =====================================================================
      case 'status': {
        if (!input.goalId) return this.error('goalId is required');
        const summary = daemon.getGoalSummary(input.goalId);
        return this.success(summary);
      }

      // =====================================================================
      // PAUSE / RESUME / CANCEL
      // =====================================================================
      case 'pause': {
        if (!input.goalId) return this.error('goalId is required');
        const goal = store.updateGoal(input.goalId, { status: 'paused' });
        if (!goal) return this.error('Goal not found');
        store.appendLog(input.goalId, 'info', 'Goal paused by user');
        return this.success(`Goal "${goal.name}" paused.`);
      }

      case 'resume': {
        if (!input.goalId) return this.error('goalId is required');
        // 恢复时刷新 authSnapshot（确保 daemon 使用当前有效凭证）
        const resumeAuth = this.getAuthSnapshot();
        const goal = store.updateGoal(input.goalId, {
          status: 'active',
          nextCheckAt: Date.now(),
          ...(Object.keys(resumeAuth).length > 0 ? { authSnapshot: resumeAuth } : {}),
        });
        if (!goal) return this.error('Goal not found');
        store.appendLog(input.goalId, 'info', 'Goal resumed by user (auth refreshed)');
        return this.success(`Goal "${goal.name}" resumed. Next check: now.`);
      }

      case 'cancel': {
        if (!input.goalId) return this.error('goalId is required');
        const goal = store.updateGoal(input.goalId, { status: 'cancelled' });
        if (!goal) return this.error('Goal not found');
        store.appendLog(input.goalId, 'info', 'Goal cancelled by user');
        return this.success(`Goal "${goal.name}" cancelled.`);
      }

      // =====================================================================
      // ADD STRATEGY
      // =====================================================================
      case 'add_strategy': {
        if (!input.goalId) return this.error('goalId is required');
        if (!input.strategyName) return this.error('strategyName is required');

        const steps: GoalStep[] = (input.steps ?? []).map((s, i) => ({
          id: `step-${Date.now()}-${i}`,
          strategyId: '', // 会被 store 覆盖
          name: s.name,
          description: s.description,
          status: 'pending' as const,
          needsHuman: s.needsHuman ?? false,
          dependsOn: s.dependsOn ?? [],
          retryCount: 0,
          maxRetries: s.maxRetries ?? 3,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));

        const strategy = store.addStrategy(input.goalId, {
          name: input.strategyName,
          description: input.strategyDescription ?? '',
          status: 'active',
          priority: input.priority ?? 5,
          steps,
          score: 50,
          metricContributions: {},
        });

        if (!strategy) return this.error('Goal not found');

        return this.success(
          `Strategy added!\n` +
          `ID: ${strategy.id}\n` +
          `Name: ${strategy.name}\n` +
          `Priority: ${strategy.priority}\n` +
          `Steps: ${steps.length}\n` +
          steps.map((s, i) => `  ${i + 1}. ${s.name}${s.needsHuman ? ' ⚠️needs human' : ''}`).join('\n')
        );
      }

      // =====================================================================
      // UPDATE STEP
      // =====================================================================
      case 'update_step': {
        if (!input.goalId || !input.strategyId || !input.stepId) {
          return this.error('goalId, strategyId, and stepId are required');
        }

        const step = store.updateStep(input.goalId, input.strategyId, input.stepId, {
          status: input.stepStatus,
          result: input.result,
          error: input.error,
          needsHuman: input.needsHuman,
          humanNote: input.humanNote,
          retryCount: input.stepStatus === 'failed' ? undefined : undefined, // 由 store 处理
        });

        if (!step) return this.error('Goal, strategy, or step not found');

        store.appendLog(input.goalId, 'execute',
          `Step "${step.name}" → ${step.status}${step.result ? ': ' + step.result : ''}${step.error ? ' (error: ' + step.error + ')' : ''}`,
          { strategyId: input.strategyId, stepId: input.stepId },
        );

        return this.success(`Step "${step.name}" updated to ${step.status}.`);
      }

      // =====================================================================
      // UPDATE METRIC
      // =====================================================================
      case 'update_metric': {
        if (!input.goalId) return this.error('goalId is required');
        if (!input.metricName) return this.error('metricName is required');
        if (input.value === undefined) return this.error('value is required');

        const goal = store.getGoal(input.goalId);
        if (!goal) return this.error('Goal not found');

        const metric = goal.metrics.find(m => m.name === input.metricName);
        if (!metric) return this.error(`Metric "${input.metricName}" not found`);

        const oldValue = metric.current;
        metric.current = input.value;
        goal.updatedAt = Date.now();
        store.updateGoal(goal.id, { metrics: goal.metrics });

        store.appendLog(input.goalId, 'info',
          `Metric "${input.metricName}": ${oldValue} → ${input.value} ${metric.unit} (target: ${metric.target})`,
        );

        // 检查是否所有指标都达标
        const evaluator = daemon.getEvaluator();
        if (evaluator.isGoalCompleted(goal)) {
          store.updateGoal(goal.id, { status: 'completed' });
          store.appendLog(goal.id, 'info', 'ALL METRICS MET! Goal completed!');
          return this.success(
            `Metric updated: ${input.metricName} = ${input.value}${metric.unit}\n` +
            `🎯 ALL METRICS MET! Goal "${goal.name}" is now COMPLETED!`
          );
        }

        const progress = evaluator.calculateProgress(goal);
        return this.success(
          `Metric updated: ${input.metricName} = ${input.value}${metric.unit} (target: ${metric.target}${metric.unit})\n` +
          `Overall progress: ${progress}%`
        );
      }

      // =====================================================================
      // LOGS
      // =====================================================================
      case 'logs': {
        if (!input.goalId) return this.error('goalId is required');
        const logs = store.readLogs(input.goalId, 30);
        if (logs.length === 0) return this.success('No logs found.');
        const lines = logs.map(l =>
          `[${new Date(l.createdAt).toLocaleString()}] [${l.type}] ${l.message}`
        );
        return this.success(`Logs for goal ${input.goalId}:\n${lines.join('\n')}`);
      }

      // =====================================================================
      // RUN NOW
      // =====================================================================
      case 'run_now': {
        if (!input.goalId) return this.error('goalId is required');
        // 刷新 authSnapshot（修复创建时快照为空导致 daemon 401 的问题）
        const freshAuth = this.getAuthSnapshot();
        const goal = store.updateGoal(input.goalId, {
          nextCheckAt: Date.now(),
          ...(Object.keys(freshAuth).length > 0 ? { authSnapshot: freshAuth } : {}),
        });
        if (!goal) return this.error('Goal not found');
        store.appendLog(input.goalId, 'info', 'Manual check triggered (auth refreshed)');
        return this.success(`Goal "${goal.name}" will be checked on the next daemon tick.`);
      }

      default:
        return this.error(`Unknown action: ${input.action}`);
    }
  }

  /**
   * 获取认证快照（统一从 settings.json / 环境变量 / CLI keychain 读取）
   */
  private getAuthSnapshot(): { apiKey?: string; authToken?: string; baseUrl?: string } {
    return snapshotAuthCredentials() || {};
  }
}
