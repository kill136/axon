/**
 * Todo 工具
 * 任务管理
 */

import { BaseTool } from './base.js';
import type { TodoWriteInput, TodoItem, ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';

// 官方常量：自动提醒配置
const TODO_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 7,       // 自上次使用 TodoWrite 以来的回合数
  TURNS_BETWEEN_REMINDERS: 3, // 提醒之间的最少回合数
};

// 全局 Todo 存储（按 agentId 分组）
const todosStorage: Record<string, TodoItem[]> = {};

// 默认 agentId（当前项目没有 multi-agent 系统）
const DEFAULT_AGENT_ID = 'main';

/**
 * 获取指定 agentId 的 todos
 */
export function getTodos(agentId: string = DEFAULT_AGENT_ID): TodoItem[] {
  return [...(todosStorage[agentId] || [])];
}

/**
 * 设置指定 agentId 的 todos
 */
export function setTodos(todos: TodoItem[], agentId: string = DEFAULT_AGENT_ID): void {
  todosStorage[agentId] = [...todos];
}

/**
 * 计算自上次使用 TodoWrite 以来的回合数（官方 ax5 函数）
 * @param messages 消息历史
 * @returns 回合数统计
 */
function calculateTurnsSinceTodoWrite(messages: any[]): {
  turnsSinceLastTodoWrite: number;
  turnsSinceLastReminder: number;
} {
  let lastTodoWriteIndex = -1;
  let lastReminderIndex = -1;
  let turnsSinceLastTodoWrite = 0;
  let turnsSinceLastReminder = 0;

  // 从最新消息向前遍历
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // 计数助手回合
    if (msg?.type === 'assistant') {
      // 跳过被中断的消息
      if (msg.interrupted) continue;

      if (lastTodoWriteIndex === -1) {
        turnsSinceLastTodoWrite++;
      }
      if (lastReminderIndex === -1) {
        turnsSinceLastReminder++;
      }

      // 查找 TodoWrite 工具使用
      if (
        lastTodoWriteIndex === -1 &&
        'message' in msg &&
        Array.isArray(msg.message?.content)
      ) {
        const hasTodoWrite = msg.message.content.some(
          (block: any) => block.type === 'tool_use' && block.name === 'TodoWrite'
        );
        if (hasTodoWrite) {
          lastTodoWriteIndex = i;
        }
      }
    }
    // 查找提醒附件
    else if (
      lastReminderIndex === -1 &&
      msg?.type === 'attachment' &&
      msg.attachment?.type === 'todo_reminder'
    ) {
      lastReminderIndex = i;
    }

    // 如果两个都找到了，可以提前退出
    if (lastTodoWriteIndex !== -1 && lastReminderIndex !== -1) {
      break;
    }
  }

  return {
    turnsSinceLastTodoWrite,
    turnsSinceLastReminder,
  };
}

/**
 * 生成 todo 提醒附件（官方 ox5 函数）
 * @param messages 消息历史
 * @param agentId Agent ID
 * @returns 提醒附件数组
 */
export function generateTodoReminder(
  messages: any[],
  agentId: string = DEFAULT_AGENT_ID
): any[] {
  if (!messages || messages.length === 0) {
    return [];
  }

  const { turnsSinceLastTodoWrite, turnsSinceLastReminder } =
    calculateTurnsSinceTodoWrite(messages);

  // 检查是否需要提醒
  if (
    turnsSinceLastTodoWrite >= TODO_REMINDER_CONFIG.TURNS_SINCE_WRITE &&
    turnsSinceLastReminder >= TODO_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
  ) {
    const currentTodos = getTodos(agentId);

    // 生成提醒消息
    let reminderMessage = `The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user`;

    // 如果有现有的 todos，添加到提醒中
    if (currentTodos.length > 0) {
      const todoList = currentTodos
        .map((todo, idx) => `${idx + 1}. [${todo.status}] ${todo.content}`)
        .join('\n');

      reminderMessage += `\n\nHere are the existing contents of your todo list:\n\n[${todoList}]`;
    }

    return [
      {
        type: 'todo_reminder',
        content: currentTodos,
        itemCount: currentTodos.length,
      },
    ];
  }

  return [];
}

export class TodoWriteTool extends BaseTool<TodoWriteInput, ToolResult> {
  name = 'TodoWrite';
  description = `Create and manage a structured task list for your current coding session. Helps track progress and give the user visibility into your work.

## When to Use
- Complex multi-step tasks (3+ distinct steps)
- User provides multiple tasks (numbered or comma-separated)
- User explicitly requests a todo list
- Non-trivial tasks requiring planning

## When NOT to Use
- Single, straightforward task
- Trivial task completable in <3 steps
- Purely conversational or informational request

## Task States
- pending: Not yet started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Finished successfully

## Rules
- Each task needs both content (imperative: "Run tests") and activeForm (continuous: "Running tests")
- Mark tasks complete IMMEDIATELY after finishing (don't batch)
- Only ONE task can be in_progress at any time
- ONLY mark completed when FULLY accomplished (not if tests failing, partial implementation, or unresolved errors)
- When all tasks are completed, the list auto-clears
- Remove tasks that are no longer relevant
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The updated todo list',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                minLength: 1,
                description: 'Task description',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Task status',
              },
              activeForm: {
                type: 'string',
                minLength: 1,
                description: 'Present continuous form (e.g., "Running tests")',
              },
            },
            required: ['content', 'status', 'activeForm'],
          },
        },
      },
      required: ['todos'],
    };
  }

  async execute(input: TodoWriteInput, context?: any): Promise<ToolResult> {
    const { todos } = input;

    // 获取 agentId（如果有的话）
    const agentId = context?.agentId || DEFAULT_AGENT_ID;

    // 验证任务：只能有一个 in_progress
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 1) {
      return {
        success: false,
        error: t('todo.onlyOneInProgress'),
      };
    }

    // 获取旧的 todos
    const oldTodos = getTodos(agentId);

    // 官方逻辑：如果全部完成，自动清空 todos
    const newTodos = todos.every((t) => t.status === 'completed') ? [] : todos;

    // 保存 todos（按 agentId 分组）
    setTodos(newTodos, agentId);

    // 返回官方格式：{ data: { oldTodos, newTodos } }
    return {
      success: true,
      output: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable',
      data: {
        oldTodos,
        newTodos: todos, // 注意：这里返回原始输入的 todos，而不是 newTodos
      },
    };
  }
}
