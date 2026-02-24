/**
 * Daemon 任务执行器
 * 通过 ConversationLoop 执行 AI prompt 并发送通知
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ConversationLoop } from '../core/loop.js';
import { initAuth, getAuth } from '../auth/index.js';
import { Notifier } from './notifier.js';
import { TaskStore, type ScheduledTask } from './store.js';
import { appendRunLog, type RunLogEntry } from './run-log.js';

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
  /** 正在执行的任务 ID 集合（用于避免自反馈循环） */
  private executingTasks = new Set<string>();

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
    
    // 获取超时配置，默认 5 分钟
    const timeoutMs = ('timeoutMs' in task && task.timeoutMs) ? task.timeoutMs : 300000;

    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    this.log(`[${timestamp}] Executing task: ${taskName}`);
    this.log(`  Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);
    this.log(`  Timeout: ${timeoutMs}ms`);

    // 获取 task id 用于状态更新（仅 ScheduledTask 类型有 id）
    const taskId = 'id' in task ? task.id : undefined;

    // 标记任务开始执行（用于避免 watch 任务的自反馈循环）
    if (taskId) {
      this.executingTasks.add(taskId);
    }

    // 构造增强版 prompt：注入 notebook 和任务上下文（把模型当人看）
    const enrichedPrompt = this.buildEnrichedPrompt(task, prompt, workingDir);

    try {
      // 从任务的 authSnapshot 恢复认证（创建任务时快照的）
      // 如果没有快照，回退到 initAuth() + getAuth() 从当前进程获取
      let authSnap = 'authSnapshot' in task ? task.authSnapshot : undefined;
      if (!authSnap) {
        if (!this.authInitialized) {
          initAuth();
          this.authInitialized = true;
        }
        // 主动从当前进程获取认证信息，而不是让 ConversationLoop 自己找
        // 这样即使环境变量缺失，也能用 initAuth() 从文件/keychain 读到的凭证
        const currentAuth = getAuth();
        if (currentAuth) {
          if (currentAuth.type === 'api_key' && currentAuth.apiKey) {
            authSnap = { apiKey: currentAuth.apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL };
          } else if (currentAuth.type === 'oauth') {
            const token = currentAuth.authToken || currentAuth.accessToken;
            if (token) {
              authSnap = { authToken: token, baseUrl: process.env.ANTHROPIC_BASE_URL };
            }
          }
        }
      }

      // 创建临时 ConversationLoop
      // 排除 daemon 无人值守环境中不适用的工具：
      // - ScheduleTask: 防止模型在执行任务时创建新的定时任务（递归调度）
      // - AskUserQuestion: daemon 无人交互，不能提问
      const loop = new ConversationLoop({
        model,
        permissionMode: this.options.defaultPermissionMode as any,
        workingDir,
        maxTurns: 10,
        verbose: false,
        isSubAgent: false,
        disallowedTools: ['ScheduleTask', 'AskUserQuestion'],
        // 从 authSnapshot 恢复认证，让 daemon 复用创建时的凭证
        ...(authSnap?.apiKey && { apiKey: authSnap.apiKey }),
        ...(authSnap?.authToken && { authToken: authSnap.authToken }),
        ...(authSnap?.baseUrl && { baseUrl: authSnap.baseUrl }),
      });

      // 执行增强版 prompt，使用 Promise.race 添加超时保护
      const timeoutError = `Task execution timeout after ${timeoutMs}ms`;
      let timeoutTimer: NodeJS.Timeout | undefined;
      const response = await Promise.race<string>([
        loop.processMessage(enrichedPrompt).finally(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
        }),
        new Promise<string>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            // 尝试中止 ConversationLoop
            if (typeof (loop as any).abort === 'function') {
              (loop as any).abort();
            }
            reject(new Error(timeoutError));
          }, timeoutMs);
        }),
      ]);

      const endedAt = Date.now();
      this.log(`  Result: ${response.slice(0, 500)}${response.length > 500 ? '...' : ''}`);
      this.log(`  Duration: ${endedAt - startedAt}ms`);

      // 写入结构化运行日志
      if (taskId) {
        await appendRunLog({
          ts: endedAt,
          taskId,
          taskName,
          action: 'finished',
          status: 'success',
          summary: response.slice(0, 500),
          durationMs: endedAt - startedAt,
        }).catch(() => {});
      }

      // 追加执行摘要到 executionMemory（记忆链，让下次执行知道之前做了什么）
      if (taskId) {
        try {
          const store = new TaskStore();
          const currentTask = store.getTask(taskId);
          if (currentTask) {
            const memory = [...(currentTask.executionMemory || [])];
            memory.push(`[${new Date().toLocaleString()}] ${response.slice(0, 200)}`);
            while (memory.length > 10) memory.shift();
            store.updateTask(taskId, { executionMemory: memory });
          }
        } catch {
          // 记忆追加失败不影响主流程
        }
      }

      // 发送通知
      await this.options.notifier.send(
        `[Daemon] ${taskName}`,
        response.length > 1000 ? response.slice(0, 997) + '...' : response,
        notify,
        feishuChatId,
      );

      return response;
    } catch (err) {
      const endedAt = Date.now();
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes('timeout');
      this.log(`  ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${errMsg}`);
      this.log(`  Duration: ${endedAt - startedAt}ms`);

      // 写入结构化运行日志
      if (taskId) {
        await appendRunLog({
          ts: endedAt,
          taskId,
          taskName,
          action: 'finished',
          status: isTimeout ? 'timeout' : 'failed',
          error: errMsg,
          durationMs: endedAt - startedAt,
        }).catch(() => {});
      }

      // 错误也通知用户
      try {
        await this.options.notifier.send(
          `[Daemon] ${taskName} ${isTimeout ? 'TIMEOUT' : 'FAILED'}`,
          `Task "${taskName}" ${isTimeout ? 'timed out' : 'failed'}: ${errMsg}`,
          notify,
          feishuChatId,
        );
      } catch {
        // 通知发送失败，仅记日志
      }

      throw err;
    } finally {
      // 清除执行标记（无论成功还是失败）
      if (taskId) {
        this.executingTasks.delete(taskId);
      }
    }
  }

  /**
   * 构造增强版 prompt：注入 notebook 记忆和任务上下文
   * 让后台执行的模型不再"失忆"
   */
  private buildEnrichedPrompt(
    task: TaskExecution['task'],
    basePrompt: string,
    workingDir: string,
  ): string {
    const parts: string[] = [];

    // 1. 读取用户 notebook（experience.md）
    try {
      const experiencePath = path.join(os.homedir(), '.claude', 'memory', 'experience.md');
      if (fs.existsSync(experiencePath)) {
        const content = fs.readFileSync(experiencePath, 'utf-8').trim();
        if (content) {
          parts.push('## 用户信息（你的记忆）');
          parts.push(content);
        }
      }
    } catch { /* 读取失败不影响执行 */ }

    // 2. 读取项目 notebook（project.md）
    try {
      const projectHash = crypto.createHash('md5').update(workingDir).digest('hex').slice(0, 12);
      const projectDir = path.join(os.homedir(), '.claude', 'memory', 'projects');
      // 尝试匹配 projectHash 开头的目录
      if (fs.existsSync(projectDir)) {
        const dirs = fs.readdirSync(projectDir);
        const matchDir = dirs.find(d => d.includes(projectHash));
        if (matchDir) {
          const projectMdPath = path.join(projectDir, matchDir, 'project.md');
          if (fs.existsSync(projectMdPath)) {
            const content = fs.readFileSync(projectMdPath, 'utf-8').trim();
            if (content) {
              parts.push('## 项目信息');
              parts.push(content);
            }
          }
        }
      }
    } catch { /* 读取失败不影响执行 */ }

    // 3. 任务上下文
    parts.push('## 定时任务信息');
    parts.push(`任务名称：${task.name}`);

    if ('context' in task && task.context) {
      parts.push(`创建时的对话背景：${task.context}`);
    }

    // 4. 历史执行记录
    if ('executionMemory' in task && task.executionMemory && task.executionMemory.length > 0) {
      parts.push('');
      parts.push('### 历史执行记录');
      for (const mem of task.executionMemory) {
        parts.push(`- ${mem}`);
      }
    }

    // 5. 最后是实际任务指令
    parts.push('');
    parts.push('## 请执行以下任务');
    parts.push(basePrompt);

    return parts.join('\n');
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
