/**
 * GoalWrite 工具
 * 管理跨会话持久化目标
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import {
  Goal,
  GoalStatus,
  GoalPriority,
  GoalTask,
  GoalTaskStatus,
  loadGoal,
  loadActiveGoals,
  saveGoal,
  getNextGoalId,
  deleteGoal,
} from '../goals/index.js';

/**
 * GoalWrite 工具输入
 */
export interface GoalWriteInput {
  action: 'create' | 'update' | 'complete' | 'abandon' | 'list' | 'pause' | 'resume';
  title?: string;
  description?: string;
  priority?: GoalPriority;
  goalId?: string;
  notes?: string;
  tasks?: Array<{ id?: string; name: string; status?: GoalTaskStatus }>;
  addTasks?: Array<{ name: string }>;
}

export class GoalWriteTool extends BaseTool<GoalWriteInput, ToolResult> {
  name = 'GoalWrite';
  description = `Manage persistent goals that survive across conversations. Goals track long-term objectives and their sub-tasks for the current project. Active goals are automatically loaded at startup so you know what to continue working on.

Use this tool to:
- Create goals when the user starts a significant multi-session project
- Update progress as tasks are completed
- Mark goals as complete or abandoned when done

Do NOT create goals for simple one-off tasks. Only for work that spans multiple conversations.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'complete', 'abandon', 'list', 'pause', 'resume'],
          description: 'The action to perform',
        },
        title: {
          type: 'string',
          description: 'Goal title (required for create)',
        },
        description: {
          type: 'string',
          description: 'Goal description (required for create)',
        },
        priority: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Goal priority (optional, default: medium)',
        },
        goalId: {
          type: 'string',
          description: 'Goal ID (required for update/complete/abandon/pause/resume)',
        },
        notes: {
          type: 'string',
          description: 'Additional notes (optional)',
        },
        tasks: {
          type: 'array',
          description: 'Sub-tasks to update (optional)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Task ID (optional for new tasks)' },
              name: { type: 'string', description: 'Task name' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'skipped'],
                description: 'Task status',
              },
            },
            required: ['name'],
          },
        },
        addTasks: {
          type: 'array',
          description: 'New tasks to add (optional for update)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Task name' },
            },
            required: ['name'],
          },
        },
      },
      required: ['action'],
    };
  }

  async execute(input: GoalWriteInput): Promise<ToolResult> {
    // 获取当前工作目录
    const projectPath = process.cwd();

    switch (input.action) {
      case 'create':
        return this.handleCreate(projectPath, input);
      case 'update':
        return this.handleUpdate(projectPath, input);
      case 'complete':
        return this.handleComplete(projectPath, input);
      case 'abandon':
        return this.handleAbandon(projectPath, input);
      case 'list':
        return this.handleList(projectPath);
      case 'pause':
        return this.handlePause(projectPath, input);
      case 'resume':
        return this.handleResume(projectPath, input);
      default:
        return {
          success: false,
          error: `Unknown action: ${input.action}`,
        };
    }
  }

  /**
   * 创建新目标
   */
  private handleCreate(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.title || !input.description) {
      return {
        success: false,
        error: 'title and description are required for create action',
      };
    }

    const now = new Date().toISOString();
    const goalId = getNextGoalId(projectPath);

    const goal: Goal = {
      id: goalId,
      title: input.title,
      description: input.description,
      status: 'active',
      priority: input.priority || 'medium',
      created: now,
      updated: now,
      project: projectPath,
      tasks: [],
      notes: input.notes || '',
    };

    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal created: ${goalId} - ${input.title}`,
      data: { goalId, title: input.title },
    };
  }

  /**
   * 更新目标
   */
  private handleUpdate(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.goalId) {
      return {
        success: false,
        error: 'goalId is required for update action',
      };
    }

    const goal = loadGoal(projectPath, input.goalId);
    if (!goal) {
      return {
        success: false,
        error: `Goal not found: ${input.goalId}`,
      };
    }

    // 更新字段
    if (input.notes !== undefined) {
      goal.notes = input.notes;
    }

    // 更新任务
    if (input.tasks) {
      for (const taskUpdate of input.tasks) {
        if (taskUpdate.id) {
          // 更新现有任务
          const existingTask = goal.tasks.find(t => t.id === taskUpdate.id);
          if (existingTask) {
            existingTask.name = taskUpdate.name;
            if (taskUpdate.status) {
              existingTask.status = taskUpdate.status;
              if (taskUpdate.status === 'completed') {
                existingTask.completedAt = new Date().toISOString();
              }
            }
          }
        } else {
          // 添加新任务
          const newTaskId = `task-${goal.tasks.length + 1}`;
          goal.tasks.push({
            id: newTaskId,
            name: taskUpdate.name,
            status: taskUpdate.status || 'pending',
          });
        }
      }
    }

    // 添加新任务
    if (input.addTasks) {
      for (const newTask of input.addTasks) {
        const newTaskId = `task-${goal.tasks.length + 1}`;
        goal.tasks.push({
          id: newTaskId,
          name: newTask.name,
          status: 'pending',
        });
      }
    }

    goal.updated = new Date().toISOString();
    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal updated: ${goal.id} - ${goal.title} (${goal.tasks.length} tasks)`,
      data: { goalId: goal.id, title: goal.title, taskCount: goal.tasks.length },
    };
  }

  /**
   * 完成目标
   */
  private handleComplete(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.goalId) {
      return {
        success: false,
        error: 'goalId is required for complete action',
      };
    }

    const goal = loadGoal(projectPath, input.goalId);
    if (!goal) {
      return {
        success: false,
        error: `Goal not found: ${input.goalId}`,
      };
    }

    goal.status = 'completed';
    goal.updated = new Date().toISOString();
    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal completed: ${goal.id} - ${goal.title}`,
      data: { goalId: goal.id, title: goal.title, status: 'completed' },
    };
  }

  /**
   * 放弃目标
   */
  private handleAbandon(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.goalId) {
      return {
        success: false,
        error: 'goalId is required for abandon action',
      };
    }

    const goal = loadGoal(projectPath, input.goalId);
    if (!goal) {
      return {
        success: false,
        error: `Goal not found: ${input.goalId}`,
      };
    }

    goal.status = 'abandoned';
    goal.updated = new Date().toISOString();
    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal abandoned: ${goal.id} - ${goal.title}`,
      data: { goalId: goal.id, title: goal.title, status: 'abandoned' },
    };
  }

  /**
   * 列出所有活跃目标
   */
  private handleList(projectPath: string): ToolResult {
    const goals = loadActiveGoals(projectPath);

    if (goals.length === 0) {
      return {
        success: true,
        output: 'No active goals found',
        data: { goals: [] },
      };
    }

    // 按优先级排序
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    goals.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const summary = goals
      .map(g => {
        const completedTasks = g.tasks.filter(t => t.status === 'completed').length;
        return `- ${g.id}: ${g.title} [${g.priority.toUpperCase()}] (${completedTasks}/${g.tasks.length} tasks, ${g.status})`;
      })
      .join('\n');

    return {
      success: true,
      output: `Active goals:\n${summary}`,
      data: { goals },
    };
  }

  /**
   * 暂停目标
   */
  private handlePause(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.goalId) {
      return {
        success: false,
        error: 'goalId is required for pause action',
      };
    }

    const goal = loadGoal(projectPath, input.goalId);
    if (!goal) {
      return {
        success: false,
        error: `Goal not found: ${input.goalId}`,
      };
    }

    goal.status = 'paused';
    goal.updated = new Date().toISOString();
    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal paused: ${goal.id} - ${goal.title}`,
      data: { goalId: goal.id, title: goal.title, status: 'paused' },
    };
  }

  /**
   * 恢复目标
   */
  private handleResume(projectPath: string, input: GoalWriteInput): ToolResult {
    if (!input.goalId) {
      return {
        success: false,
        error: 'goalId is required for resume action',
      };
    }

    const goal = loadGoal(projectPath, input.goalId);
    if (!goal) {
      return {
        success: false,
        error: `Goal not found: ${input.goalId}`,
      };
    }

    goal.status = 'active';
    goal.updated = new Date().toISOString();
    saveGoal(projectPath, goal);

    return {
      success: true,
      output: `Goal resumed: ${goal.id} - ${goal.title}`,
      data: { goalId: goal.id, title: goal.title, status: 'active' },
    };
  }
}
