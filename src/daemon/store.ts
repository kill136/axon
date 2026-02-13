/**
 * Daemon 任务持久化存储
 * 管理动态创建的定时/监控任务，持久化到 ~/.claude/daemon-tasks.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// 类型定义
// ============================================================================

export interface ScheduledTask {
  id: string;
  type: 'once' | 'interval' | 'watch';
  name: string;

  /** once 类型：触发时间 Unix timestamp ms */
  triggerAt?: number;

  /** interval 类型：毫秒间隔 */
  intervalMs?: number;

  /** watch 类型：glob patterns */
  watchPaths?: string[];

  /** watch 类型：监听事件 */
  watchEvents?: string[];

  /** watch 类型：防抖 ms */
  debounceMs?: number;

  /** AI prompt（必填，所有任务都走 AI） */
  prompt: string;

  /** 通知渠道 */
  notify: ('desktop' | 'feishu')[];

  /** 飞书目标会话 ID */
  feishuChatId?: string;

  /** 创建时间 */
  createdAt: number;

  /** 创建来源 session id */
  createdBy: string;

  /** 工作目录 */
  workingDir: string;

  /** 模型 */
  model?: string;

  /** 是否启用 */
  enabled: boolean;
}

// ============================================================================
// 路径常量
// ============================================================================

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const TASKS_FILE = path.join(CLAUDE_DIR, 'daemon-tasks.json');
const RELOAD_SIGNAL = path.join(CLAUDE_DIR, 'daemon-reload');

// ============================================================================
// TaskStore
// ============================================================================

export class TaskStore {
  private tasks: ScheduledTask[] = [];

  constructor() {
    this.ensureDir();
    this.tasks = this.loadFromDisk();
  }

  private ensureDir(): void {
    if (!fs.existsSync(CLAUDE_DIR)) {
      fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    }
  }

  private loadFromDisk(): ScheduledTask[] {
    try {
      if (!fs.existsSync(TASKS_FILE)) return [];
      const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data;
    } catch {
      return [];
    }
  }

  private saveToDisk(): void {
    const tmpFile = TASKS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(this.tasks, null, 2), 'utf-8');
    fs.renameSync(tmpFile, TASKS_FILE);
  }

  /** 重新从磁盘加载（daemon 热加载用） */
  reload(): ScheduledTask[] {
    this.tasks = this.loadFromDisk();
    return this.tasks;
  }

  /** 获取所有任务 */
  listTasks(): ScheduledTask[] {
    return [...this.tasks];
  }

  /** 获取单个任务 */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** 添加任务 */
  addTask(task: Omit<ScheduledTask, 'id' | 'createdAt'>): ScheduledTask {
    const full: ScheduledTask = {
      ...task,
      id: uuidv4(),
      createdAt: Date.now(),
    };
    this.tasks.push(full);
    this.saveToDisk();
    return full;
  }

  /** 删除任务 */
  removeTask(id: string): boolean {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.id !== id);
    if (this.tasks.length !== before) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  /** 更新任务 */
  updateTask(id: string, updates: Partial<ScheduledTask>): boolean {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks[idx] = { ...this.tasks[idx], ...updates };
    this.saveToDisk();
    return true;
  }

  /** 写入 reload 信号文件，通知运行中的 daemon 热加载 */
  signalReload(): void {
    this.ensureDir();
    fs.writeFileSync(RELOAD_SIGNAL, String(Date.now()), 'utf-8');
  }

  /** 检查是否有 reload 信号，有则删除并返回 true */
  checkReloadSignal(): boolean {
    try {
      if (fs.existsSync(RELOAD_SIGNAL)) {
        fs.unlinkSync(RELOAD_SIGNAL);
        return true;
      }
    } catch {
      // 忽略竞争条件错误
    }
    return false;
  }
}
