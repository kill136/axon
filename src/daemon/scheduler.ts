/**
 * Daemon 定时调度器
 * 管理 once（一次性）和 interval（周期性）任务的定时触发
 */

import { TaskExecutor } from './executor.js';
import { TaskStore, type ScheduledTask } from './store.js';

export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private executor: TaskExecutor,
    private store: TaskStore,
  ) {}

  /**
   * 注册一次性定时任务
   */
  scheduleOnce(task: ScheduledTask): void {
    if (!task.triggerAt) return;

    const delay = task.triggerAt - Date.now();

    if (delay <= 0) {
      // 已过期，立即执行
      this.fire(task);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      this.fire(task);
    }, delay);

    // 防止 timer 阻止进程退出
    timer.unref();
    this.timers.set(task.id, timer);
  }

  /**
   * 注册周期性任务
   */
  scheduleInterval(task: ScheduledTask): void {
    if (!task.intervalMs || task.intervalMs <= 0) return;

    const timer = setInterval(() => {
      this.fire(task);
    }, task.intervalMs);

    timer.unref();
    this.timers.set(task.id, timer);
  }

  /**
   * 触发执行
   */
  private fire(task: ScheduledTask): void {
    this.executor.execute({ task }).catch((err) => {
      console.error(`[Scheduler] Task "${task.name}" execution failed:`, err.message);
    });

    // once 类型执行后从 store 中删除
    if (task.type === 'once') {
      this.store.removeTask(task.id);
    }
  }

  /**
   * 取消单个任务
   */
  cancel(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  /**
   * 取消所有任务
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * 当前注册的定时器数量
   */
  getActiveCount(): number {
    return this.timers.size;
  }
}
