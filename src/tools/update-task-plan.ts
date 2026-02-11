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
  description = `更新执行计划中的任务状态（LeadAgent 专用）

## 使用时机
当你开始执行、完成、跳过一个任务时，调用此工具同步状态到前端。

## 操作类型

### start_task - 标记任务开始
调用时机：你开始自己执行某个任务之前
\`\`\`json
{ "action": "start_task", "taskId": "task_1", "executionMode": "lead-agent" }
\`\`\`
注意：使用 DispatchWorker 派发任务时**无需**手动调用 start_task，DispatchWorker 会自动更新状态。

### complete_task - 标记任务完成
调用时机：你自己执行完一个任务后
\`\`\`json
{ "action": "complete_task", "taskId": "task_1", "summary": "完成了数据库schema设计..." }
\`\`\`
注意：DispatchWorker 完成后会自动标记，无需手动调用。

### fail_task - 标记任务失败
\`\`\`json
{ "action": "fail_task", "taskId": "task_1", "error": "依赖安装失败" }
\`\`\`

### skip_task - 跳过任务
\`\`\`json
{ "action": "skip_task", "taskId": "task_3", "reason": "经探索发现此功能已存在" }
\`\`\`

### add_task - 动态新增任务
调用时机：探索代码库后发现需要额外任务
\`\`\`json
{
  "action": "add_task",
  "taskId": "task_new_migration",
  "name": "数据库迁移脚本",
  "description": "发现需要新增数据库迁移...",
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
          description: '操作类型',
        },
        taskId: {
          type: 'string',
          description: '任务 ID（ExecutionPlan 中的 ID，或 add_task 时自定义新 ID）',
        },
        executionMode: {
          type: 'string',
          enum: ['worker', 'lead-agent'],
          description: '执行模式（start_task 时指定，标记是自己做还是派给Worker）',
        },
        summary: {
          type: 'string',
          description: '完成摘要（complete_task 时使用）',
        },
        error: {
          type: 'string',
          description: '错误信息（fail_task 时使用）',
        },
        reason: {
          type: 'string',
          description: '跳过原因（skip_task 时使用）',
        },
        name: {
          type: 'string',
          description: '新任务名称（add_task 时使用）',
        },
        description: {
          type: 'string',
          description: '新任务描述（add_task 时使用）',
        },
        complexity: {
          type: 'string',
          enum: ['trivial', 'simple', 'moderate', 'complex'],
          description: '新任务复杂度（add_task 时使用）',
        },
        type: {
          type: 'string',
          enum: ['code', 'config', 'test', 'refactor', 'docs', 'integrate', 'verify'],
          description: '新任务类型（add_task 时使用）',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '新任务预期修改文件（add_task 时使用）',
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: '新任务依赖的其他任务 ID（add_task 时使用）',
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
          output: t('blueprint.unknownAction', { action }),
        };
    }
  }
}
