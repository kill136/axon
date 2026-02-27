/**
 * Web Server 内嵌定时调度器
 *
 * 借鉴 OpenClaw Gateway 的设计：Web Server 本身是长驻进程，
 * 调度器作为内置模块运行，不需要独立 daemon 进程做中转。
 *
 * 核心机制：
 * - 复用 TaskStore（daemon-tasks.json）作为持久化存储
 * - 单 timer + 60s 上限，防止系统休眠/时钟漂移
 * - 任务到期后定点投递到创建它的对话会话
 * - 对话已关闭时自动创建新会话执行
 */

import { randomUUID } from 'crypto';
import { TaskStore, type ScheduledTask } from '../../daemon/store.js';
import { appendRunLog } from '../../daemon/run-log.js';
import type { ConversationManager, StreamCallbacks } from './conversation.js';

// 最大 timer 延迟，防止时钟漂移
const MAX_TIMER_DELAY_MS = 60_000;

// 热加载轮询间隔（检查外部 ScheduleTask 工具创建的新任务）
const RELOAD_POLL_INTERVAL_MS = 5_000;

// 卡住任务超时：10 分钟自动清除 runningAtMs 标记（任务默认超时 5 分钟）
const STUCK_RUN_MS = 10 * 60 * 1000;

// 错误指数退避时间表（毫秒）
const ERROR_BACKOFF_SCHEDULE_MS = [
  30_000,       // 1st error  →  30 s
  60_000,       // 2nd error  →   1 min
  5 * 60_000,   // 3rd error  →   5 min
  15 * 60_000,  // 4th error  →  15 min
  60 * 60_000,  // 5th+ error →  60 min
];

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_SCHEDULE_MS.length - 1);
  return ERROR_BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
}

// =========================================================================
// 全局单例 getter（供 ScheduleTask 工具等共享 store，避免多实例竞态）
// =========================================================================

let _instance: WebScheduler | null = null;

export function getWebScheduler(): WebScheduler | null {
  return _instance;
}

export class WebScheduler {
  private timer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private store: TaskStore;
  private running = false;
  private conversationManager: ConversationManager;
  private broadcastFn: (msg: any) => void;
  private defaultModel: string;
  private cwd: string;
  // 待投递队列：对话正在处理时，闹钟暂存这里，对话空闲后自动触发
  private pendingAlarms: Map<string, ScheduledTask[]> = new Map();

  constructor(options: {
    conversationManager: ConversationManager;
    broadcastMessage: (msg: any) => void;
    defaultModel: string;
    cwd: string;
  }) {
    this.store = new TaskStore();
    this.conversationManager = options.conversationManager;
    this.broadcastFn = options.broadcastMessage;
    this.defaultModel = options.defaultModel;
    this.cwd = options.cwd;
    _instance = this;
  }

  /**
   * 获取 TaskStore 实例（供 ScheduleTask 工具等共享，避免多实例竞态）
   */
  getStore(): TaskStore {
    return this.store;
  }

  // =========================================================================
  // 公共接口
  // =========================================================================

  /**
   * 启动调度器：加载已有任务 + 启动 timer
   */
  start(): void {
    console.log('[WebScheduler] Starting...');

    // 先运行错过的任务
    this.runMissedJobs();

    // 计算所有任务的 nextRunAtMs
    this.recomputeNextRuns();
    this.armTimer();

    // 启动热加载轮询：检查 reload 信号（外部通过 ScheduleTask 工具创建的任务）
    this.reloadTimer = setInterval(() => {
      if (this.store.checkReloadSignal()) {
        console.log('[WebScheduler] Reload signal detected, reloading tasks...');
        this.store.reload();
        this.recomputeNextRuns();
        this.armTimer();
      }
    }, RELOAD_POLL_INTERVAL_MS);

    const activeCount = this.getActiveCount();
    console.log(`[WebScheduler] Started. Active tasks: ${activeCount}`);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
    console.log('[WebScheduler] Stopped.');
  }

  /**
   * 外部通知：有新任务创建或 run-now 触发，重新调度
   */
  onTaskCreated(): void {
    this.store.reload();
    this.recomputeNextRuns();
    this.armTimer();
  }

  /**
   * 当某个对话的 isProcessing 变为 false 时调用
   * 检查是否有该会话的待投递闹钟
   */
  onSessionIdle(sessionId: string): void {
    const pending = this.pendingAlarms.get(sessionId);
    if (!pending || pending.length === 0) return;

    // 取出所有待投递的闹钟
    this.pendingAlarms.delete(sessionId);

    for (const task of pending) {
      console.log(`[WebScheduler] Delivering pending alarm "${task.name}" to session ${sessionId}`);
      this.executeInSession(task, sessionId).catch(err => {
        console.error(`[WebScheduler] Failed to deliver pending alarm "${task.name}":`, err);
        // 失败时清除 runningAtMs，让下次 timer 能重新调度
        this.store.updateTask(task.id, { runningAtMs: undefined });
        this.store.reload(); // 刷新内存中的数据
      });
    }
  }

  // =========================================================================
  // Timer 机制（与 daemon/scheduler.ts 一致）
  // =========================================================================

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextAt = this.nextWakeAtMs();
    if (nextAt === undefined) return;

    const now = Date.now();
    const delay = Math.max(nextAt - now, 0);
    const clampedDelay = Math.min(delay, MAX_TIMER_DELAY_MS);

    this.timer = setTimeout(async () => {
      try {
        await this.onTimer();
      } catch (err) {
        console.error('[WebScheduler] Timer tick failed:', err instanceof Error ? err.message : err);
      }
    }, clampedDelay);
  }

  private async onTimer(): Promise<void> {
    if (this.running) {
      // 有任务在执行中，60s 后再检查
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        try { await this.onTimer(); } catch (err) {
          console.error('[WebScheduler] Timer tick failed:', err instanceof Error ? err.message : err);
        }
      }, MAX_TIMER_DELAY_MS);
      return;
    }

    this.running = true;
    try {
      // 清理孤立的 pendingAlarms：session 已不存在时降级到新会话执行
      this.drainOrphanedPendingAlarms();

      this.store.reload();
      const dueJobs = this.findDueJobs();

      if (dueJobs.length === 0) {
        this.recomputeNextRuns();
        return;
      }

      for (const task of dueJobs) {
        await this.executeTask(task);
      }

      this.recomputeNextRuns();
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  /**
   * 清理孤立的 pendingAlarms：
   * 如果 session 已不在 conversationManager 中（用户关闭了对话），
   * 将暂存的闹钟任务降级为"创建新会话执行"。
   */
  private drainOrphanedPendingAlarms(): void {
    for (const [sessionId, tasks] of this.pendingAlarms) {
      if (!this.conversationManager.hasSession(sessionId)) {
        this.pendingAlarms.delete(sessionId);
        for (const task of tasks) {
          console.log(`[WebScheduler] Session ${sessionId} gone, executing pending alarm "${task.name}" in new session`);
          this.executeInNewSession(task).catch(err => {
            console.error(`[WebScheduler] Failed to execute orphaned alarm "${task.name}":`, err);
            // 失败时清除 runningAtMs，让下次 timer 能重新调度
            this.store.updateTask(task.id, { runningAtMs: undefined });
            this.store.reload(); // 刷新内存中的数据
          });
        }
      }
    }
  }

  // =========================================================================
  // 任务执行 — 核心投递逻辑
  // =========================================================================

  private async executeTask(task: ScheduledTask): Promise<void> {
    const sessionId = task.sessionId;

    // 标记为正在执行，防止 daemon 重复触发
    this.store.updateTask(task.id, { runningAtMs: Date.now() });
    
    // 广播任务开始执行
    const updatedTask = this.store.getTask(task.id);
    if (updatedTask) {
      this.broadcastFn({
        type: 'schedule:task_updated',
        payload: { task: updatedTask },
      });
    }

    if (sessionId && this.conversationManager.hasSession(sessionId)) {
      // 有目标会话且还活着
      if (this.conversationManager.isSessionProcessing(sessionId)) {
        // 对话正在处理中，暂存到待投递队列
        console.log(`[WebScheduler] Session ${sessionId} is busy, queuing alarm "${task.name}"`);
        this.broadcastAlarmNotification(task, sessionId);
        const pending = this.pendingAlarms.get(sessionId) || [];
        pending.push(task);
        this.pendingAlarms.set(sessionId, pending);

        // once 类型直接标记完成，不再重调度
        if (task.type === 'once') {
          this.store.updateTask(task.id, { enabled: false, nextRunAtMs: undefined });
        }
        return;
      }

      // 对话空闲，直接投递
      await this.executeInSession(task, sessionId);
    } else {
      // 对话已关闭或没有 sessionId，创建新对话
      await this.executeInNewSession(task);
    }
  }

  /**
   * 在指定对话中执行闹钟任务
   */
  private async executeInSession(task: ScheduledTask, sessionId: string): Promise<void> {
    // 竞态保护：再次检查会话状态，如果在微窗口内被用户抢占了，放回队列
    if (this.conversationManager.isSessionProcessing(sessionId)) {
      console.log(`[WebScheduler] Session ${sessionId} became busy (race), re-queuing alarm "${task.name}"`);
      const pending = this.pendingAlarms.get(sessionId) || [];
      pending.push(task);
      this.pendingAlarms.set(sessionId, pending);
      return;
    }

    const startedAt = Date.now();
    const prompt = this.buildAlarmPrompt(task);
    const isSilentMode = Boolean(task.silentToken);

    console.log(`[WebScheduler] Executing alarm "${task.name}" in session ${sessionId}${isSilentMode ? ' (silent mode)' : ''}`);

    const messageId = randomUUID();

    if (isSilentMode) {
      // 静默模式：缓冲所有输出，完成后判断是否含 silentToken
      const callbacks = this.buildSilentCallbacks(task, sessionId, messageId);

      try {
        await this.conversationManager.chat(
          sessionId,
          prompt,
          undefined,
          task.model || this.defaultModel,
          callbacks,
          task.workingDir || this.cwd,
          undefined,
          'bypassPermissions',
        );

        const endedAt = Date.now();
        this.applyTaskResult(task, { status: 'success', startedAt, endedAt });
      } catch (err) {
        const endedAt = Date.now();
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errMsg.includes('timeout');
        console.error(`[WebScheduler] Alarm "${task.name}" failed:`, errMsg);
        this.applyTaskResult(task, {
          status: isTimeout ? 'timeout' : 'failed',
          error: errMsg,
          startedAt,
          endedAt,
        });
      }
    } else {
      // 普通模式：直接流式推送
      this.broadcastAlarmNotification(task, sessionId);

      const callbacks = this.buildBroadcastCallbacks(sessionId, messageId);

      this.broadcastFn({
        type: 'message_start',
        payload: { messageId, sessionId },
      });
      this.broadcastFn({
        type: 'status',
        payload: { status: 'thinking', sessionId },
      });

      try {
        await this.conversationManager.chat(
          sessionId,
          prompt,
          undefined,
          task.model || this.defaultModel,
          callbacks,
          task.workingDir || this.cwd,
          undefined,
          'bypassPermissions',
        );

        const endedAt = Date.now();
        this.applyTaskResult(task, { status: 'success', startedAt, endedAt });
      } catch (err) {
        const endedAt = Date.now();
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errMsg.includes('timeout');
        console.error(`[WebScheduler] Alarm "${task.name}" failed:`, errMsg);
        this.applyTaskResult(task, {
          status: isTimeout ? 'timeout' : 'failed',
          error: errMsg,
          startedAt,
          endedAt,
        });
      }
    }
  }

  /**
   * 创建新对话并执行闹钟任务
   */
  private async executeInNewSession(task: ScheduledTask): Promise<void> {
    const startedAt = Date.now();
    const prompt = this.buildAlarmPrompt(task);

    console.log(`[WebScheduler] Creating new session for alarm "${task.name}"`);

    const sessionMgr = this.conversationManager.getSessionManager();
    const title = `⏰ 定时任务: ${task.name.slice(0, 40)}`;
    const newSession = sessionMgr.createSession({
      name: title,
      model: task.model || this.defaultModel,
      tags: ['webui', 'scheduled-task'],
      projectPath: task.workingDir || this.cwd,
    });
    const sessionId = newSession.metadata.id;

    // 通知前端新会话创建
    this.broadcastFn({
      type: 'session_created',
      payload: {
        sessionId,
        name: title,
        model: task.model || this.defaultModel,
        createdAt: newSession.metadata.createdAt,
        tags: ['scheduled-task'],
      },
    });

    // 通知前端闹钟响了（标记为新会话，前端通知中会提示用户切换）
    this.broadcastAlarmNotification(task, sessionId, true);

    const messageId = randomUUID();
    const callbacks = this.buildBroadcastCallbacks(sessionId, messageId);

    this.broadcastFn({
      type: 'message_start',
      payload: { messageId, sessionId },
    });
    this.broadcastFn({
      type: 'status',
      payload: { status: 'thinking', sessionId },
    });

    try {
      await this.conversationManager.chat(
        sessionId,
        prompt,
        undefined,
        task.model || this.defaultModel,
        callbacks,
        task.workingDir || this.cwd,
        undefined,
        'bypassPermissions',
      );

      const endedAt = Date.now();
      this.applyTaskResult(task, { status: 'success', startedAt, endedAt });
    } catch (err) {
      const endedAt = Date.now();
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes('timeout');
      console.error(`[WebScheduler] Alarm "${task.name}" in new session failed:`, errMsg);
      this.applyTaskResult(task, {
        status: isTimeout ? 'timeout' : 'failed',
        error: errMsg,
        startedAt,
        endedAt,
      });
    }
  }

  // =========================================================================
  // 辅助方法
  // =========================================================================

  private buildAlarmPrompt(task: ScheduledTask): string {
    const parts: string[] = [];
    parts.push(`[⏰ 定时提醒] 你之前设了定时任务 "${task.name}"，现在到时间了。`);
    parts.push('');
    parts.push(`**任务目标：** ${task.prompt}`);

    if (task.context) {
      parts.push('');
      parts.push(`**创建时的对话背景：** ${task.context}`);
    }

    if (task.executionMemory && task.executionMemory.length > 0) {
      parts.push('');
      parts.push('**历史执行记录：**');
      for (const mem of task.executionMemory) {
        parts.push(`- ${mem}`);
      }
    }

    parts.push('');
    parts.push('请现在处理这个任务。你可以根据当前对话上下文和你的记忆，自主判断最佳的执行方式。');

    return parts.join('\n');
  }

  /**
   * 通知前端闹钟响了
   */
  private broadcastAlarmNotification(task: ScheduledTask, sessionId: string, isNewSession = false): void {
    this.broadcastFn({
      type: 'schedule_alarm',
      payload: {
        taskId: task.id,
        taskName: task.name,
        sessionId,
        prompt: task.prompt,
        triggeredAt: Date.now(),
        isNewSession,
      },
    });
  }

  /**
   * 构建广播回调（复用 ErrorWatcher 的模式）
   */
  private buildBroadcastCallbacks(sessionId: string, messageId: string): StreamCallbacks {
    return {
      onThinkingStart: () => {
        this.broadcastFn({
          type: 'thinking_start',
          payload: { messageId, sessionId },
        });
      },
      onThinkingDelta: (text: string) => {
        this.broadcastFn({
          type: 'thinking_delta',
          payload: { messageId, text, sessionId },
        });
      },
      onThinkingComplete: () => {
        this.broadcastFn({
          type: 'thinking_complete',
          payload: { messageId, sessionId },
        });
      },
      onTextDelta: (text: string) => {
        this.broadcastFn({
          type: 'text_delta',
          payload: { messageId, text, sessionId },
        });
      },
      onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
        this.broadcastFn({
          type: 'tool_use_start',
          payload: { messageId, toolUseId, toolName, input, sessionId },
        });
        this.broadcastFn({
          type: 'status',
          payload: { status: 'tool_executing', message: `执行 ${toolName}...`, sessionId },
        });
      },
      onToolUseDelta: (toolUseId: string, partialJson: string) => {
        this.broadcastFn({
          type: 'tool_use_delta',
          payload: { toolUseId, partialJson, sessionId },
        });
      },
      onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
        this.broadcastFn({
          type: 'tool_result',
          payload: {
            toolUseId,
            success,
            output,
            error,
            data: data as any,
            defaultCollapsed: true,
            sessionId,
          },
        });
      },
      onPermissionRequest: (request: any) => {
        this.broadcastFn({
          type: 'permission_request',
          payload: { ...request, sessionId },
        });
      },
      onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
        await this.conversationManager.persistSession(sessionId);
        this.broadcastFn({
          type: 'message_complete',
          payload: {
            messageId,
            stopReason: (stopReason || 'end_turn') as 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use',
            usage,
            sessionId,
          },
        });
        this.broadcastFn({
          type: 'status',
          payload: { status: 'idle', sessionId },
        });
      },
      onError: (error: Error) => {
        this.broadcastFn({
          type: 'error',
          payload: { error: error.message, sessionId },
        });
        this.broadcastFn({
          type: 'status',
          payload: { status: 'idle', sessionId },
        });
      },
      onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
        this.broadcastFn({
          type: 'context_compact',
          payload: { phase, info, sessionId },
        });
      },
      onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
        this.broadcastFn({
          type: 'context_update',
          payload: { ...usage, sessionId },
        });
      },
    };
  }

  /**
   * 构建静默模式回调：缓冲所有文本，完成后判断是否含 silentToken。
   * - 含 silentToken → 只发 schedule_silent_ok 轻量通知，不推消息
   * - 不含 → 一次性补发完整消息（告警）
   */
  private buildSilentCallbacks(task: ScheduledTask, sessionId: string, messageId: string): StreamCallbacks {
    const silentToken = task.silentToken!;
    let fullText = '';
    // 工具调用和 thinking 事件暂存，告警时补发
    const bufferedEvents: Array<{ type: string; payload: any }>= [];

    return {
      onThinkingStart: () => {
        bufferedEvents.push({ type: 'thinking_start', payload: { messageId, sessionId } });
      },
      onThinkingDelta: (text: string) => {
        bufferedEvents.push({ type: 'thinking_delta', payload: { messageId, text, sessionId } });
      },
      onThinkingComplete: () => {
        bufferedEvents.push({ type: 'thinking_complete', payload: { messageId, sessionId } });
      },
      onTextDelta: (text: string) => {
        fullText += text;
      },
      onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
        bufferedEvents.push({ type: 'tool_use_start', payload: { messageId, toolUseId, toolName, input, sessionId } });
      },
      onToolUseDelta: (toolUseId: string, partialJson: string) => {
        bufferedEvents.push({ type: 'tool_use_delta', payload: { toolUseId, partialJson, sessionId } });
      },
      onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
        bufferedEvents.push({ type: 'tool_result', payload: { toolUseId, success, output, error, data, defaultCollapsed: true, sessionId } });
      },
      onPermissionRequest: (request: any) => {
        // 权限请求必须立即推（不能缓冲），但 silent 模式用 bypassPermissions，理论上不会触发
        this.broadcastFn({ type: 'permission_request', payload: { ...request, sessionId } });
      },
      onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
        await this.conversationManager.persistSession(sessionId);

        const isSilent = fullText.includes(silentToken);

        if (isSilent) {
          // 静默：不推消息，只发轻量状态通知
          console.log(`[WebScheduler] Silent OK for "${task.name}" — reply contained "${silentToken}"`);
          this.broadcastFn({
            type: 'schedule_silent_ok',
            payload: {
              taskId: task.id,
              taskName: task.name,
              sessionId,
              timestamp: Date.now(),
              silentToken,
            },
          });
        } else {
          // 告警：补发所有缓冲事件 + 完整文本
          console.log(`[WebScheduler] Alert from "${task.name}" — broadcasting to frontend`);
          this.broadcastAlarmNotification(task, sessionId);

          this.broadcastFn({ type: 'message_start', payload: { messageId, sessionId } });
          this.broadcastFn({ type: 'status', payload: { status: 'thinking', sessionId } });

          // 补发缓冲的工具调用和 thinking 事件
          for (const evt of bufferedEvents) {
            this.broadcastFn(evt);
          }

          // 发送完整文本（一次性）
          if (fullText) {
            this.broadcastFn({ type: 'text_delta', payload: { messageId, text: fullText, sessionId } });
          }

          this.broadcastFn({
            type: 'message_complete',
            payload: {
              messageId,
              stopReason: (stopReason || 'end_turn') as 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use',
              usage,
              sessionId,
            },
          });
          this.broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });
        }
      },
      onError: (error: Error) => {
        // 错误不静默，始终推送
        this.broadcastFn({ type: 'error', payload: { error: error.message, sessionId } });
        this.broadcastFn({ type: 'status', payload: { status: 'idle', sessionId } });
      },
      onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
        // context compact 不缓冲
        this.broadcastFn({ type: 'context_compact', payload: { phase, info, sessionId } });
      },
      onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
        this.broadcastFn({ type: 'context_update', payload: { ...usage, sessionId } });
      },
    };
  }

  /**
   * 应用任务执行结果，更新 TaskStore + 写运行日志
   */
  private applyTaskResult(task: ScheduledTask, result: {
    status: 'success' | 'failed' | 'timeout';
    error?: string;
    startedAt: number;
    endedAt: number;
  }): void {
    const updates: Partial<ScheduledTask> = {
      runningAtMs: undefined,
      lastRunAt: result.startedAt,
      lastRunStatus: result.status,
      lastRunError: result.status === 'success' ? undefined : result.error,
      lastDurationMs: Math.max(0, result.endedAt - result.startedAt),
      runCount: (task.runCount || 0) + 1,
    };

    if (result.status !== 'success') {
      updates.consecutiveErrors = (task.consecutiveErrors || 0) + 1;
    } else {
      updates.consecutiveErrors = 0;
    }

    // once 类型：无论成功失败都禁用
    if (task.type === 'once') {
      updates.enabled = false;
      updates.nextRunAtMs = undefined;
    } else if (result.status !== 'success' && task.enabled) {
      // interval 类型失败：指数退避
      const consecutiveErrors = updates.consecutiveErrors!;
      const backoff = errorBackoffMs(consecutiveErrors);
      const normalNext = this.computeIntervalNextRun(task, result.endedAt);
      const backoffNext = result.endedAt + backoff;
      updates.nextRunAtMs = Math.max(normalNext, backoffNext);
    } else if (task.enabled) {
      updates.nextRunAtMs = this.computeIntervalNextRun(task, result.endedAt);
    } else {
      updates.nextRunAtMs = undefined;
    }

    this.store.updateTask(task.id, updates);

    // 写运行日志（静默失败）
    appendRunLog({
      ts: result.endedAt,
      taskId: task.id,
      taskName: task.name,
      action: 'finished',
      status: result.status,
      error: result.error,
      durationMs: result.endedAt - result.startedAt,
    }).catch(() => {});
    
    // 广播任务执行完成
    const updatedTask = this.store.getTask(task.id);
    if (updatedTask) {
      this.broadcastFn({
        type: 'schedule:task_updated',
        payload: { task: updatedTask },
      });
    }
  }

  // =========================================================================
  // 调度计算（与 daemon/scheduler.ts 一致）
  // =========================================================================

  private findDueJobs(): ScheduledTask[] {
    const tasks = this.store.listTasks();
    const now = Date.now();

    return tasks.filter(t => {
      if (!t.enabled) return false;
      if (typeof t.runningAtMs === 'number') return false;
      const next = t.nextRunAtMs;
      return typeof next === 'number' && now >= next;
    });
  }

  private recomputeNextRuns(): void {
    const tasks = this.store.listTasks();
    const now = Date.now();

    for (const task of tasks) {
      if (!task.enabled) {
        if (task.nextRunAtMs !== undefined || task.runningAtMs !== undefined) {
          this.store.updateTask(task.id, { nextRunAtMs: undefined, runningAtMs: undefined });
        }
        continue;
      }

      // 清除卡住的 runningAtMs
      if (typeof task.runningAtMs === 'number' && now - task.runningAtMs > STUCK_RUN_MS) {
        console.log(`[WebScheduler] Clearing stuck running marker for "${task.name}"`);
        this.store.updateTask(task.id, { runningAtMs: undefined });
      }

      const nextRun = task.nextRunAtMs;
      if (nextRun === undefined) {
        // 新任务，还没有 nextRunAtMs，需要计算
        let newNext: number | undefined;
        if (task.type === 'once' && task.triggerAt) {
          newNext = task.triggerAt;
        } else if (task.type === 'interval') {
          newNext = this.computeIntervalNextRun(task, now);
        }
        if (newNext !== undefined) {
          this.store.updateTask(task.id, { nextRunAtMs: newNext });
        }
      }
      // 注意：当 now >= nextRun 时，不在这里重新计算。
      // 到期任务由 findDueJobs → executeTask 流程处理，
      // 执行完成后在 onRunComplete 中计算下一次运行时间。
      // 如果在这里提前覆盖，run-now 设置的 nextRunAtMs=now 会被替换为下个周期，
      // 导致"立即执行"功能失效。
    }
  }

  private computeIntervalNextRun(task: ScheduledTask, afterMs: number): number {
    if (!task.intervalMs || task.intervalMs <= 0) return afterMs;
    const anchor = task.createdAt;
    const elapsed = afterMs - anchor;
    const steps = Math.max(1, Math.ceil(elapsed / task.intervalMs));
    return anchor + steps * task.intervalMs;
  }

  private nextWakeAtMs(): number | undefined {
    const tasks = this.store.listTasks();
    const enabled = tasks.filter(t => t.enabled && typeof t.nextRunAtMs === 'number');
    if (enabled.length === 0) return undefined;
    return enabled.reduce((min, t) => Math.min(min, t.nextRunAtMs as number), enabled[0].nextRunAtMs as number);
  }

  private getActiveCount(): number {
    return this.store.listTasks().filter(t => t.enabled && typeof t.nextRunAtMs === 'number').length;
  }

  private runMissedJobs(): void {
    const tasks = this.store.listTasks();
    const now = Date.now();

    const missed = tasks.filter(t => {
      if (!t.enabled) return false;
      if (typeof t.runningAtMs === 'number') return false;
      if (t.type === 'once' && t.lastRunStatus) return false;
      const next = t.nextRunAtMs;
      return typeof next === 'number' && now >= next;
    });

    if (missed.length > 0) {
      console.log(`[WebScheduler] Running ${missed.length} missed job(s): ${missed.map(t => t.name).join(', ')}`);
      for (const task of missed) {
        this.executeTask(task).catch(err => {
          console.error(`[WebScheduler] Missed job "${task.name}" failed:`, err);
        });
      }
    }
  }
}
