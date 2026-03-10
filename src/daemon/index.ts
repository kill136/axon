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
import { GoalDaemon } from '../goals/goal-daemon.js';

// ============================================================================
// 路径常量
// ============================================================================

const AXON_DIR = path.join(os.homedir(), '.axon');
const PID_FILE = path.join(AXON_DIR, 'daemon.pid');

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
  private goalDaemon!: GoalDaemon;
  private goalTimer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private cwd: string;

  constructor(options: { cwd?: string } = {}) {
    this.cwd = options.cwd || process.cwd();
    this.store = new TaskStore();
  }

  /**
   * 启动 daemon
   */
  async start(): Promise<void> {
    // 启动诊断日志
    console.log(`[Daemon] Starting at ${new Date().toISOString()}`);
    console.log(`[Daemon] PID: ${process.pid}`);
    console.log(`[Daemon] Node: ${process.version}`);
    console.log(`[Daemon] Platform: ${process.platform} ${process.arch}`);
    console.log(`[Daemon] CWD: ${this.cwd}`);

    // 检查是否已有 daemon 运行
    if (isDaemonRunning()) {
      const pid = readPid();
      throw new Error(`Daemon already running (PID: ${pid}). Use "claude daemon stop" first.`);
    }

    // 加载配置
    this.config = loadDaemonConfig(this.cwd);
    const settings = this.config.settings;
    console.log(`[Daemon] Config loaded: maxConcurrent=${settings.maxConcurrent}, model=${settings.model}, reloadInterval=${settings.reloadInterval}ms`);

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

    // 重启补偿：执行错过的任务
    console.log('[Daemon] Checking for missed jobs...');
    await this.scheduler.runMissedJobs();

    // 重新计算所有 nextRunAtMs 并启动 timer
    this.scheduler.recomputeNextRuns();
    this.scheduler.armTimer();

    // 写 PID 文件
    writePid();

    // 启动 reload 轮询（不 unref，确保 daemon 进程存活）
    this.reloadTimer = setInterval(() => {
      if (this.store.checkReloadSignal()) {
        console.log(chalk.yellow('[Daemon] Reload signal detected, reloading tasks...'));
        this.reloadDynamicTasks();
      }
    }, settings.reloadInterval);

    // 启动 keepalive 定时器，防止进程因为没有活跃 timer 而退出
    // 每 60 秒运行一次空操作，确保进程持续存活
    this.keepaliveTimer = setInterval(() => {
      // 空操作，仅用于保持进程存活
    }, 60000);

    // 启动 GoalDaemon — 持久目标系统
    this.goalDaemon = new GoalDaemon();
    this.startGoalLoop();

    // 注册退出处理
    const cleanup = () => {
      this.stop();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const activeGoals = this.goalDaemon.getStore().listGoals('active');
    console.log(chalk.green('\nDaemon started.'));
    console.log(chalk.gray(`  PID: ${process.pid}`));
    console.log(chalk.gray(`  Working dir: ${workingDir}`));
    console.log(chalk.gray(`  Log file: ${logFile}`));
    console.log(chalk.gray(`  Watch rules: ${this.watcher.getActiveCount()}`));
    console.log(chalk.gray(`  Scheduled tasks: ${this.scheduler.getActiveCount()}`));
    console.log(chalk.gray(`  Dynamic tasks: ${this.store.listTasks().length}`));
    console.log(chalk.gray(`  Active goals: ${activeGoals.length}`));
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
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.goalTimer) {
      clearTimeout(this.goalTimer);
      this.goalTimer = null;
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

    // 重新计算并启动 timer
    this.scheduler.recomputeNextRuns();
    this.scheduler.armTimer();
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

  // =========================================================================
  // GoalDaemon 集成 — 持久目标系统
  // =========================================================================

  /**
   * 启动目标检查循环
   * 每 60 秒检查一次是否有到期的目标需要执行
   * 实际的执行间隔由每个 goal 的 checkIntervalMs 决定
   */
  private startGoalLoop(): void {
    const GOAL_CHECK_INTERVAL = 60_000; // 60 秒检查一次

    const tick = async () => {
      try {
        const jobs = await this.goalDaemon.tick();
        for (const job of jobs) {
          // 将目标的执行任务转换为 ScheduledTask，复用 executor
          const pseudoTask: ScheduledTask = {
            id: `goal-${job.goalId}-${Date.now()}`,
            type: 'once',
            name: `Goal: ${job.goalId}`,
            prompt: job.prompt,
            model: job.model,
            notify: ['desktop'],
            createdAt: Date.now(),
            createdBy: 'goal-daemon',
            workingDir: job.workingDir,
            enabled: true,
            authSnapshot: job.authSnapshot,
          };

          console.log(chalk.magenta(`[GoalDaemon] Executing goal check: ${job.goalId}`));

          try {
            await this.executor.execute({ task: pseudoTask });
            this.goalDaemon.getStore().appendLog(job.goalId, 'execute', 'Goal check completed successfully');
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.goalDaemon.getStore().appendLog(job.goalId, 'execute', `Goal check failed: ${errMsg}`);
            console.error(chalk.red(`[GoalDaemon] Goal ${job.goalId} execution error: ${errMsg}`));
          }
        }
      } catch (err) {
        console.error(`[GoalDaemon] Tick error:`, err instanceof Error ? err.message : err);
      }

      // 调度下一次
      this.goalTimer = setTimeout(tick, GOAL_CHECK_INTERVAL);
    };

    // 首次延迟 10 秒启动，让其他组件先初始化完
    this.goalTimer = setTimeout(tick, 10_000);
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
  if (!fs.existsSync(AXON_DIR)) {
    fs.mkdirSync(AXON_DIR, { recursive: true });
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
