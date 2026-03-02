/**
 * TaskQueue - 串行任务执行队列
 *
 * 设计理念：简单优先，质量至上
 * - 任务严格串行执行，后一个任务能看到前一个的改动
 * - 每个任务完成后自动提交 Git
 * - 无并发冲突，无需复杂的分支管理
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { SmartTask, TaskResult } from './types.js';

const execAsync = promisify(exec);

/**
 * 任务执行器接口
 */
export interface TaskExecutor {
  execute(task: SmartTask, workerId: string): Promise<TaskResult>;
  /**
   * v5.7: 中止指定 Worker 的任务执行
   * 超时时调用此方法来停止 Worker
   * @param workerId 要中止的 Worker ID
   */
  abort?(workerId: string): void;
}

/**
 * 队列执行结果
 */
export interface QueueResult {
  success: boolean;
  completedCount: number;
  failedCount: number;
  results: Map<string, TaskResult>;
  error?: string;
}

/**
 * 串行任务队列
 */
export class TaskQueue extends EventEmitter {
  private projectPath: string;
  private isRunning: boolean = false;
  private isCancelled: boolean = false;

  constructor(projectPath: string) {
    super();
    this.projectPath = projectPath;
  }

  /**
   * 串行执行任务列表
   */
  async execute(tasks: SmartTask[], executor: TaskExecutor): Promise<QueueResult> {
    if (this.isRunning) {
      throw new Error('队列正在执行中');
    }

    this.isRunning = true;
    this.isCancelled = false;

    const results = new Map<string, TaskResult>();
    let completedCount = 0;
    let failedCount = 0;

    this.emit('queue:started', { totalTasks: tasks.length });

    try {
      for (let i = 0; i < tasks.length; i++) {
        // 检查是否取消
        if (this.isCancelled) {
          this.emit('queue:cancelled', { completedCount, failedCount });
          return {
            success: false,
            completedCount,
            failedCount,
            results,
            error: '执行被取消',
          };
        }

        const task = tasks[i];
        const workerId = `worker-${i}`;

        // 发送任务开始事件
        this.emit('task:started', {
          index: i,
          taskId: task.id,
          taskName: task.name,
        });

        try {
          // 执行任务
          const result = await executor.execute(task, workerId);
          results.set(task.id, result);

          if (result.success) {
            completedCount++;

            // 提交改动
            if (result.changes && result.changes.length > 0) {
              await this.commitTask(task);
            }

            this.emit('task:completed', {
              index: i,
              taskId: task.id,
              taskName: task.name,
            });
          } else {
            failedCount++;

            this.emit('task:failed', {
              index: i,
              taskId: task.id,
              taskName: task.name,
              error: result.error,
            });

            // 串行执行模式：任务失败则停止
            return {
              success: false,
              completedCount,
              failedCount,
              results,
              error: `任务失败: ${task.name}`,
            };
          }
        } catch (error: any) {
          failedCount++;
          results.set(task.id, {
            success: false,
            changes: [],
            decisions: [],
            error: error.message,
          });

          this.emit('task:failed', {
            index: i,
            taskId: task.id,
            taskName: task.name,
            error: error.message,
          });

          // 串行执行模式：任务异常则停止
          return {
            success: false,
            completedCount,
            failedCount,
            results,
            error: `任务执行异常: ${task.name} - ${error.message}`,
          };
        }

        // 发送进度更新
        this.emit('progress:update', {
          completed: completedCount,
          failed: failedCount,
          total: tasks.length,
          current: i + 1,
        });
      }

      this.emit('queue:completed', { completedCount, failedCount });

      return {
        success: failedCount === 0,
        completedCount,
        failedCount,
        results,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 提交单个任务的改动
   */
  private async commitTask(task: SmartTask): Promise<void> {
    try {
      // 检查是否有改动
      const statusResult = await execAsync('git status --porcelain', {
        cwd: this.projectPath,
      });

      if (!statusResult.stdout.trim()) {
        // 没有改动，跳过提交
        return;
      }

      // 添加所有改动
      await execAsync('git add -A', { cwd: this.projectPath });

      // 转义提交消息中的特殊字符
      const message = `[Task] ${task.name}`.replace(/"/g, '\\"');

      // 提交
      await execAsync(`git commit -m "${message}"`, {
        cwd: this.projectPath,
      });

      this.emit('git:committed', {
        taskId: task.id,
        taskName: task.name,
      });
    } catch (error: any) {
      // 提交失败不影响任务结果，只记录警告
      console.warn(`[TaskQueue] Git commit failed: ${error.message}`);
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.isCancelled = true;
  }

  /**
   * 检查是否正在执行
   */
  get running(): boolean {
    return this.isRunning;
  }
}

/**
 * 创建任务队列
 */
export function createTaskQueue(projectPath: string): TaskQueue {
  return new TaskQueue(projectPath);
}
