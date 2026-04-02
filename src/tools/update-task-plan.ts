/**
 * UpdateTaskPlan 工具 - LeadAgent 专用
 *
 * v9.0: LeadAgent 动态更新执行计划中的任务状态
 *
 * 核心功能：
 * - start_task:    标记任务开始执行（自己做或即将派给Worker）
 * - complete_task:  标记任务完成
 * - fail_task:      标记任务失败
 * - skip_task:      跳过不合理的任务
 * - add_task:       动态新增任务到执行计划
 *
 * 事件链路：
 * UpdateTaskPlan.execute() → 静态回调 → LeadAgent.emit('task:plan_update')
 * → Coordinator 更新 currentPlan.tasks → emit swarm:task_update → WebSocket → 前端
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import type {
  TaskPlanUpdateInput,
  TaskPlanContext,
} from '../blueprint/types.js';

/**
 * UpdateTaskPlan 工具
 * LeadAgent 专用，用于动态更新执行计划中的任务状态
 */
export class UpdateTaskPlanTool extends BaseTool<TaskPlanUpdateInput, ToolResult> {
  name = 'UpdateTaskPlan';
  description = `Update task status in execution plan (LeadAgent exclusive)

## When to Use
When you start executing, complete, or skip a task, call this tool to sync status to the frontend.

## Operation Types

### start_task - Mark task as started
When to call: Before you begin executing a task yourself
\`\`\`json
{ "action": "start_task", "taskId": "task_1", "executionMode": "lead-agent" }
\`\`\`
Note: When using DispatchWorker to dispatch tasks, there is **no need** to manually call start_task, DispatchWorker will automatically update status.

### complete_task - Mark task as completed
When to call: After you finish executing a task yourself
\`\`\`json
{ "action": "complete_task", "taskId": "task_1", "summary": "Completed database schema design..." }
\`\`\`
Note: DispatchWorker will automatically mark completion, no manual call needed.

### fail_task - Mark task as failed
\`\`\`json
{ "action": "fail_task", "taskId": "task_1", "error": "Dependency installation failed" }
\`\`\`

### skip_task - Skip task
\`\`\`json
{ "action": "skip_task", "taskId": "task_3", "reason": "Upon exploration, found this feature already exists" }
\`\`\`

### add_task - Dynamically add task
When to call: After exploring codebase and discovering additional tasks needed
\`\`\`json
{
  "action": "add_task",
  "taskId": "task_new_migration",
  "name": "Database migration script",
  "description": "Found that a new database migration is needed...",
  "complexity": "simple",
  "type": "code",
  "files": ["src/migrations/001.ts"]
}
\`\`\``;

  // 静态上下文 - 由 LeadAgent 在启动前设置
  private static context: TaskPlanContext | null = null;

  /**
   * 设置任务计划上下文（由 LeadAgent 在启动 ConversationLoop 前调用）
   */
  static setContext(ctx: TaskPlanContext): void {
    UpdateTaskPlanTool.context = ctx;
  }

  /**
   * 获取当前上下文（供 DispatchWorker 等其他工具调用）
   */
  static getContext(): TaskPlanContext | null {
    return UpdateTaskPlanTool.context;
  }

  /**
   * 清理上下文
   */
  static clearContext(): void {
    UpdateTaskPlanTool.context = null;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start_task', 'complete_task', 'fail_task', 'skip_task', 'add_task'],
          description: 'Operation type',
        },
        taskId: {
          type: 'string',
          description: 'Task ID (ID from ExecutionPlan, or custom new ID for add_task)',
        },
        executionMode: {
          type: 'string',
          enum: ['worker', 'lead-agent'],
          description: 'Execution mode (specified for start_task, indicates self-execution or dispatched to Worker)',
        },
        summary: {
          type: 'string',
          description: 'Completion summary (used for complete_task)',
        },
        error: {
          type: 'string',
          description: 'Error message (used for fail_task)',
        },
        reason: {
          type: 'string',
          description: 'Skip reason (used for skip_task)',
        },
        name: {
          type: 'string',
          description: 'New task name (used for add_task)',
        },
        description: {
          type: 'string',
          description: 'New task description (used for add_task)',
        },
        complexity: {
          type: 'string',
          enum: ['trivial', 'simple', 'moderate', 'complex'],
          description: 'New task complexity (used for add_task)',
        },
        type: {
          type: 'string',
          enum: ['code', 'config', 'test', 'refactor', 'docs', 'integrate', 'verify'],
          description: 'New task type (used for add_task)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Expected files to modify for new task (used for add_task)',
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Other task IDs that the new task depends on (used for add_task)',
        },
      },
      required: ['action', 'taskId'],
    };
  }

  async execute(input: TaskPlanUpdateInput): Promise<ToolResult> {
    const ctx = UpdateTaskPlanTool.context;
    if (!ctx) {
      return {
        success: false,
        output: t('taskPlan.noContext'),
      };
    }

    const { action, taskId } = input;

    // 验证 taskId（add_task 除外，因为是新 ID）
    if (action !== 'add_task') {
      const taskExists = ctx.executionPlan.tasks.some(tt => tt.id === taskId);
      if (!taskExists) {
        return {
          success: false,
          output: t('taskPlan.taskNotFound', { taskId, availableIds: ctx.executionPlan.tasks.map(tt => tt.id).join(', ') }),
        };
      }
    }

    // 验证 add_task 必要参数
    if (action === 'add_task' && !input.name) {
      return {
        success: false,
        output: t('taskPlan.addTaskNameRequired'),
      };
    }

    // 调用回调 → LeadAgent → Coordinator → 前端
    ctx.onPlanUpdate(input);

    // 返回确认信息
    switch (action) {
      case 'start_task':
        return {
          success: true,
          output: t('taskPlan.statusRunning', { taskId }),
        };
      case 'complete_task':
        return {
          success: true,
          output: t('taskPlan.statusCompleted', { taskId }),
        };
      case 'fail_task':
        return {
          success: true,
          output: t('taskPlan.statusFailed', { taskId, reason: input.error || 'unknown' }),
        };
      case 'skip_task':
        return {
          success: true,
          output: t('taskPlan.statusSkipped', { taskId }),
        };
      case 'add_task':
        return {
          success: true,
          output: t('taskPlan.statusPending', { taskId }),
        };
      default:
        return {
          success: false,
          output: `Unknown action: ${action}`,
        };
    }
  }
}
