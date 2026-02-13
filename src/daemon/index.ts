/**
 * Daemon Manager
 * 组装所有 daemon 组件：配置、存储、调度、监控、执行、通知
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { loadDaemonConfig, type DaemonConfig } from './config.js';
import { TaskStore, type ScheduledTask } from './store.js';
import { TaskExecutor } from './executor.js';
import { Scheduler } from './scheduler.js';
import { FileWatcher } from './watcher.js';
import { Notifier } from './notifier.js';

// ============================================================================
// 路径常量
// ============================================================================

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PID_FILE = path.join(CLAUDE_DIR, 'daemon.pid');

// ============================================================================
// 状态类型
// ============================================================================

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  watchCount: number;
  scheduledCount: number;
  dynamicTaskCount: number;
  executorRunning: number;
  executorQueued: number;
}

// ============================================================================
// DaemonManager
// ============================================================================

export class DaemonManager {
  private config!: DaemonConfig;
  private store: TaskStore;
  private executor!: TaskExecutor;
  private scheduler!: Scheduler;
  private watcher!: FileWatcher;
  private notifier!: Notifier;
  private reloadTimer: NodeJS.Timeout | null = null;
  private cwd: string;

  constructor(options: { cwd?: string } = {}) {
    this.cwd = options.cwd || process.cwd();
    this.store = new TaskStore();
  }

  /**
   * 启动 daemon
   */
  async start(): Promise<void> {
    // 检查是否已有 daemon 运行
    if (isDaemonRunning()) {
      const pid = readPid();
      throw new Error(`Daemon already running (PID: ${pid}). Use "claude daemon stop" first.`);
    }

    // 加载配置
    this.config = loadDaemonConfig(this.cwd);
    const settings = this.config.settings;

    // 解析日志文件路径
    const logFile = path.isAbsolute(settings.logFile)
      ? settings.logFile
      : path.resolve(this.cwd, settings.logFile);

    // 解析工作目录
    const workingDir = path.isAbsolute(settings.workingDir)
      ? settings.workingDir
      : path.resolve(this.cwd, settings.workingDir);

    // 初始化组件
    this.notifier = new Notifier({
      feishuChatId: settings.feishuChatId || undefined,
    });

    this.executor = new TaskExecutor({
      maxConcurrent: settings.maxConcurrent,
      notifier: this.notifier,
      logFile,
      defaultModel: settings.model,
      defaultPermissionMode: settings.permissionMode,
      defaultWorkingDir: workingDir,
    });

    this.scheduler = new Scheduler(this.executor, this.store);
    this.watcher = new FileWatcher(this.executor);

    // 注册静态 watch 规则
    for (let i = 0; i < this.config.watch.length; i++) {
      const rule = this.config.watch[i];
      const ruleId = `static-watch-${i}`;
      console.log(chalk.blue(`  Watch: ${rule.name} → ${rule.paths.join(', ')}`));
      this.watcher.watchRule(ruleId, rule, workingDir);
    }

    // 注册静态 cron 规则（转为 ScheduledTask 格式）
    for (let i = 0; i < this.config.cron.length; i++) {
      const rule = this.config.cron[i];
      const task: ScheduledTask = {
        id: `static-cron-${i}`,
        type: 'interval',
        name: rule.name,
        intervalMs: rule.interval,
        prompt: rule.prompt,
        model: rule.model,
        notify: rule.notify,
        feishuChatId: rule.feishuChatId,
        createdAt: Date.now(),
        createdBy: 'config',
        workingDir,
        enabled: true,
      };
      console.log(chalk.blue(`  Cron: ${rule.name} → every ${rule.interval}ms`));
      this.scheduler.scheduleInterval(task);
    }

    // 注册动态任务
    this.registerDynamicTasks();

    // 写 PID 文件
    writePid();

    // 启动 reload 轮询
    this.reloadTimer = setInterval(() => {
      if (this.store.checkReloadSignal()) {
        console.log(chalk.yellow('[Daemon] Reload signal detected, reloading tasks...'));
        this.reloadDynamicTasks();
      }
    }, settings.reloadInterval);
    this.reloadTimer.unref();

    // 注册退出处理
    const cleanup = () => {
      this.stop();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    console.log(chalk.green('\nDaemon started.'));
    console.log(chalk.gray(`  PID: ${process.pid}`));
    console.log(chalk.gray(`  Working dir: ${workingDir}`));
    console.log(chalk.gray(`  Log file: ${logFile}`));
    console.log(chalk.gray(`  Watch rules: ${this.watcher.getActiveCount()}`));
    console.log(chalk.gray(`  Scheduled tasks: ${this.scheduler.getActiveCount()}`));
    console.log(chalk.gray(`  Dynamic tasks: ${this.store.listTasks().length}`));
    console.log(chalk.gray('\nWaiting for events... (Ctrl+C to stop)\n'));
  }

  /**
   * 停止 daemon
   */
  stop(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.watcher?.unwatchAll();
    this.scheduler?.cancelAll();
    removePid();
    console.log(chalk.yellow('Daemon stopped.'));
  }

  /**
   * 获取状态
   */
  getStatus(): DaemonStatus {
    return {
      running: true,
      pid: process.pid,
      watchCount: this.watcher?.getActiveCount() || 0,
      scheduledCount: this.scheduler?.getActiveCount() || 0,
      dynamicTaskCount: this.store.listTasks().length,
      executorRunning: this.executor?.getRunningCount() || 0,
      executorQueued: this.executor?.getQueuedCount() || 0,
    };
  }

  /**
   * 注册所有动态任务
   */
  private registerDynamicTasks(): void {
    const tasks = this.store.listTasks();
    for (const task of tasks) {
      if (!task.enabled) continue;
      this.registerTask(task);
    }
  }

  /**
   * 热加载：重新加载动态任务列表，增量注册/取消
   */
  private reloadDynamicTasks(): void {
    const oldTasks = this.store.listTasks();
    const oldIds = new Set(oldTasks.map(t => t.id));

    // 重新从磁盘加载
    const newTasks = this.store.reload();
    const newIds = new Set(newTasks.map(t => t.id));

    // 取消已删除的
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        this.scheduler.cancel(id);
        this.watcher.unwatch(id);
      }
    }

    // 新增的注册
    for (const task of newTasks) {
      if (!task.enabled) continue;
      if (!oldIds.has(task.id)) {
        this.registerTask(task);
        console.log(chalk.blue(`  New task: ${task.name} (${task.type})`));
      }
    }
  }

  /**
   * 注册单个动态任务到对应的调度器
   */
  private registerTask(task: ScheduledTask): void {
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
}

// ============================================================================
// PID 文件辅助函数（导出供 CLI 使用）
// ============================================================================

function readPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(): void {
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

function removePid(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // 忽略
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查 daemon 是否正在运行
 */
export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  if (!isProcessAlive(pid)) {
    // 进程已死，清理 PID 文件
    removePid();
    return false;
  }
  return true;
}

/**
 * 停止正在运行的 daemon
 */
export function stopDaemon(): boolean {
  const pid = readPid();
  if (pid === null) return false;

  if (!isProcessAlive(pid)) {
    removePid();
    return false;
  }

  try {
    process.kill(pid, 'SIGTERM');
    removePid();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 daemon 状态（从外部查询）
 */
export function getDaemonStatus(): DaemonStatus {
  const pid = readPid();
  const running = pid !== null && isProcessAlive(pid);

  if (!running) {
    return {
      running: false,
      pid: null,
      watchCount: 0,
      scheduledCount: 0,
      dynamicTaskCount: 0,
      executorRunning: 0,
      executorQueued: 0,
    };
  }

  // 只能获取基本信息，详细状态需要在 daemon 进程内部获取
  const store = new TaskStore();
  return {
    running: true,
    pid,
    watchCount: -1, // 无法从外部获取
    scheduledCount: -1,
    dynamicTaskCount: store.listTasks().length,
    executorRunning: -1,
    executorQueued: -1,
  };
}
