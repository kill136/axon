/**
 * ScheduleTask 工具
 * 允许模型在对话中动态创建、取消、列出定时任务
 * 任务由 daemon 进程执行，结果通过桌面通知或飞书推送
 *
 * 特性：
 * - once 类型任务如果触发时间在 10 分钟内，会自动在当前会话内等待执行
 * - 支持 watch action 查看历史执行日志
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { t } from '../i18n/index.js';
import { fromMsysPath } from '../utils/platform.js';
import { TaskStore, type ScheduledTask } from '../daemon/store.js';
import { parseTimeExpression } from '../daemon/time-parser.js';
import { appendRunLog, readRunLogEntries } from '../daemon/run-log.js';
import { snapshotAuthCredentials } from '../auth/snapshot.js';

/** once 类型任务自动在会话内执行的最大等待时间（10 分钟） */
const INLINE_WAIT_THRESHOLD_MS = 10 * 60 * 1000;

interface ScheduleTaskInput {
  action: 'create' | 'cancel' | 'list' | 'watch' | 'update';

  // create / update 参数
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
  timeoutMs?: number;

  /** 创建任务时的对话上下文快照 — 简要描述当前对话场景，帮助执行时的模型理解背景 */
  context?: string;

  /**
   * 静默 token：agent 回复包含此字符串时静默（不推给用户）。
   * 用于心跳巡检场景：prompt 里写"没事回复 HEARTBEAT_OK"，silentToken 设为 "HEARTBEAT_OK"。
   */
  silentToken?: string;

  // cancel / watch / update 参数
  taskId?: string;
}

export class ScheduleTaskTool extends BaseTool<ScheduleTaskInput> {
  name = 'ScheduleTask';
  shouldDefer = true;
  searchHint = 'schedule task, set reminder, timer, cron job, run later, recurring, watch file changes';
  description = 'Create, update, cancel, or list scheduled tasks. Tasks are executed by the daemon process and results are sent via desktop notification or Feishu. The daemon must be running (claude daemon start) for tasks to execute. For once-type tasks triggering within 10 minutes, execution happens inline in the current session. Use action=watch with taskId to view execution history. Use action=update with taskId to modify existing task fields.\n\nNever call ScheduleTask twice for the same task — one call is sufficient.';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'cancel', 'list', 'watch', 'update'],
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
        timeoutMs: {
          type: 'number',
          description: 'Task execution timeout in milliseconds. Default: 300000 (5 minutes).',
        },
        context: {
          type: 'string',
          description: 'Brief context snapshot of the current conversation when creating the task. Helps the executing model understand the background. Keep it concise (100-300 chars).',
        },
        silentToken: {
          type: 'string',
          description: 'Silent token for heartbeat mode. When the agent reply contains this token, the result is suppressed (not delivered to the user). Example: set to "HEARTBEAT_OK" with a prompt like "if nothing needs attention, reply HEARTBEAT_OK".',
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
    // 优先使用 WebScheduler 的 store 实例（避免多实例竞态写入 daemon-tasks.json）
    const { getWebScheduler } = await import('../web/server/web-scheduler.js');
    const ws = getWebScheduler();
    const store = ws ? ws.getStore() : new TaskStore();

    switch (input.action) {
      case 'create':
        return this.handleCreate(store, input);
      case 'cancel':
        return this.handleCancel(store, input);
      case 'list':
        return this.handleList(store);
      case 'watch':
        return this.handleWatch(store, input);
      case 'update':
        return this.handleUpdate(store, input);
      default:
        return { success: false, output: t('schedule.unknownAction', { action: input.action }) };
    }
  }

  private async handleCreate(store: TaskStore, input: ScheduleTaskInput): Promise<ToolResult> {
    // 校验必填参数
    if (!input.name) {
      return { success: false, output: t('schedule.nameRequired') };
    }
    if (!input.type) {
      return { success: false, output: t('schedule.typeRequired') };
    }
    if (!input.prompt) {
      return { success: false, output: t('schedule.promptRequired') };
    }

    // 重复任务检测：同名任务在 2 分钟内已创建，拒绝重复（不限 enabled 状态，已执行完的任务 enabled=false）
    const existingTasks = store.listTasks();
    const now = Date.now();
    const duplicate = existingTasks.find(t =>
      t.name === input.name && (now - t.createdAt) < 120_000
    );
    if (duplicate) {
      return {
        success: false,
        output: t('schedule.duplicateTask', { name: input.name, id: duplicate.id, seconds: Math.round((now - duplicate.createdAt) / 1000) }),
      };
    }

    let triggerAt: number | undefined;
    if (input.type === 'once') {
      if (!input.triggerAt) {
        return { success: false, output: t('schedule.triggerAtRequired') };
      }
      try {
        triggerAt = parseTimeExpression(input.triggerAt);
      } catch (err) {
        return { success: false, output: t('schedule.timeParseError', { error: err instanceof Error ? err.message : String(err) }) };
      }
    }

    if (input.type === 'interval') {
      if (!input.intervalMs || input.intervalMs <= 0) {
        return { success: false, output: t('schedule.intervalRequired') };
      }
    }

    if (input.type === 'watch') {
      if (!input.watchPaths || input.watchPaths.length === 0) {
        return { success: false, output: t('schedule.watchPathsRequired') };
      }
    }

    // 快照当前会话的认证信息，daemon 独立进程执行时用它恢复认证
    const authSnapshot = this.snapshotAuth();

    const task = store.addTask({
      type: input.type,
      name: input.name,
      triggerAt,
      intervalMs: input.intervalMs,
      watchPaths: input.watchPaths?.map(fromMsysPath),
      watchEvents: input.watchEvents || ['change'],
      debounceMs: input.debounceMs || 2000,
      prompt: input.prompt,
      notify: input.notify || ['desktop'],
      feishuChatId: input.feishuChatId,
      createdBy: 'conversation',
      workingDir: process.cwd(),
      model: input.model,
      timeoutMs: input.timeoutMs,
      context: input.context,
      silentToken: input.silentToken,
      enabled: true,
      authSnapshot,
    });

    // 通知 daemon 热加载
    store.signalReload();

    // 通知 WebScheduler 热加载新任务
    let schedulerRegistered = false;
    {
      const { getWebScheduler } = await import('../web/server/web-scheduler.js');
      const webSched = getWebScheduler();
      if (webSched) {
        webSched.onTaskCreated();
        schedulerRegistered = true;
      }
    }

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
    details += `Notify: ${task.notify.join(', ')}`;
    if (schedulerRegistered) {
      details += `\n\nRegistered with in-process scheduler.`;
    } else {
      details += `\n\nWarning: In-process scheduler not initialized. Task saved but won't execute until process restarts.`;
    }

    // 会话内等待执行：once 类型 + 触发时间在阈值内 → 阻塞等待并在当前进程执行
    if (task.type === 'once' && task.triggerAt && (task.triggerAt - Date.now()) <= INLINE_WAIT_THRESHOLD_MS) {
      return this.waitAndExecuteInline(store, task, details);
    }

    return { success: true, output: details };
  }

  private async handleCancel(store: TaskStore, input: ScheduleTaskInput): Promise<ToolResult> {
    if (!input.taskId) {
      return { success: false, output: t('schedule.cancelIdRequired') };
    }

    const removed = store.removeTask(input.taskId);
    if (removed) {
      store.signalReload();
      // 通知 WebScheduler 重新加载
      const { getWebScheduler } = await import('../web/server/web-scheduler.js');
      const webSched = getWebScheduler();
      if (webSched) {
        webSched.onTaskCreated();
      }
      return { success: true, output: t('schedule.cancelled', { taskId: input.taskId }) };
    } else {
      return { success: false, output: t('schedule.notFound', { taskId: input.taskId }) };
    }
  }

  private handleList(store: TaskStore): ToolResult {
    const tasks = store.listTasks();

    if (tasks.length === 0) {
      return { success: true, output: t('schedule.noTasks') };
    }

    const lines = tasks.map((task) => {
      let info = `- [${task.type}] "${task.name}" (ID: ${task.id})`;
      if (task.type === 'once' && task.triggerAt) {
        info += `\n  Trigger: ${new Date(task.triggerAt).toLocaleString()}`;
      }
      if (task.type === 'interval' && task.intervalMs) {
        info += `\n  Every: ${Math.round(task.intervalMs / 60000)} min`;
      }
      if (task.type === 'watch' && task.watchPaths) {
        info += `\n  Watch: ${task.watchPaths.join(', ')}`;
      }
      info += `\n  Prompt: ${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? '...' : ''}`;
      info += `\n  Notify: ${task.notify.join(', ')}`;
      if (task.silentToken) {
        info += `\n  Silent token: "${task.silentToken}"`;
      }
      info += `\n  Enabled: ${task.enabled}`;
      // 执行状态
      if (task.lastRunAt) {
        const statusIcon = task.lastRunStatus === 'success' ? 'OK' : task.lastRunStatus === 'timeout' ? 'TIMEOUT' : 'FAILED';
        info += `\n  Last run: ${new Date(task.lastRunAt).toLocaleString()} [${statusIcon}]`;
        if (task.lastRunError) {
          info += `\n  Error: ${task.lastRunError.slice(0, 200)}`;
        }
      }
      if (task.runCount) {
        info += `\n  Run count: ${task.runCount}`;
      }
      return info;
    });

    return { success: true, output: `Scheduled tasks (${tasks.length}):\n\n${lines.join('\n\n')}` };
  }

  /**
   * 查看任务的历史执行日志
   */
  private handleWatch(store: TaskStore, input: ScheduleTaskInput): ToolResult {
    if (!input.taskId) {
      return { success: false, output: t('schedule.watchIdRequired') };
    }

    const task = store.getTask(input.taskId);
    if (!task) {
      return { success: false, output: t('schedule.notFound', { taskId: input.taskId }) };
    }

    const entries = readRunLogEntries(input.taskId, { limit: 20 });

    if (entries.length === 0) {
      return { success: true, output: t('schedule.noHistory', { name: task.name }) };
    }

    const lines = entries.map(e => {
      const time = new Date(e.ts).toLocaleString();
      const status = e.status === 'success' ? 'OK' : e.status.toUpperCase();
      const dur = e.durationMs ? `${Math.round(e.durationMs / 1000)}s` : '?';
      let line = `[${time}] ${status} (${dur})`;
      if (e.summary) line += `\n  ${e.summary.slice(0, 200)}`;
      if (e.error) line += `\n  Error: ${e.error.slice(0, 200)}`;
      return line;
    });

    return {
      success: true,
      output: `Execution history for "${task.name}" (last ${entries.length}):\n\n${lines.join('\n\n')}`,
    };
  }

  /**
   * 更新任务
   */
  private async handleUpdate(store: TaskStore, input: ScheduleTaskInput): Promise<ToolResult> {
    if (!input.taskId) {
      return { success: false, output: 'taskId is required for update action' };
    }

    const task = store.getTask(input.taskId);
    if (!task) {
      return { success: false, output: t('schedule.notFound', { taskId: input.taskId }) };
    }

    const updates: Partial<ScheduledTask> = {};

    // 通用字段
    if (input.name !== undefined) updates.name = input.name;
    if (input.prompt !== undefined) updates.prompt = input.prompt;
    if (input.model !== undefined) updates.model = input.model;
    if (input.timeoutMs !== undefined) updates.timeoutMs = input.timeoutMs;
    if (input.silentToken !== undefined) updates.silentToken = input.silentToken;
    if (input.context !== undefined) updates.context = input.context;
    if (input.notify !== undefined) updates.notify = input.notify;
    if (input.feishuChatId !== undefined) updates.feishuChatId = input.feishuChatId;

    // 类型特定字段
    if (task.type === 'once' && input.triggerAt !== undefined) {
      const triggerAt = parseTimeExpression(input.triggerAt);
      updates.triggerAt = triggerAt;
      updates.nextRunAtMs = triggerAt; // 同步更新 nextRunAtMs
    }

    if (task.type === 'interval' && input.intervalMs !== undefined) {
      if (input.intervalMs <= 0) {
        return { success: false, output: 'intervalMs must be > 0' };
      }
      updates.intervalMs = input.intervalMs;
    }

    if (task.type === 'watch') {
      if (input.watchPaths !== undefined) {
        updates.watchPaths = input.watchPaths.map(fromMsysPath);
      }
      if (input.watchEvents !== undefined) {
        updates.watchEvents = input.watchEvents;
      }
      if (input.debounceMs !== undefined) {
        updates.debounceMs = input.debounceMs;
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, output: 'No fields to update. Provide at least one field to modify.' };
    }

    const updated = store.updateTask(input.taskId, updates);
    if (!updated) {
      return { success: false, output: 'Failed to update task' };
    }

    store.signalReload();

    const fields = Object.keys(updates).join(', ');
    return { success: true, output: `Task "${task.name}" (${input.taskId}) updated: ${fields}` };
  }

  /**
   * 会话内等待执行：阻塞等待触发时间，然后在当前进程内执行 prompt
   * 执行期间 UI 上显示 ScheduleTask 工具的 spinner，执行完成后显示结果
   */
  private async waitAndExecuteInline(store: TaskStore, task: ScheduledTask, createDetails: string): Promise<ToolResult> {
    // 立即标记为正在执行，防止 daemon 在等待期间抢先执行（竞态）
    store.updateTask(task.id, { runningAtMs: Date.now() });

    const waitUntil = task.triggerAt!;

    // 分段等待触发时间，每 3 秒检查一次任务是否被外部取消
    while (Date.now() < waitUntil) {
      const remaining = waitUntil - Date.now();
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 3000)));

      // 从磁盘重新加载，检查任务是否被外部取消（另一个会话调用 cancel）
      store.reload();
      const current = store.getTask(task.id);
      if (!current || !current.enabled) {
        return {
          success: true,
          output: `${createDetails}\n\nTask was cancelled before execution.`,
        };
      }
    }

    const startedAt = Date.now();
    const timeoutMs = task.timeoutMs || 300000;

    try {
      // 从 authSnapshot 恢复认证，如果没有快照则走默认 initAuth
      const authSnap = task.authSnapshot;
      if (!authSnap) {
        const { initAuth: _initAuth } = await import('../auth/index.js');
        _initAuth();
      }

      const { ConversationLoop } = await import('../core/loop.js');
      // 排除不适合在定时任务执行环境中使用的工具：
      // - ScheduleTask: 防止递归调度，模型不应在执行任务时创建新定时任务
      // - AskUserQuestion: 内联执行期间无法交互
      const loop = new ConversationLoop({
        model: task.model || 'sonnet',
        permissionMode: 'bypassPermissions' as any,
        workingDir: task.workingDir,
        maxTurns: 30,
        verbose: false,
        isSubAgent: true,
        disallowedTools: ['ScheduleTask', 'AskUserQuestion'],
        ...(authSnap?.apiKey && { apiKey: authSnap.apiKey }),
        ...(authSnap?.authToken && { authToken: authSnap.authToken }),
        ...(authSnap?.baseUrl && { baseUrl: authSnap.baseUrl }),
      });

      // 带超时保护执行
      let timeoutTimer: NodeJS.Timeout | undefined;
      const response = await Promise.race<string>([
        loop.processMessage(task.prompt).finally(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
        }),
        new Promise<string>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            if (typeof (loop as any).abort === 'function') {
              (loop as any).abort();
            }
            reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);

      const endedAt = Date.now();

      // 检测是否因 maxTurns 耗尽而截断（任务实际未完成）
      const wasTruncated = response.includes('[WARNING: max turns reached, task may be incomplete]');
      const finalStatus = wasTruncated ? 'failed' : 'success';

      // 更新任务状态
      store.updateTask(task.id, {
        runningAtMs: undefined,
        lastRunAt: startedAt,
        lastRunStatus: finalStatus,
        lastRunError: wasTruncated ? 'Max turns reached, task incomplete' : undefined,
        lastDurationMs: endedAt - startedAt,
        runCount: (task.runCount || 0) + 1,
        consecutiveErrors: wasTruncated ? (task.consecutiveErrors || 0) + 1 : 0,
        enabled: false,
        nextRunAtMs: undefined,
      });

      // 写入运行日志
      await appendRunLog({
        ts: endedAt,
        taskId: task.id,
        taskName: task.name,
        action: 'finished',
        status: finalStatus,
        summary: response.slice(0, 500),
        error: wasTruncated ? 'Max turns reached, task incomplete' : undefined,
        durationMs: endedAt - startedAt,
      }).catch(() => {});

      if (wasTruncated) {
        return {
          success: false,
          error: `${createDetails}\n\n--- Inline Execution ---\nTask "${task.name}" was truncated (max turns reached) after ${Math.round((endedAt - startedAt) / 1000)}s. The task did not fully complete.\n\nPartial result:\n${response}`,
        };
      }

      return {
        success: true,
        output: `${createDetails}\n\n--- Inline Execution ---\nTask "${task.name}" executed successfully in ${Math.round((endedAt - startedAt) / 1000)}s.\n\nResult:\n${response}`,
      };
    } catch (err) {
      const endedAt = Date.now();
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes('timeout');

      store.updateTask(task.id, {
        runningAtMs: undefined,
        lastRunAt: startedAt,
        lastRunStatus: isTimeout ? 'timeout' : 'failed',
        lastRunError: errMsg,
        lastDurationMs: endedAt - startedAt,
        runCount: (task.runCount || 0) + 1,
        consecutiveErrors: (task.consecutiveErrors || 0) + 1,
        enabled: false,
        nextRunAtMs: undefined,
      });

      await appendRunLog({
        ts: endedAt,
        taskId: task.id,
        taskName: task.name,
        action: 'finished',
        status: isTimeout ? 'timeout' : 'failed',
        error: errMsg,
        durationMs: endedAt - startedAt,
      }).catch(() => {});

      return {
        success: false,
        error: `${createDetails}\n\n--- Inline Execution ---\nTask "${task.name}" ${isTimeout ? 'timed out' : 'failed'}: ${errMsg}`,
      };
    }
  }

  /**
   * 快照当前会话的认证信息
   * 存入任务记录，daemon 执行时恢复
   */
  private snapshotAuth(): ScheduledTask['authSnapshot'] {
    return snapshotAuthCredentials();
  }
}
