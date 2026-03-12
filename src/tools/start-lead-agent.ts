/**
 * StartLeadAgent 工具 - Planner Agent (Chat Tab) 专用
 *
 * v12.0: 支持 TaskPlan 轻量委派 + 结构化错误返回
 *
 * 设计理念：
 * - Planner Agent 生成 Blueprint 或 TaskPlan 后，调用此工具启动 LeadAgent
 * - 阻塞等待 LeadAgent 完整执行完成后返回结果（双向通信）
 * - Planner Agent 拿到执行报告后可以做后续决策（修复、重试、汇报用户）
 * - 采用静态上下文注入模式（与 DispatchWorkerTool 一致）
 * - execute() 自包含执行，不再依赖 ConversationManager 拦截
 *
 * 三级调用链：
 * Planner Agent --StartLeadAgent--> LeadAgent --DispatchWorker/TriggerE2ETest--> Worker/E2E Agent
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { Blueprint } from '../blueprint/types.js';

// v12.1: rawResponse 最大长度（约 2K tokens），避免撑爆 Planner 上下文
const MAX_RAW_RESPONSE_LENGTH = 8000;

export interface StartLeadAgentInput {
  /** 蓝图 ID（与 taskPlan 二选一） */
  blueprintId?: string;
  /** 轻量级任务计划（与 blueprintId 二选一） */
  taskPlan?: {
    goal: string;
    context: string;
    tasks: Array<{
      id: string;
      name: string;
      description: string;
      files?: string[];
      dependencies?: string[];
      complexity?: string;
      type?: string;
    }>;
    constraints?: string[];
    acceptanceCriteria?: string[];
  };
  model?: 'haiku' | 'sonnet' | 'opus';
}

// ============================================================================
// 静态上下文接口（由 ConversationManager 在启动前设置）
// ============================================================================

export interface StartLeadAgentContext {
  /** 获取蓝图 */
  getBlueprint: (id: string) => Blueprint | undefined;
  /** 保存蓝图 */
  saveBlueprint: (blueprint: Blueprint) => void;
  /** 启动执行，返回 { sessionId }。taskPlan 可选传入用于 LeadAgent 完整接收任务 */
  startExecution: (blueprint: Blueprint, taskPlan?: any) => Promise<{ id: string }>;
  /** 阻塞等待执行完成（v12.0: 返回结构化结果） */
  waitForCompletion: (sessionId: string) => Promise<{
    success: boolean;
    rawResponse?: string;
    completedCount?: number;
    failedCount?: number;
    skippedCount?: number;
    failedTasks?: string[];
    completedTasks?: string[];
  }>;
  /** 取消执行（由 Chat Tab 中断时调用） */
  cancelExecution: (sessionId: string) => void;
  /** 通知前端导航到 SwarmConsole（可选） */
  navigateToSwarm?: (blueprintId: string, executionId: string) => void;
  /** 获取当前工作目录 */
  getWorkingDirectory?: () => string;
  /** 获取主 agent 的认证配置（用于透传给子 agent） */
  getClientConfig?: () => { apiKey?: string; authToken?: string; baseUrl?: string };
}

/**
 * StartLeadAgent 工具
 * Planner Agent 专用，启动 LeadAgent 执行蓝图或任务计划并等待完成
 */
export class StartLeadAgentTool extends BaseTool<StartLeadAgentInput, ToolResult> {
  name = 'StartLeadAgent';
  shouldDefer = true;
  searchHint = 'build entire project, execute blueprint, multi-agent development, batch implement tasks';
  description = `Start LeadAgent to execute development tasks (blocks until completion)

## When to Use
Two modes:
1. **Blueprint mode**: Call after GenerateBlueprint returns blueprintId
2. **TaskPlan mode**: Pass task list directly, no full blueprint needed (suitable for moderate complexity tasks)

## Parameters
- blueprintId: Blueprint ID (mutually exclusive with taskPlan)
- taskPlan: Lightweight task plan (mutually exclusive with blueprintId)
  - goal: Overall goal
  - context: Context description
  - tasks: Task list (each task has id, name, description)
  - constraints: Constraints (optional)
  - acceptanceCriteria: Acceptance criteria (optional)
- model: Model for LeadAgent to use (optional, default sonnet)

## Execution
- Call will **block and wait** for LeadAgent to complete execution
- During execution, user can switch to SwarmConsole to view real-time progress
- LeadAgent will automatically: explore code -> plan tasks -> execute/dispatch Workers -> integration check

## Return Value
Returns detailed report after execution, including:
- Completed/failed/skipped task list and statistics
- LeadAgent's complete output
- On failure, includes specific failed tasks and suggestions
- You can decide next steps based on the report (report to user, fix issues, etc.)`;

  // 静态上下文 - 由 ConversationManager 在启动 ConversationLoop 前设置
  private static context: StartLeadAgentContext | null = null;
  // 当前活跃的执行会话 ID（用于 Chat Tab 中断时取消蜂群）
  private static activeExecutionId: string | null = null;

  /**
   * 设置上下文（由 ConversationManager 在启动 ConversationLoop 前调用）
   */
  static setContext(ctx: StartLeadAgentContext): void {
    StartLeadAgentTool.context = ctx;
  }

  /**
   * 清理上下文
   */
  static clearContext(): void {
    StartLeadAgentTool.context = null;
    StartLeadAgentTool.activeExecutionId = null;
  }

  /**
   * 获取当前上下文（供外部检查）
   */
  static getContext(): StartLeadAgentContext | null {
    return StartLeadAgentTool.context;
  }

  /**
   * 取消当前活跃的蜂群执行（由 Chat Tab cancel 时调用）
   * 谁启动的蜂群，谁负责关闭
   */
  static cancelActiveExecution(): void {
    if (StartLeadAgentTool.activeExecutionId && StartLeadAgentTool.context) {
      console.log(`[StartLeadAgent] Chat Tab interrupted, canceling swarm execution: ${StartLeadAgentTool.activeExecutionId}`);
      StartLeadAgentTool.context.cancelExecution(StartLeadAgentTool.activeExecutionId);
      StartLeadAgentTool.activeExecutionId = null;
    }
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        blueprintId: {
          type: 'string',
          description: 'Blueprint ID (mutually exclusive with taskPlan)',
        },
        taskPlan: {
          type: 'object',
          description: 'Lightweight task plan (mutually exclusive with blueprintId)',
          properties: {
            goal: { type: 'string', description: 'Overall goal' },
            context: { type: 'string', description: 'Context description' },
            tasks: {
              type: 'array',
              description: 'Task list',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  files: { type: 'array', items: { type: 'string' } },
                  dependencies: { type: 'array', items: { type: 'string' } },
                  complexity: { type: 'string', enum: ['trivial', 'simple', 'moderate', 'complex'] },
                  type: { type: 'string', enum: ['code', 'config', 'test', 'refactor', 'docs', 'integrate', 'verify'] },
                },
                required: ['id', 'name', 'description'],
              },
            },
            constraints: { type: 'array', items: { type: 'string' } },
            acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          },
          required: ['goal', 'context', 'tasks'],
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: 'Model to use (optional, default sonnet)',
        },
      },
      // blueprintId 和 taskPlan 至少提供一个，但不是都必须
      required: [],
    };
  }

  async execute(input: StartLeadAgentInput): Promise<ToolResult> {
    const ctx = StartLeadAgentTool.context;

    // 未注入上下文 → CLI 模式或未初始化
    if (!ctx) {
      return {
        success: false,
        output: 'StartLeadAgent tool execution context not configured. Please use in the Web chat interface.',
      };
    }

    try {
      let blueprint: Blueprint;
      let blueprintId: string;
      let taskPlanObj: any = undefined;

      if (input.blueprintId) {
        // 蓝图模式：从蓝图存储获取
        const bp = ctx.getBlueprint(input.blueprintId);
        if (!bp) {
          return { success: false, error: `Blueprint ${input.blueprintId} does not exist` };
        }
        blueprint = bp;
        blueprintId = input.blueprintId;
      } else if (input.taskPlan) {
        // TaskPlan 模式：创建最小 Blueprint（仅用于执行管线的结构要求）
        const planId = `tp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const projectPath = ctx.getWorkingDirectory?.() || process.cwd();
        blueprint = {
          id: planId,
          name: input.taskPlan.goal,
          description: input.taskPlan.context,
          projectPath,
          status: 'executing',
          requirements: input.taskPlan.acceptanceCriteria || [input.taskPlan.goal],
          constraints: input.taskPlan.constraints,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Blueprint;
        // v12.1: 不存 BlueprintStore，tp- 蓝图是临时的
        blueprintId = planId;

        // 构建完整 TaskPlan 对象，通过执行管线传递给 LeadAgent
        taskPlanObj = {
          id: planId,
          goal: input.taskPlan.goal,
          context: input.taskPlan.context,
          tasks: input.taskPlan.tasks,
          constraints: input.taskPlan.constraints,
          acceptanceCriteria: input.taskPlan.acceptanceCriteria,
          projectPath,
          createdAt: new Date(),
        };

        console.log(`[StartLeadAgent] TaskPlan mode: Creating temporary blueprint ${planId} (goal: ${input.taskPlan.goal}, tasks: ${input.taskPlan.tasks.length})`);
      } else {
        return { success: false, error: 'Please provide blueprintId or taskPlan' };
      }

      // 启动执行（taskPlanObj 仅在 TaskPlan 模式时有值，通过管线传递到 LeadAgent）
      const session = await ctx.startExecution(blueprint, taskPlanObj);

      // 记录活跃执行 ID，供 Chat Tab 中断时取消
      StartLeadAgentTool.activeExecutionId = session.id;

      // 通知前端导航到 SwarmConsole 查看实时进度
      ctx.navigateToSwarm?.(blueprintId, session.id);

      console.log(`[StartLeadAgent] Blocking wait for LeadAgent execution... (id: ${blueprintId})`);

      // 阻塞等待 LeadAgent 执行完成
      const result = await ctx.waitForCompletion(session.id);

      // 执行完成，清除活跃 ID
      StartLeadAgentTool.activeExecutionId = null;

      console.log(`[StartLeadAgent] LeadAgent execution completed (success: ${result.success})`);

      if (result.success) {
        // 成功：返回截断后的输出 + 统计
        const raw = result.rawResponse || 'LeadAgent execution completed.';
        const truncated = raw.length > MAX_RAW_RESPONSE_LENGTH
          ? '[...front output truncated]\n\n' + raw.slice(-MAX_RAW_RESPONSE_LENGTH)
          : raw;
        const parts = [truncated];
        if (result.completedCount !== undefined) {
          parts.push(`\n\nExecution stats: completed=${result.completedCount} failed=${result.failedCount || 0} skipped=${result.skippedCount || 0}`);
        }
        return { success: true, output: parts.join('') };
      } else {
        // 失败：返回结构化错误信息供 Planner 决策
        const parts = [
          `LeadAgent execution failed.`,
        ];
        if (result.completedTasks?.length) {
          parts.push(`\nCompleted tasks: ${result.completedTasks.join(', ')}`);
        }
        if (result.failedTasks?.length) {
          parts.push(`\nFailed tasks: ${result.failedTasks.join(', ')}`);
        }
        parts.push(`\nStats: completed=${result.completedCount || 0} failed=${result.failedCount || 0} skipped=${result.skippedCount || 0}`);
        if (result.rawResponse) {
          const truncated = result.rawResponse.length > MAX_RAW_RESPONSE_LENGTH
            ? '[...truncated]\n\n' + result.rawResponse.slice(-MAX_RAW_RESPONSE_LENGTH)
            : result.rawResponse;
          parts.push(`\n\nLeadAgent output:\n${truncated}`);
        }
        parts.push('\n\nSuggestion: Analyze the reasons for failed tasks and re-invoke StartLeadAgent with more detailed descriptions.');
        return { success: false, output: parts.join('') };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[StartLeadAgent] Execution failed:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}
