/**
 * StartLeadAgent 工具 - Planner Agent (Chat Tab) 专用
 *
 * v11.0: 自包含执行（对齐 Task/DispatchWorker 模式）
 *
 * 设计理念：
 * - Planner Agent 生成 Blueprint 后，调用此工具启动 LeadAgent
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

export interface StartLeadAgentInput {
  blueprintId: string;
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
  /** 启动执行，返回 { sessionId } */
  startExecution: (blueprint: Blueprint) => Promise<{ id: string }>;
  /** 阻塞等待执行完成 */
  waitForCompletion: (sessionId: string) => Promise<{
    success: boolean;
    rawResponse?: string;
  }>;
  /** 通知前端导航到 SwarmConsole（可选） */
  navigateToSwarm?: (blueprintId: string, executionId: string) => void;
}

/**
 * StartLeadAgent 工具
 * Planner Agent 专用，启动 LeadAgent 执行蓝图并等待完成
 */
export class StartLeadAgentTool extends BaseTool<StartLeadAgentInput, ToolResult> {
  name = 'StartLeadAgent';
  description = `启动 LeadAgent 执行蓝图中的开发任务（阻塞等待完成）

## 使用时机
蓝图生成后（GenerateBlueprint 返回 blueprintId），用户确认要开始执行时调用。

## 参数说明
- blueprintId: 蓝图 ID（GenerateBlueprint 返回的 ID）
- model: LeadAgent 使用的模型（可选，默认 sonnet）

## 执行方式
- 调用后会**阻塞等待** LeadAgent 完整执行完成
- 执行期间用户可切换到 SwarmConsole（蜂群面板）查看实时进度
- LeadAgent 会自动：探索代码 → 规划任务 → 执行/派发 Worker → 集成检查 → E2E 测试

## 返回值
执行完成后返回详细报告，包括：
- 完成/失败/跳过的任务列表
- 执行耗时和结果摘要
- 你可以根据报告决定后续操作（向用户汇报、修复问题等）`;

  // 静态上下文 - 由 ConversationManager 在启动 ConversationLoop 前设置
  private static context: StartLeadAgentContext | null = null;

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
  }

  /**
   * 获取当前上下文（供外部检查）
   */
  static getContext(): StartLeadAgentContext | null {
    return StartLeadAgentTool.context;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        blueprintId: {
          type: 'string',
          description: '蓝图 ID（GenerateBlueprint 返回的 ID）',
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: '使用的模型（可选，默认 sonnet）',
        },
      },
      required: ['blueprintId'],
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

    const { blueprintId } = input;

    try {
      // 1. 获取蓝图
      const blueprint = ctx.getBlueprint(blueprintId);
      if (!blueprint) {
        return { success: false, error: `蓝图 ${blueprintId} 不存在` };
      }

      // 2. 启动执行
      const session = await ctx.startExecution(blueprint);

      // 3. 通知前端导航到 SwarmConsole 查看实时进度
      ctx.navigateToSwarm?.(blueprintId, session.id);

      console.log(`[StartLeadAgent] 阻塞等待 LeadAgent 执行完成... (blueprintId: ${blueprintId})`);

      // 4. 阻塞等待 LeadAgent 执行完成
      const result = await ctx.waitForCompletion(session.id);

      console.log(`[StartLeadAgent] LeadAgent 执行完成 (success: ${result.success})`);

      // 5. 返回结果（对齐 TaskTool — 直接返回 LeadAgent 的 raw text）
      const rawResponse = result.rawResponse || '';
      const output = rawResponse || `LeadAgent 执行完成，无文本输出。(success: ${result.success})`;

      return { success: result.success, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[StartLeadAgent] 执行失败:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}
