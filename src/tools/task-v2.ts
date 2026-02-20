/**
 * Task v2 工具
 * 官方 2.1.16 新增的任务管理系统
 *
 * 包含 4 个工具：
 * - TaskCreate: 创建新任务
 * - TaskGet: 获取单个任务
 * - TaskUpdate: 更新任务（支持依赖追踪）
 * - TaskList: 列出所有任务
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import {
  createTask,
  getTask,
  updateTask,
  getAllTasks,
  addDependency,
  getCurrentListId,
  isTasksEnabled,
  VALID_STATUSES,
  type TaskCreateInput,
  type TaskCreateOutput,
  type TaskGetInput,
  type TaskGetOutput,
  type TaskUpdateInput,
  type TaskUpdateOutput,
  type TaskListOutput,
  type TaskStatus,
} from './task-storage.js';

// ============================================================================
// TaskCreate 工具
// ============================================================================

const TASK_CREATE_DESCRIPTION = `Creates a new task in the task management system.

Use this tool to:
- Create tasks for tracking complex multi-step work
- Break down large features into manageable pieces
- Track dependencies between tasks

Each task has:
- subject: A brief title (required)
- description: Detailed description of what needs to be done (required)
- activeForm: Text shown in spinner when in_progress (optional)
- metadata: Arbitrary key-value data (optional)

New tasks start with status "pending" and empty dependency lists.`;

const TASK_CREATE_PROMPT = `When you have a complex task that needs to be broken into smaller pieces, use TaskCreate to create individual tasks. After creating tasks, use TaskUpdate to:
- Change status as you work (pending → in_progress → completed)
- Add dependencies with addBlocks/addBlockedBy

Example workflow:
1. TaskCreate: "Set up database schema"
2. TaskCreate: "Implement API endpoints"
3. TaskCreate: "Write frontend components"
4. TaskUpdate task 2 with addBlockedBy=[task 1 id] (API depends on schema)
5. TaskUpdate task 3 with addBlockedBy=[task 2 id] (frontend depends on API)`;

export class TaskCreateTool extends BaseTool<TaskCreateInput, ToolResult> {
  name = 'TaskCreate';
  description = TASK_CREATE_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'A brief title for the task',
        },
        description: {
          type: 'string',
          description: 'A detailed description of what needs to be done',
        },
        activeForm: {
          type: 'string',
          description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Arbitrary metadata to attach to the task',
        },
      },
      required: ['subject', 'description'],
    };
  }

  async execute(input: TaskCreateInput): Promise<ToolResult> {
    if (!isTasksEnabled()) {
      return {
        success: false,
        error: t('taskV2.disabled'),
      };
    }

    const listId = getCurrentListId();

    const taskId = createTask(listId, {
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: 'pending',
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata: input.metadata,
    });

    const result: TaskCreateOutput = {
      task: {
        id: taskId,
        subject: input.subject,
      },
    };

    return {
      success: true,
      output: t('taskV2.created', { id: taskId, subject: input.subject }),
      data: result,
    };
  }
}

// ============================================================================
// TaskGet 工具
// ============================================================================

const TASK_GET_DESCRIPTION = `Retrieves details of a specific task by its ID.

Returns:
- id: Task identifier
- subject: Brief title
- description: Detailed description
- status: Current status (pending/in_progress/completed)
- blocks: IDs of tasks this task blocks
- blockedBy: IDs of tasks blocking this task

Returns null if task not found.`;

const TASK_GET_PROMPT = `Use TaskGet when you need to:
- Check the current status of a specific task
- See what dependencies a task has
- Review the task description before starting work`;

export class TaskGetTool extends BaseTool<TaskGetInput, ToolResult> {
  name = 'TaskGet';
  description = TASK_GET_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to retrieve',
        },
      },
      required: ['taskId'],
    };
  }

  async execute(input: TaskGetInput): Promise<ToolResult> {
    if (!isTasksEnabled()) {
      return {
        success: false,
        error: t('taskV2.disabled'),
      };
    }

    const listId = getCurrentListId();
    const task = getTask(listId, input.taskId);

    if (!task) {
      const result: TaskGetOutput = { task: null };
      return {
        success: false,
        error: t('taskV2.notFound'),
        data: result,
      };
    }

    const result: TaskGetOutput = {
      task: {
        id: task.id,
        subject: task.subject,
        description: task.description,
        status: task.status,
        blocks: task.blocks,
        blockedBy: task.blockedBy,
      },
    };

    // 格式化输出
    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ];

    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(', ')}`);
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      data: result,
    };
  }
}

// ============================================================================
// TaskUpdate 工具
// ============================================================================

const TASK_UPDATE_DESCRIPTION = `Updates an existing task's properties.

Can update:
- subject: New title
- description: New description
- activeForm: New spinner text
- status: New status (pending/in_progress/completed/deleted)
- addBlocks: Task IDs that this task blocks (dependency tracking)
- addBlockedBy: Task IDs that block this task (dependency tracking)
- owner: Assign task to an owner (for multi-agent scenarios)
- metadata: Merge new metadata (set key to null to delete)

Dependency tracking:
- addBlocks: "This task must complete before tasks X, Y, Z can start"
- addBlockedBy: "This task cannot start until tasks A, B, C complete"

To delete a task, set status to "deleted".`;

const TASK_UPDATE_PROMPT = `Use TaskUpdate to:

1. Change task status as you work:
   - Start work: status="in_progress"
   - Finish work: status="completed"
   - Delete task: status="deleted"

2. Add dependencies:
   - TaskUpdate taskId="2" addBlockedBy=["1"] → Task 2 waits for task 1
   - TaskUpdate taskId="1" addBlocks=["2", "3"] → Task 1 blocks tasks 2 and 3

3. Update task details:
   - Refine description as you learn more
   - Update activeForm for better progress display

4. Delete a task:
   - TaskUpdate taskId="1" status="deleted" → Marks task 1 as deleted`;

export class TaskUpdateTool extends BaseTool<TaskUpdateInput, ToolResult> {
  name = 'TaskUpdate';
  description = TASK_UPDATE_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        subject: {
          type: 'string',
          description: 'New subject for the task',
        },
        description: {
          type: 'string',
          description: 'New description for the task',
        },
        activeForm: {
          type: 'string',
          description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'deleted'],
          description: 'New status for the task. Set to "deleted" to delete the task.',
        },
        addBlocks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that this task blocks',
        },
        addBlockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that block this task',
        },
        owner: {
          type: 'string',
          description: 'New owner for the task',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Metadata keys to merge into the task. Set a key to null to delete it.',
        },
      },
      required: ['taskId'],
    };
  }

  async execute(input: TaskUpdateInput): Promise<ToolResult> {
    if (!isTasksEnabled()) {
      return {
        success: false,
        error: t('taskV2.disabled'),
      };
    }

    const listId = getCurrentListId();
    const task = getTask(listId, input.taskId);

    if (!task) {
      const result: TaskUpdateOutput = {
        success: false,
        taskId: input.taskId,
        updatedFields: [],
        error: t('taskV2.notFound'),
      };
      return {
        success: false,
        error: t('taskV2.notFound'),
        data: result,
      };
    }

    const updatedFields: string[] = [];
    const updates: Partial<typeof task> = {};

    // 更新简单字段
    if (input.subject !== undefined && input.subject !== task.subject) {
      updates.subject = input.subject;
      updatedFields.push('subject');
    }

    if (input.description !== undefined && input.description !== task.description) {
      updates.description = input.description;
      updatedFields.push('description');
    }

    if (input.activeForm !== undefined && input.activeForm !== task.activeForm) {
      updates.activeForm = input.activeForm;
      updatedFields.push('activeForm');
    }

    if (input.owner !== undefined && input.owner !== task.owner) {
      updates.owner = input.owner;
      updatedFields.push('owner');
    }

    // 更新元数据
    if (input.metadata !== undefined) {
      const newMetadata = { ...(task.metadata ?? {}) };
      for (const [key, value] of Object.entries(input.metadata)) {
        if (value === null) {
          delete newMetadata[key];
        } else {
          newMetadata[key] = value;
        }
      }
      updates.metadata = newMetadata;
      updatedFields.push('metadata');
    }

    // 更新状态
    let statusChange: { from: string; to: string } | undefined;
    if (input.status !== undefined && input.status !== task.status) {
      if (!VALID_STATUSES.includes(input.status as TaskStatus)) {
        const result: TaskUpdateOutput = {
          success: false,
          taskId: input.taskId,
          updatedFields: [],
          error: t('taskV2.invalidStatus', { status: input.status, valid: VALID_STATUSES.join(', ') }),
        };
        return {
          success: false,
          error: result.error,
          data: result,
        };
      }
      statusChange = { from: task.status, to: input.status };
      updates.status = input.status as TaskStatus;
      updatedFields.push('status');
    }

    // 应用简单更新
    if (Object.keys(updates).length > 0) {
      updateTask(listId, input.taskId, updates);
    }

    // 处理依赖关系：addBlocks
    if (input.addBlocks && input.addBlocks.length > 0) {
      const newBlocks = input.addBlocks.filter(id => !task.blocks.includes(id));
      for (const blockedId of newBlocks) {
        addDependency(listId, input.taskId, blockedId);
      }
      if (newBlocks.length > 0) {
        updatedFields.push('blocks');
      }
    }

    // 处理依赖关系：addBlockedBy
    if (input.addBlockedBy && input.addBlockedBy.length > 0) {
      const newBlockedBy = input.addBlockedBy.filter(id => !task.blockedBy.includes(id));
      for (const blockerId of newBlockedBy) {
        addDependency(listId, blockerId, input.taskId);
      }
      if (newBlockedBy.length > 0) {
        updatedFields.push('blockedBy');
      }
    }

    const result: TaskUpdateOutput = {
      success: true,
      taskId: input.taskId,
      updatedFields,
      statusChange,
    };

    // 格式化输出
    let output = `Updated task #${input.taskId}`;
    if (updatedFields.length > 0) {
      output += `: ${updatedFields.join(', ')}`;
    }
    if (statusChange) {
      output += ` (${statusChange.from} → ${statusChange.to})`;
    }

    return {
      success: true,
      output,
      data: result,
    };
  }
}

// ============================================================================
// TaskList 工具
// ============================================================================

const TASK_LIST_DESCRIPTION = `Lists all tasks in the current task list.

Returns for each task:
- id: Task identifier
- subject: Brief title
- status: Current status (pending/in_progress/completed)
- owner: Assigned owner (if any)
- blockedBy: IDs of tasks blocking this task

Completed tasks are included but typically filtered when displaying to users.`;

const TASK_LIST_PROMPT = `Use TaskList to:
- Get an overview of all tasks
- Find tasks that are blocked or blocking others
- Check which tasks are in progress vs pending

After TaskList, use TaskGet for detailed information on specific tasks.`;

export class TaskListTool extends BaseTool<Record<string, never>, ToolResult> {
  name = 'TaskList';
  description = TASK_LIST_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(): Promise<ToolResult> {
    if (!isTasksEnabled()) {
      return {
        success: false,
        error: t('taskV2.disabled'),
      };
    }

    const listId = getCurrentListId();
    const allTasks = getAllTasks(listId);

    // 按 ID 排序
    allTasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

    // 过滤已完成任务的 ID 集合（用于显示依赖关系）
    const completedIds = new Set(
      allTasks.filter(t => t.status === 'completed').map(t => t.id)
    );

    const result: TaskListOutput = {
      tasks: allTasks.map(task => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        owner: task.owner,
        blockedBy: task.blockedBy,
      })),
    };

    if (allTasks.length === 0) {
      return {
        success: true,
        output: t('taskV2.noTasks'),
        data: result,
      };
    }

    // 格式化输出
    const lines = ['Tasks:'];
    for (const task of allTasks) {
      let line = `  #${task.id} [${task.status}] ${task.subject}`;

      // 显示未完成的阻塞关系
      const activeBlockers = task.blockedBy.filter(id => !completedIds.has(id));
      if (activeBlockers.length > 0) {
        line += ` (blocked by: ${activeBlockers.map(id => `#${id}`).join(', ')})`;
      }

      if (task.owner) {
        line += ` [owner: ${task.owner}]`;
      }

      lines.push(line);
    }

    // 统计信息
    const pending = allTasks.filter(t => t.status === 'pending').length;
    const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
    const completed = allTasks.filter(t => t.status === 'completed').length;
    lines.push('');
    lines.push(`Summary: ${pending} pending, ${inProgress} in_progress, ${completed} completed`);

    return {
      success: true,
      output: lines.join('\n'),
      data: result,
    };
  }
}
