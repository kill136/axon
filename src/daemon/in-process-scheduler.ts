/**
 * 进程内 Scheduler（单例）
 *
 * 替代独立 daemon 进程，直接在主进程（CLI/Web UI）内运行定时调度。
 * - 不 spawn 子进程，不闪 cmd 窗口
 * - 共享主进程的认证、工具、上下文
 * - Web UI 模式下 7×24 运行，CLI 模式下进程存活期间运行
 * - 进程退出后任务暂停，下次启动自动补偿（runMissedJobs）
 */

import * as path from 'path';
import * as os from 'os';
import { TaskStore, type ScheduledTask } from './store.js';
import { TaskExecutor } from './executor.js';
import { Scheduler } from './scheduler.js';
import { FileWatcher } from './watcher.js';
import { Notifier } from './notifier.js';

// ============================================================================
// 单例
// ============================================================================

let instance: InProcessScheduler | null = null;

export function getInProcessScheduler(): InProcessScheduler | null {
  return instance;
}

export function initInProcessScheduler(): InProcessScheduler {
  if (instance) return instance;
  instance = new InProcessScheduler();
  return instance;
}

export function destroyInProcessScheduler(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

// ============================================================================
// InProcessScheduler
// ============================================================================

class InProcessScheduler {
  private store: TaskStore;
  private executor: TaskExecutor;
  private scheduler: Scheduler;
  private watcher: FileWatcher;
  private reloadTimer: NodeJS.Timeout | null = null;
  private started = false;

  constructor() {
    this.store = new TaskStore();

    const claudeDir = path.join(os.homedir(), '.claude');
    const logFile = path.join(claudeDir, 'daemon.log');

    const notifier = new Notifier();

    this.executor = new TaskExecutor({
      maxConcurrent: 2,
      notifier,
      logFile,
      defaultModel: 'sonnet',
      defaultPermissionMode: 'bypassPermissions',
      defaultWorkingDir: process.cwd(),
    });

    this.scheduler = new Scheduler(this.executor, this.store);
    this.watcher = new FileWatcher(this.executor);

    this.start();
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 注册已有任务
    const tasks = this.store.listTasks();
    for (const task of tasks) {
      if (!task.enabled) continue;
      this.registerTaskInternal(task);
    }

    // 补偿错过的任务
    await this.scheduler.runMissedJobs();

    // 启动 timer
    this.scheduler.recomputeNextRuns();
    this.scheduler.armTimer();

    // reload 轮询（外部 daemon 也可能修改 tasks 文件）
    this.reloadTimer = setInterval(() => {
      if (this.store.checkReloadSignal()) {
        this.reloadTasks();
      }
    }, 5000);
    // 不阻止进程退出
    this.reloadTimer.unref();

    console.log(`[InProcessScheduler] Started with ${tasks.filter(t => t.enabled).length} active tasks`);
  }

  /**
   * 注册新创建的任务
   */
  registerTask(task: ScheduledTask): void {
    this.registerTaskInternal(task);
    this.scheduler.recomputeNextRuns();
    this.scheduler.armTimer();
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    this.scheduler.cancel(taskId);
    this.watcher.unwatch(taskId);
  }

  stop(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.watcher.unwatchAll();
    this.scheduler.cancelAll();
    this.started = false;
  }

  private registerTaskInternal(task: ScheduledTask): void {
    switch (task.type) {
      case 'once':
        this.scheduler.scheduleOnce(task);
        break;
      case 'interval':
        this.scheduler.scheduleInterval(task);
        break;
      case 'watch':
        this.watcher.watchTask(task);
        break;
    }
  }

  private reloadTasks(): void {
    const oldTasks = this.store.listTasks();
    const oldIds = new Set(oldTasks.map(t => t.id));

    const newTasks = this.store.reload();
    const newIds = new Set(newTasks.map(t => t.id));

    // 取消已删除的
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        this.scheduler.cancel(id);
        this.watcher.unwatch(id);
      }
    }

    // 注册新增的
    for (const task of newTasks) {
      if (!task.enabled) continue;
      if (!oldIds.has(task.id)) {
        this.registerTaskInternal(task);
      }
    }

    this.scheduler.recomputeNextRuns();
    this.scheduler.armTimer();
  }
}
