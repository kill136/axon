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
  description = `启动 LeadAgent 执行开发任务（阻塞等待完成）

## 使用时机
两种模式：
1. **蓝图模式**：GenerateBlueprint 返回 blueprintId 后调用
2. **TaskPlan 模式**：直接传入任务列表，无需完整蓝图（适合中等复杂度任务）

## 参数说明
- blueprintId: 蓝图 ID（与 taskPlan 二选一）
- taskPlan: 轻量级任务计划（与 blueprintId 二选一）
  - goal: 总体目标
  - context: 上下文说明
  - tasks: 任务列表（每个任务有 id, name, description）
  - constraints: 约束条件（可选）
  - acceptanceCriteria: 验收标准（可选）
- model: LeadAgent 使用的模型（可选，默认 sonnet）

## 执行方式
- 调用后会**阻塞等待** LeadAgent 完整执行完成
- 执行期间用户可切换到 SwarmConsole（蜂群面板）查看实时进度
- LeadAgent 会自动：探索代码 → 规划任务 → 执行/派发 Worker → 集成检查

## 返回值
执行完成后返回详细报告，包括：
- 完成/失败/跳过的任务列表和统计
- LeadAgent 的完整输出
- 失败时包含具体失败任务和建议
- 你可以根据报告决定后续操作（向用户汇报、修复问题等）`;

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
          description: '蓝图 ID（与 taskPlan 二选一）',
        },
        taskPlan: {
          type: 'object',
          description: '轻量级任务计划（与 blueprintId 二选一）',
          properties: {
            goal: { type: 'string', description: '总体目标' },
            context: { type: 'string', description: '上下文说明' },
            tasks: {
              type: 'array',
              description: '任务列表',
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
          description: '使用的模型（可选，默认 sonnet）',
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
        output: 'StartLeadAgent 工具未配置执行上下文。请在 Web 聊天界面中使用。',
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
          return { success: false, error: `蓝图 ${input.blueprintId} 不存在` };
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
        return { success: false, error: '请提供 blueprintId 或 taskPlan' };
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
        const raw = result.rawResponse || 'LeadAgent 执行完成。';
        const truncated = raw.length > MAX_RAW_RESPONSE_LENGTH
          ? '[...前部输出已截断]\n\n' + raw.slice(-MAX_RAW_RESPONSE_LENGTH)
          : raw;
        const parts = [truncated];
        if (result.completedCount !== undefined) {
          parts.push(`\n\n执行统计: 完成=${result.completedCount} 失败=${result.failedCount || 0} 跳过=${result.skippedCount || 0}`);
        }
        return { success: true, output: parts.join('') };
      } else {
        // 失败：返回结构化错误信息供 Planner 决策
        const parts = [
          `LeadAgent 执行失败。`,
        ];
        if (result.completedTasks?.length) {
          parts.push(`\n已完成的任务: ${result.completedTasks.join(', ')}`);
        }
        if (result.failedTasks?.length) {
          parts.push(`\n失败的任务: ${result.failedTasks.join(', ')}`);
        }
        parts.push(`\n统计: 完成=${result.completedCount || 0} 失败=${result.failedCount || 0} 跳过=${result.skippedCount || 0}`);
        if (result.rawResponse) {
          const truncated = result.rawResponse.length > MAX_RAW_RESPONSE_LENGTH
            ? '[...已截断]\n\n' + result.rawResponse.slice(-MAX_RAW_RESPONSE_LENGTH)
            : result.rawResponse;
          parts.push(`\n\nLeadAgent 输出:\n${truncated}`);
        }
        parts.push('\n\n建议: 分析失败任务的原因，用更详细的描述重新调用 StartLeadAgent 委派。');
        return { success: false, output: parts.join('') };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[StartLeadAgent] Execution failed:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}
