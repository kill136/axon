/**
 * ScheduleTask 工具
 * 允许模型在对话中动态创建、取消、列出定时任务
 * 任务由 daemon 进程执行，结果通过桌面通知或飞书推送
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { TaskStore, type ScheduledTask } from '../daemon/store.js';
import { parseTimeExpression } from '../daemon/time-parser.js';

interface ScheduleTaskInput {
  action: 'create' | 'cancel' | 'list';

  // create 参数
  name?: string;
  type?: 'once' | 'interval' | 'watch';
  triggerAt?: string;
  intervalMs?: number;
  watchPaths?: string[];
  watchEvents?: string[];
  debounceMs?: number;
  prompt?: string;
  notify?: ('desktop' | 'feishu')[];
  feishuChatId?: string;
  model?: string;

  // cancel 参数
  taskId?: string;
}

export class ScheduleTaskTool extends BaseTool<ScheduleTaskInput> {
  name = 'ScheduleTask';
  description = 'Create, cancel, or list scheduled tasks. Tasks are executed by the daemon process and results are sent via desktop notification or Feishu. The daemon must be running (claude daemon start) for tasks to execute.';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'cancel', 'list'],
          description: 'Action to perform.',
        },
        name: {
          type: 'string',
          description: 'Human-readable name for the task (required for create).',
        },
        type: {
          type: 'string',
          enum: ['once', 'interval', 'watch'],
          description: 'Task type: once (one-time), interval (recurring), watch (file monitoring). Required for create.',
        },
        triggerAt: {
          type: 'string',
          description: 'When to trigger (for type=once). Supports ISO 8601 ("2026-02-14T08:00:00"), relative ("in 30 minutes", "in 2 hours"), or natural ("tomorrow 08:00", "today 15:30").',
        },
        intervalMs: {
          type: 'number',
          description: 'Interval in milliseconds (for type=interval).',
        },
        watchPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to watch (for type=watch). e.g. ["./src/**/*.ts"]',
        },
        watchEvents: {
          type: 'array',
          items: { type: 'string' },
          description: 'File events to watch: change, add, unlink (for type=watch). Default: ["change"].',
        },
        debounceMs: {
          type: 'number',
          description: 'Debounce in milliseconds (for type=watch). Default: 2000.',
        },
        prompt: {
          type: 'string',
          description: 'The AI prompt to execute when the task triggers. Use {{file}} as template variable for watch tasks. Required for create.',
        },
        notify: {
          type: 'array',
          items: { type: 'string', enum: ['desktop', 'feishu'] },
          description: 'Notification channels. Default: ["desktop"].',
        },
        feishuChatId: {
          type: 'string',
          description: 'Feishu chat_id for notification (optional, uses default if not specified).',
        },
        model: {
          type: 'string',
          description: 'Model to use for prompt execution. Default: sonnet.',
        },
        taskId: {
          type: 'string',
          description: 'Task ID to cancel (required for action=cancel).',
        },
      },
      required: ['action'],
    };
  }

  async execute(input: ScheduleTaskInput): Promise<ToolResult> {
    const store = new TaskStore();

    switch (input.action) {
      case 'create':
        return this.handleCreate(store, input);
      case 'cancel':
        return this.handleCancel(store, input);
      case 'list':
        return this.handleList(store);
      default:
        return { success: false, output: `Unknown action: ${input.action}. Use create, cancel, or list.` };
    }
  }

  private handleCreate(store: TaskStore, input: ScheduleTaskInput): ToolResult {
    // 校验必填参数
    if (!input.name) {
      return { success: false, output: 'Error: "name" is required for create action.' };
    }
    if (!input.type) {
      return { success: false, output: 'Error: "type" is required for create action. Use once, interval, or watch.' };
    }
    if (!input.prompt) {
      return { success: false, output: 'Error: "prompt" is required for create action.' };
    }

    let triggerAt: number | undefined;
    if (input.type === 'once') {
      if (!input.triggerAt) {
        return { success: false, output: 'Error: "triggerAt" is required for type=once.' };
      }
      try {
        triggerAt = parseTimeExpression(input.triggerAt);
      } catch (err) {
        return { success: false, output: `Error parsing time: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    if (input.type === 'interval') {
      if (!input.intervalMs || input.intervalMs <= 0) {
        return { success: false, output: 'Error: "intervalMs" must be a positive number for type=interval.' };
      }
    }

    if (input.type === 'watch') {
      if (!input.watchPaths || input.watchPaths.length === 0) {
        return { success: false, output: 'Error: "watchPaths" is required for type=watch.' };
      }
    }

    const task = store.addTask({
      type: input.type,
      name: input.name,
      triggerAt,
      intervalMs: input.intervalMs,
      watchPaths: input.watchPaths,
      watchEvents: input.watchEvents || ['change'],
      debounceMs: input.debounceMs || 2000,
      prompt: input.prompt,
      notify: input.notify || ['desktop'],
      feishuChatId: input.feishuChatId,
      createdBy: 'conversation',
      workingDir: process.cwd(),
      model: input.model,
      enabled: true,
    });

    // 通知 daemon 热加载
    store.signalReload();

    let details = `Task created: "${task.name}" (ID: ${task.id})\n`;
    details += `Type: ${task.type}\n`;
    if (task.type === 'once' && task.triggerAt) {
      details += `Trigger at: ${new Date(task.triggerAt).toLocaleString()}\n`;
    }
    if (task.type === 'interval' && task.intervalMs) {
      details += `Interval: ${task.intervalMs}ms (${Math.round(task.intervalMs / 60000)} min)\n`;
    }
    if (task.type === 'watch' && task.watchPaths) {
      details += `Watch: ${task.watchPaths.join(', ')}\n`;
    }
    details += `Notify: ${task.notify.join(', ')}\n`;
    details += `\nNote: The daemon must be running ("claude daemon start") for this task to execute.`;

    return { success: true, output: details };
  }

  private handleCancel(store: TaskStore, input: ScheduleTaskInput): ToolResult {
    if (!input.taskId) {
      return { success: false, output: 'Error: "taskId" is required for cancel action.' };
    }

    const removed = store.removeTask(input.taskId);
    if (removed) {
      store.signalReload();
      return { success: true, output: `Task ${input.taskId} cancelled successfully.` };
    } else {
      return { success: false, output: `Task ${input.taskId} not found.` };
    }
  }

  private handleList(store: TaskStore): ToolResult {
    const tasks = store.listTasks();

    if (tasks.length === 0) {
      return { success: true, output: 'No scheduled tasks.' };
    }

    const lines = tasks.map((t) => {
      let info = `- [${t.type}] "${t.name}" (ID: ${t.id})`;
      if (t.type === 'once' && t.triggerAt) {
        info += `\n  Trigger: ${new Date(t.triggerAt).toLocaleString()}`;
      }
      if (t.type === 'interval' && t.intervalMs) {
        info += `\n  Every: ${Math.round(t.intervalMs / 60000)} min`;
      }
      if (t.type === 'watch' && t.watchPaths) {
        info += `\n  Watch: ${t.watchPaths.join(', ')}`;
      }
      info += `\n  Prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? '...' : ''}`;
      info += `\n  Notify: ${t.notify.join(', ')}`;
      info += `\n  Enabled: ${t.enabled}`;
      return info;
    });

    return { success: true, output: `Scheduled tasks (${tasks.length}):\n\n${lines.join('\n\n')}` };
  }
}
