/**
 * DispatchWorker 工具 - LeadAgent 专用
 *
 * 设计理念：
 * - LeadAgent 通过此工具派发任务给 Worker
 * - LeadAgent 写详细的 brief（上下文简报），替代 50 字摘要
 * - Worker 返回完整结果，LeadAgent 在自己上下文中审查
 * - 跳过独立 Reviewer（LeadAgent 有完整上下文，审查质量更高）
 *
 * v9.0: 蜂群架构 LeadAgent 改造的核心工具
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import type {
  Blueprint,
  SmartTask,
  TaskResult,
  SwarmConfig,
  TechStack,
  DispatchWorkerInput,
} from '../blueprint/types.js';
import {
  AutonomousWorkerExecutor,
  type WorkerContext,
} from '../blueprint/autonomous-worker.js';
import { UpdateTaskPlanTool } from './update-task-plan.js';

// ============================================================================
// 静态上下文（由 LeadAgent 在启动前设置）
// ============================================================================

interface LeadAgentContext {
  blueprint: Blueprint;
  projectPath: string;
  swarmConfig: SwarmConfig;
  techStack: TechStack;
  onTaskEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  onTaskResult: (taskId: string, result: TaskResult) => void;
}

/**
 * DispatchWorker 工具
 * LeadAgent 专用，用于将任务派发给 Worker 并行执行
 */
export class DispatchWorkerTool extends BaseTool<DispatchWorkerInput, ToolResult> {
  name = 'DispatchWorker';
  description = `Dispatch task to Worker for execution (LeadAgent exclusive)

## When to Use
Use this tool when you decide to dispatch an independent task to a Worker.

## Parameters
- taskId: Unique task identifier (you define it, e.g. "task_user_api")
- brief: **Detailed context brief** (this is the most important parameter!)
  - Contains: key info from prerequisite tasks, naming conventions, interface definitions, file paths
  - The more detailed the better, Worker should be able to work directly from the brief without exploring
- targetFiles: List of files expected to be modified
- constraints: Constraints (optional)
- model: Model to use (optional, default sonnet)

## Brief Writing Examples
Good brief:
"Implement user registration API. Database schema is in schema.prisma, User model has id/email/passwordHash/name/createdAt fields.
Route entry is in src/routes/index.ts, please add userRoutes following the authRoutes pattern.
Validation uses zod (already installed). Use camelCase naming, return type ApiResponse<T>.
Error handling uses AppError class from src/middleware/error.ts."

Bad brief:
"Implement user management API"

## Return Value
Complete Worker execution results, including:
- Whether successful
- List of created/modified files
- Whether tests ran and passed
- Worker's complete execution summary`;

  // 静态上下文 - 由 LeadAgent 在启动前设置
  private static context: LeadAgentContext | null = null;

  /**
   * 设置 LeadAgent 上下文（由 LeadAgent 在启动 ConversationLoop 前调用）
   */
  static setLeadAgentContext(ctx: LeadAgentContext): void {
    DispatchWorkerTool.context = ctx;
  }

  /**
   * 清理上下文
   */
  static clearContext(): void {
    DispatchWorkerTool.context = null;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Unique task identifier',
        },
        brief: {
          type: 'string',
          description: 'Detailed context brief written by LeadAgent (the more detailed the better)',
        },
        targetFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files expected to be modified',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints (optional)',
        },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus'],
          description: 'Model to use (optional, default sonnet)',
        },
      },
      required: ['taskId', 'brief', 'targetFiles'],
    };
  }

  async execute(input: DispatchWorkerInput): Promise<ToolResult> {
    const ctx = DispatchWorkerTool.context;
    if (!ctx) {
      return {
        success: false,
        output: t('dispatchWorker.noContext'),
      };
    }

    const { taskId, brief, targetFiles, constraints, model } = input;

    // 构造 SmartTask（用 brief 替代泛泛描述）
    const task: SmartTask = {
      id: taskId,
      name: `Worker Task: ${taskId}`,
      description: brief,  // brief 就是 description
      brief,               // 同时设置 brief 字段
      type: 'code',
      complexity: model === 'opus' ? 'complex' : model === 'haiku' ? 'trivial' : 'moderate',
      category: 'other',
      blueprintId: ctx.blueprint.id,
      files: targetFiles,
      dependencies: [],
      needsTest: false,
      estimatedMinutes: 10,
      status: 'running',
      skipReview: true,     // LeadAgent 模式下跳过独立 Reviewer
      executionMode: 'worker',
    };

    // 创建 Worker
    const worker = new AutonomousWorkerExecutor({
      defaultModel: (model || 'sonnet') as any,
    });

    // 转发 Worker 流式事件（格式需与 websocket.ts 的 worker:stream handler 匹配）
    // v9.3: 添加调试日志
    console.log(`[DispatchWorker] 🔗 Setting up Worker streaming event listener, taskId=${taskId}, workerId=${worker.workerId}`);
    worker.on('stream:thinking', (data: any) => {
      ctx.onTaskEvent({ type: 'worker:stream', data: {
        workerId: data.workerId,
        taskId,
        streamType: 'thinking',
        content: data.content,
      }});
    });
    worker.on('stream:text', (data: any) => {
      console.log(`[DispatchWorker] 📡 stream:text taskId=${taskId}, contentLen=${data.content?.length || 0}`);
      ctx.onTaskEvent({ type: 'worker:stream', data: {
        workerId: data.workerId,
        taskId,
        streamType: 'text',
        content: data.content,
      }});
    });
    worker.on('stream:tool_start', (data: any) => {
      ctx.onTaskEvent({ type: 'worker:stream', data: {
        workerId: data.workerId,
        taskId,
        streamType: 'tool_start',
        toolName: data.toolName,
        toolInput: data.toolInput,
      }});
    });
    worker.on('stream:tool_end', (data: any) => {
      ctx.onTaskEvent({ type: 'worker:stream', data: {
        workerId: data.workerId,
        taskId,
        streamType: 'tool_end',
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolResult: data.toolResult,
        toolError: data.toolError,
      }});
    });
    worker.on('stream:system_prompt', (data: any) => {
      ctx.onTaskEvent({ type: 'worker:stream', data: {
        workerId: data.workerId,
        taskId,
        streamType: 'system_prompt',
        systemPrompt: data.systemPrompt,
        agentType: data.agentType || 'worker',
      }});
    });
    worker.on('task:completed', (data) => {
      ctx.onTaskEvent({ type: 'task:completed', data: { ...data, taskId } });
    });
    worker.on('task:failed', (data) => {
      ctx.onTaskEvent({ type: 'task:failed', data: { ...data, taskId } });
    });

    // 构建 Worker 上下文
    const workerContext: WorkerContext = {
      projectPath: ctx.projectPath,
      techStack: ctx.techStack,
      config: {
        ...ctx.swarmConfig,
        enableReviewer: false,  // LeadAgent 模式下禁用独立 Reviewer
      },
      constraints: constraints || ctx.blueprint.constraints,
      blueprint: {
        id: ctx.blueprint.id,
        name: ctx.blueprint.name,
        description: ctx.blueprint.description,
        requirements: ctx.blueprint.requirements,
        techStack: ctx.blueprint.techStack,
        constraints: ctx.blueprint.constraints,
      },
    };

    // 发射开始事件
    ctx.onTaskEvent({
      type: 'task:started',
      data: {
        taskId,
        workerId: worker.workerId,
        taskName: task.name,
        brief: brief.substring(0, 200),
      },
    });

    // v9.0: 自动更新任务状态 → 前端任务树同步
    UpdateTaskPlanTool.getContext()?.onPlanUpdate({
      action: 'start_task',
      taskId,
      executionMode: 'worker',
    });

    try {
      // v10.2: Worker 执行超时保护
      // 防止 Worker 卡死导致 LeadAgent 永久阻塞
      const workerTimeout = ctx.swarmConfig.workerTimeout || 1800000; // 默认 30 分钟
      const result = await Promise.race([
        worker.execute(task, workerContext),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            // 超时时先 abort Worker，再 reject
            worker.abort();
            reject(new Error(`Worker execution timed out (${Math.round(workerTimeout / 60000)} minutes), forcibly aborted`));
          }, workerTimeout);
        }),
      ]);

      // 保存结果（供前端展示）
      const fullResult: TaskResult = {
        ...result,
        reviewedBy: 'none',
      };
      ctx.onTaskResult(taskId, fullResult);

      // 更新前端任务树
      UpdateTaskPlanTool.getContext()?.onPlanUpdate({
        action: result.success ? 'complete_task' : 'fail_task',
        taskId,
        summary: result.rawResponse?.substring(0, 500) || '',
        error: result.success ? undefined : (result.error || 'Worker execution failed'),
      });

      // v10.1: 完全对齐 TaskTool — 直接返回 Worker 的 raw text
      // 与 CLI TaskTool 的 executeAgentLoop 完全一致：
      //   agent.result = { success: true, output: response }
      // LeadAgent 拿到的就是 Worker AI 的原始文本输出，自行判断成功/失败
      const rawResponse = result.rawResponse || '';

      return {
        success: result.success,
        output: rawResponse || `Worker ${taskId} execution completed, no text output.`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      ctx.onTaskResult(taskId, {
        success: false,
        changes: [],
        decisions: [],
        error: errorMsg,
        reviewedBy: 'none',
      });

      // 更新前端任务树
      UpdateTaskPlanTool.getContext()?.onPlanUpdate({
        action: 'fail_task',
        taskId,
        error: errorMsg,
      });

      return {
        success: false,
        output: t('dispatchWorker.executionError', { taskId, error: errorMsg }),
      };
    }
  }
}
