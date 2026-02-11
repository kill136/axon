/**
 * TriggerE2ETest 工具 - LeadAgent 专用
 *
 * 设计理念：
 * - LeadAgent 在所有任务完成并通过集成检查后，调用此工具触发 E2E 端到端测试
 * - E2E Agent 独立执行浏览器测试，使用 Chrome MCP 工具
 * - 测试结果同步返回给 LeadAgent，LeadAgent 可以根据结果决定是否修复
 * - 形成 LeadAgent ↔ E2E Agent 的双向通信闭环
 *
 * 流程：
 * LeadAgent 调用 TriggerE2ETest → 创建 E2ETestAgent → 等待执行完成 → 返回结果给 LeadAgent
 * LeadAgent 审查结果 → 如果有问题，自己修复或派 Worker 修复 → 再次调用 TriggerE2ETest
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import type { Blueprint, TechStack } from '../blueprint/types.js';
// v4.9: 共享 E2E Agent 注册表，支持用户插嘴
import { registerE2EAgent as registerAgent, unregisterE2EAgent as unregisterAgent } from '../blueprint/e2e-agent-registry.js';

// ============================================================================
// 静态上下文（由 LeadAgent 在启动前设置）
// ============================================================================

interface E2EToolContext {
  blueprint: Blueprint;
  projectPath: string;
  techStack: TechStack;
  /** 事件回调：转发 E2E Agent 的流式事件给前端 */
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  /** 完成回调：通知 LeadAgent 执行完成（用于 Planner 通知） */
  onComplete?: (result: { success: boolean; summary: string }) => void;
}

interface TriggerE2ETestInput {
  /** 应用 URL（默认 http://localhost:3000） */
  appUrl?: string;
  /** 设计图对比相似度阈值 (0-100)，默认 80 */
  similarityThreshold?: number;
  /** 使用的模型（默认 opus） */
  model?: string;
  /** 最大测试时间（毫秒），默认 30 分钟 */
  maxTestDuration?: number;
}

/**
 * TriggerE2ETest 工具
 * LeadAgent 专用，用于触发 E2E 端到端测试并同步等待结果
 */
export class TriggerE2ETestTool extends BaseTool<TriggerE2ETestInput, ToolResult> {
  name = 'TriggerE2ETest';
  description = `触发 E2E 端到端测试（LeadAgent 专用）

## 使用时机
当所有开发任务完成并通过集成检查（构建、单元测试）后，调用此工具启动 E2E 浏览器测试。

## 测试内容
E2E Agent 会自动：
1. 启动应用服务
2. 打开浏览器，按蓝图定义的业务流程验收
3. 对比设计图与实际页面
4. 发现问题尝试自动修复（最多 3 轮）
5. 提交测试报告

## 返回值
E2E 测试的完整结果，包括：
- 通过/失败的测试步骤
- 设计图对比结果
- 修复尝试记录
- 测试摘要

## 后续操作
- 如果测试通过 → 任务完成
- 如果测试失败 → 根据报告修复代码，然后再次调用此工具验证`;

  // 静态上下文
  private static context: E2EToolContext | null = null;

  /**
   * 设置上下文（由 LeadAgent 在启动前调用）
   */
  static setContext(ctx: E2EToolContext): void {
    TriggerE2ETestTool.context = ctx;
  }

  /**
   * 清理上下文
   */
  static clearContext(): void {
    TriggerE2ETestTool.context = null;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        appUrl: {
          type: 'string',
          description: '应用 URL（默认 http://localhost:3000）',
        },
        similarityThreshold: {
          type: 'number',
          description: '设计图对比相似度阈值 (0-100)，默认 80',
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: 'E2E Agent 使用的模型（默认 opus）',
        },
        maxTestDuration: {
          type: 'number',
          description: '最大测试时间（毫秒），默认 1800000（30分钟）',
        },
      },
      required: [],
    };
  }

  async execute(input: TriggerE2ETestInput): Promise<ToolResult> {
    const ctx = TriggerE2ETestTool.context;
    if (!ctx) {
      return {
        success: false,
        output: t('triggerE2E.noContext'),
      };
    }

    const e2eTaskId = `e2e-test-${Date.now()}`;
    const e2eWorkerId = 'e2e-worker';

    // 通知前端 E2E 测试开始
    ctx.onEvent({
      type: 'e2e:started',
      data: {
        blueprintId: ctx.blueprint.id,
        e2eTaskId,
        status: 'running',
        message: t('triggerE2E.starting'),
      },
    });

    try {
      // 动态导入 E2E Agent（避免循环依赖）
      const { createE2ETestAgent } = await import('../blueprint/e2e-test-agent.js');

      const agent = createE2ETestAgent({
        model: (input.model || 'opus') as any,
        similarityThreshold: input.similarityThreshold || 80,
        maxTestDuration: input.maxTestDuration || 1800000,
      });

      // v4.9: 注册 E2E Agent 到共享注册表，支持用户插嘴
      registerAgent(ctx.blueprint.id, agent);

      // 转发 E2E Agent 的流式事件给前端
      agent.on('log', (msg: string) => {
        console.log(`[E2E via LeadAgent] ${msg}`);
      });

      agent.on('stream:text', (data: { content: string }) => {
        ctx.onEvent({
          type: 'worker:stream',
          data: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'text',
            content: data.content,
          },
        });
      });

      agent.on('stream:tool_start', (data: { toolName: string; toolInput: any }) => {
        ctx.onEvent({
          type: 'worker:stream',
          data: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'tool_start',
            toolName: data.toolName,
            toolInput: data.toolInput,
          },
        });
      });

      agent.on('stream:tool_end', (data: { toolName: string; toolInput?: any; toolResult?: string; toolError?: string }) => {
        ctx.onEvent({
          type: 'worker:stream',
          data: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'tool_end',
            toolName: data.toolName,
            toolInput: data.toolInput,
            toolResult: data.toolResult,
            toolError: data.toolError,
          },
        });
      });

      agent.on('stream:system_prompt', (data: any) => {
        ctx.onEvent({
          type: 'worker:stream',
          data: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'system_prompt',
            systemPrompt: data.systemPrompt,
            agentType: 'e2e',
          },
        });
      });

      // 构建 E2E 测试上下文
      const e2eContext = {
        blueprint: ctx.blueprint,
        projectPath: ctx.projectPath,
        techStack: ctx.techStack,
        designImages: ctx.blueprint.designImages || [],
        appUrl: input.appUrl || 'http://localhost:3000',
      };

      // 同步等待 E2E Agent 执行完成
      const result = await agent.execute(e2eContext);

      // v4.9: 执行完成后注销 E2E Agent
      unregisterAgent(ctx.blueprint.id);

      // 通知前端 E2E 测试完成
      ctx.onEvent({
        type: 'e2e:completed',
        data: {
          blueprintId: ctx.blueprint.id,
          e2eTaskId,
          status: result.success ? 'passed' : 'failed',
          result: {
            totalTests: result.passedSteps + result.failedSteps + result.skippedSteps,
            passedTests: result.passedSteps,
            failedTests: result.failedSteps,
            skippedTests: result.skippedSteps,
          },
        },
      });

      // 通知完成回调（用于 Planner 通知）
      ctx.onComplete?.({
        success: result.success,
        summary: result.summary,
      });

      // v10.1: 完全对齐 TaskTool — 直接返回 E2E Agent 的 raw text
      // 与 CLI TaskTool 一致：上级 agent 拿到下级的原始文本输出
      const rawResponse = result.rawResponse || '';
      const output = rawResponse || t('triggerE2E.noOutput', { success: String(result.success) });

      return { success: result.success, output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // v4.9: 异常时也注销 E2E Agent
      unregisterAgent(ctx.blueprint.id);

      // 通知前端 E2E 测试失败
      ctx.onEvent({
        type: 'e2e:completed',
        data: {
          blueprintId: ctx.blueprint.id,
          e2eTaskId,
          status: 'failed',
          error: errorMsg,
        },
      });

      return {
        success: false,
        output: t('triggerE2E.startFailed', { error: errorMsg }),
      };
    }
  }
}
