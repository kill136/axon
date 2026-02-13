/**
 * Daemon 任务执行器
 * 通过 ConversationLoop 执行 AI prompt 并发送通知
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConversationLoop } from '../core/loop.js';
import { initAuth } from '../auth/index.js';
import { Notifier } from './notifier.js';
import type { ScheduledTask } from './store.js';

export interface ExecutorOptions {
  maxConcurrent: number;
  notifier: Notifier;
  logFile: string;
  defaultModel: string;
  defaultPermissionMode: string;
  defaultWorkingDir: string;
}

export interface TaskExecution {
  task: ScheduledTask | { name: string; prompt: string; model?: string; notify: ('desktop' | 'feishu')[]; feishuChatId?: string; workingDir: string };
  templateVars?: Record<string, string>;
}

export class TaskExecutor {
  private running = 0;
  private queue: Array<{ execution: TaskExecution; resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  private options: ExecutorOptions;
  private authInitialized = false;

  constructor(options: ExecutorOptions) {
    this.options = options;
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    const dir = path.dirname(this.options.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 执行一个任务
   */
  async execute(execution: TaskExecution): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ execution, resolve, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && this.running < this.options.maxConcurrent) {
      const item = this.queue.shift()!;
      this.running++;
      this.runTask(item.execution)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }

  private async runTask(execution: TaskExecution): Promise<string> {
    const { task, templateVars } = execution;
    const taskName = task.name;

    // 替换模板变量
    let prompt = task.prompt;
    if (templateVars) {
      for (const [key, value] of Object.entries(templateVars)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    const model = task.model || this.options.defaultModel;
    const workingDir = 'workingDir' in task ? task.workingDir : this.options.defaultWorkingDir;
    const notify = task.notify || ['desktop'];
    const feishuChatId = 'feishuChatId' in task ? task.feishuChatId : undefined;

    const timestamp = new Date().toISOString();
    this.log(`[${timestamp}] Executing task: ${taskName}`);
    this.log(`  Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);

    try {
      // 确保认证初始化
      if (!this.authInitialized) {
        initAuth();
        this.authInitialized = true;
      }

      // 创建临时 ConversationLoop
      const loop = new ConversationLoop({
        model,
        permissionMode: this.options.defaultPermissionMode as any,
        workingDir,
        maxTurns: 10,
        verbose: false,
        isSubAgent: false,
      });

      // 执行 prompt
      const response = await loop.processMessage(prompt);

      this.log(`  Result: ${response.slice(0, 500)}${response.length > 500 ? '...' : ''}`);

      // 发送通知
      await this.options.notifier.send(
        `[Daemon] ${taskName}`,
        response.length > 1000 ? response.slice(0, 997) + '...' : response,
        notify,
        feishuChatId,
      );

      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`  ERROR: ${errMsg}`);

      // 错误也通知用户
      try {
        await this.options.notifier.send(
          `[Daemon] ${taskName} FAILED`,
          `Task "${taskName}" failed: ${errMsg}`,
          notify,
          feishuChatId,
        );
      } catch {
        // 通知发送失败，仅记日志
      }

      throw err;
    }
  }

  private log(message: string): void {
    const line = message + '\n';
    console.log(message);
    try {
      fs.appendFileSync(this.options.logFile, line, 'utf-8');
    } catch {
      // 日志写入失败不影响执行
    }
  }

  /** 当前正在执行的任务数 */
  getRunningCount(): number {
    return this.running;
  }

  /** 队列中等待的任务数 */
  getQueuedCount(): number {
    return this.queue.length;
  }
}
