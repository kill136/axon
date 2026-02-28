/**
 * Task v2 存储系统
 * 官方 2.1.16 新增的任务管理系统，支持依赖追踪
 *
 * 基于官方实现：
 * - 每个任务存储为独立 JSON 文件
 * - 存储路径：~/.axon/tasks/{listId}/{taskId}.json
 * - 支持依赖追踪：blocks / blockedBy
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Task v2 状态
 * 官方 2.1.20 新增 'deleted' 状态
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

/**
 * Task v2 数据结构（官方 Sm3 schema）
 */
export interface TaskV2 {
  /** 唯一标识符 */
  id: string;
  /** 任务简短标题 */
  subject: string;
  /** 详细描述 */
  description: string;
  /** 进行中时显示的文本（可选） */
  activeForm?: string;
  /** 所有者（多代理场景，可选） */
  owner?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 该任务阻塞的任务 ID 列表 */
  blocks: string[];
  /** 阻塞该任务的任务 ID 列表 */
  blockedBy: string[];
  /** 任意元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * TaskCreate 输入
 */
export interface TaskCreateInput {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

/**
 * TaskCreate 输出
 */
export interface TaskCreateOutput {
  task: {
    id: string;
    subject: string;
  };
}

/**
 * TaskGet 输入
 */
export interface TaskGetInput {
  taskId: string;
}

/**
 * TaskGet 输出
 */
export interface TaskGetOutput {
  task: {
    id: string;
    subject: string;
    description: string;
    status: TaskStatus;
    blocks: string[];
    blockedBy: string[];
  } | null;
}

/**
 * TaskUpdate 输入
 */
export interface TaskUpdateInput {
  taskId: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  addBlocks?: string[];
  addBlockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
}

/**
 * TaskUpdate 输出
 */
export interface TaskUpdateOutput {
  success: boolean;
  taskId: string;
  updatedFields: string[];
  error?: string;
  statusChange?: {
    from: string;
    to: string;
  };
}

/**
 * TaskList 输出
 */
export interface TaskListOutput {
  tasks: Array<{
    id: string;
    subject: string;
    status: TaskStatus;
    owner?: string;
    blockedBy: string[];
  }>;
}

// ============================================================================
// 存储实现
// ============================================================================

// 缓存已创建的目录
const createdDirs = new Set<string>();

// 任务 ID 计数器缓存
const idCounters = new Map<string, number>();

/**
 * 获取任务存储根目录
 */
function getTasksDir(): string {
  return join(homedir(), '.axon', 'tasks');
}

/**
 * 规范化列表 ID（移除非法字符）
 */
function normalizeListId(listId: string): string {
  return listId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * 获取指定列表的存储目录
 */
function getListDir(listId: string): string {
  return join(getTasksDir(), normalizeListId(listId));
}

/**
 * 获取任务文件路径
 */
function getTaskFile(listId: string, taskId: string): string {
  return join(getListDir(listId), `${normalizeListId(taskId)}.json`);
}

/**
 * 确保目录存在
 */
function ensureDir(listId: string): void {
  const dir = getListDir(listId);
  if (!createdDirs.has(dir)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    createdDirs.add(dir);
  }
}

/**
 * 高水位线存储文件名
 * v2.1.21: 修复任务 ID 重用问题
 * 使用一个单独的文件来存储已使用的最高 ID，
 * 这样即使任务被删除，ID 也不会被重用
 */
const HIGH_WATER_MARK_FILE = '.high-water-mark';

/**
 * 获取高水位线文件路径
 */
function getHighWaterMarkFile(listId: string): string {
  return join(getListDir(listId), HIGH_WATER_MARK_FILE);
}

/**
 * 读取高水位线
 * 返回已使用的最高任务 ID
 */
function readHighWaterMark(listId: string): number {
  const file = getHighWaterMarkFile(listId);
  if (!existsSync(file)) {
    return 0;
  }
  try {
    const content = readFileSync(file, 'utf-8').trim();
    const value = parseInt(content, 10);
    return isNaN(value) ? 0 : value;
  } catch {
    return 0;
  }
}

/**
 * 写入高水位线
 * 保存已使用的最高任务 ID
 */
function writeHighWaterMark(listId: string, value: number): void {
  ensureDir(listId);
  const file = getHighWaterMarkFile(listId);
  writeFileSync(file, String(value));
}

/**
 * 获取下一个任务 ID（递增整数）
 *
 * v2.1.21 修复：使用高水位线机制防止任务 ID 重用
 * 即使任务被删除，新任务也会获得更高的 ID
 */
function getNextTaskId(listId: string): string {
  const dir = getListDir(listId);

  // 检查缓存
  if (!idCounters.has(listId)) {
    let maxId = 0;

    // 首先读取高水位线（记录曾经使用过的最高 ID）
    const highWaterMark = readHighWaterMark(listId);
    maxId = highWaterMark;

    // 然后扫描现有文件，以防高水位线文件损坏或不存在
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = parseInt(file.replace('.json', ''), 10);
        if (!isNaN(id) && id > maxId) {
          maxId = id;
        }
      }
    }

    idCounters.set(listId, maxId);
  }

  const nextId = (idCounters.get(listId) || 0) + 1;
  idCounters.set(listId, nextId);

  // 更新高水位线
  writeHighWaterMark(listId, nextId);

  return String(nextId);
}

/**
 * 验证任务数据
 */
function validateTask(data: unknown): TaskV2 | null {
  if (!data || typeof data !== 'object') return null;

  const task = data as Record<string, unknown>;

  // 验证必需字段
  if (typeof task.id !== 'string') return null;
  if (typeof task.subject !== 'string') return null;
  if (typeof task.description !== 'string') return null;
  if (!['pending', 'in_progress', 'completed', 'deleted'].includes(task.status as string)) return null;
  if (!Array.isArray(task.blocks)) return null;
  if (!Array.isArray(task.blockedBy)) return null;

  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    activeForm: typeof task.activeForm === 'string' ? task.activeForm : undefined,
    owner: typeof task.owner === 'string' ? task.owner : undefined,
    status: task.status as TaskStatus,
    blocks: task.blocks as string[],
    blockedBy: task.blockedBy as string[],
    metadata: typeof task.metadata === 'object' ? task.metadata as Record<string, unknown> : undefined,
  };
}

// ============================================================================
// 核心函数（对应官方实现）
// ============================================================================

/**
 * 获取当前的任务列表 ID
 * 官方 tj() 函数
 */
export function getCurrentListId(): string {
  // 优先使用环境变量
  if (process.env.AXON_TASK_LIST_ID) {
    return process.env.AXON_TASK_LIST_ID;
  }
  // 使用默认列表 ID
  return 'default';
}

/**
 * 创建新任务
 * 官方 W71() 函数
 */
export function createTask(listId: string, taskData: Omit<TaskV2, 'id'>): string {
  ensureDir(listId);

  const id = getNextTaskId(listId);
  const task: TaskV2 = {
    id,
    ...taskData,
  };

  const file = getTaskFile(listId, id);
  writeFileSync(file, JSON.stringify(task, null, 2));

  return id;
}

/**
 * 获取单个任务
 * 官方 An() 函数
 */
export function getTask(listId: string, taskId: string): TaskV2 | null {
  const file = getTaskFile(listId, taskId);

  if (!existsSync(file)) {
    return null;
  }

  try {
    const content = readFileSync(file, 'utf-8');
    const data = JSON.parse(content);
    return validateTask(data);
  } catch (err) {
    console.error(`[Tasks] Failed to read task ${taskId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * 更新任务
 * 官方 S0A() 函数
 */
export function updateTask(listId: string, taskId: string, updates: Partial<Omit<TaskV2, 'id'>>): TaskV2 | null {
  const task = getTask(listId, taskId);
  if (!task) return null;

  const updatedTask: TaskV2 = {
    ...task,
    ...updates,
  };

  const file = getTaskFile(listId, taskId);
  writeFileSync(file, JSON.stringify(updatedTask, null, 2));

  return updatedTask;
}

/**
 * 获取所有任务
 * 官方 $T() 函数
 */
export function getAllTasks(listId: string): TaskV2[] {
  const dir = getListDir(listId);

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir);
  const tasks: TaskV2[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const taskId = file.replace('.json', '');
    const task = getTask(listId, taskId);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * 添加依赖关系
 * 官方 r16() 函数
 *
 * @param listId 列表 ID
 * @param blockerId 阻塞者任务 ID（该任务阻塞其他任务）
 * @param blockedId 被阻塞任务 ID（该任务被阻塞）
 * @returns 是否成功
 */
export function addDependency(listId: string, blockerId: string, blockedId: string): boolean {
  const blocker = getTask(listId, blockerId);
  const blocked = getTask(listId, blockedId);

  if (!blocker || !blocked) {
    return false;
  }

  // 更新阻塞者的 blocks 列表
  if (!blocker.blocks.includes(blockedId)) {
    updateTask(listId, blockerId, {
      blocks: [...blocker.blocks, blockedId],
    });
  }

  // 更新被阻塞者的 blockedBy 列表
  if (!blocked.blockedBy.includes(blockerId)) {
    updateTask(listId, blockedId, {
      blockedBy: [...blocked.blockedBy, blockerId],
    });
  }

  return true;
}

/**
 * 检查值是否为 falsy
 * 官方 $2() 函数
 * 支持: 0, false, no, off (不区分大小写)
 */
function isFalsy(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return !value;
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  return ['0', 'false', 'no', 'off'].includes(lower);
}

/**
 * 检查值是否为 truthy
 * 官方 E1() 函数
 * 支持: 1, true, yes, on (不区分大小写)
 */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  if (typeof value === 'boolean') return value;
  const lower = value.toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(lower);
}

/**
 * 检查是否是非交互（SDK）模式
 * 官方 h7() 函数
 * 在 SDK 模式下，默认禁用 Tasks（保持旧的 TodoWrite 行为）
 */
function isNonInteractiveMode(): boolean {
  // 检查是否是 SDK 模式
  if (process.env.AXON_SDK_MODE === '1' || process.env.AXON_SDK_MODE === 'true') {
    return true;
  }
  // 检查是否没有 TTY（非交互式终端）
  if (!process.stdout.isTTY && !process.env.FORCE_INTERACTIVE) {
    return true;
  }
  return false;
}

/**
 * 检查是否启用了 Task v2 系统
 * 官方 ew() 函数
 *
 * 逻辑（官方 2.1.19）:
 * 1. 如果 AXON_ENABLE_TASKS 显式设为 false -> 返回 false
 * 2. 如果 AXON_ENABLE_TASKS 显式设为 true -> 返回 true
 * 3. 如果是非交互（SDK）模式 -> 返回 false（兼容性）
 * 4. 否则返回 true（默认启用）
 */
export function isTasksEnabled(): boolean {
  const envValue = process.env.AXON_ENABLE_TASKS;

  // 显式禁用
  if (isFalsy(envValue)) {
    return false;
  }

  // 显式启用
  if (isTruthy(envValue)) {
    return true;
  }

  // 非交互模式默认禁用（兼容性）
  if (isNonInteractiveMode()) {
    return false;
  }

  // 默认启用（与官方 2.1.16+ 保持一致）
  return true;
}

/**
 * 有效的状态列表
 * 官方 2.1.20 新增 'deleted' 状态，用于删除任务
 */
export const VALID_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed', 'deleted'];
