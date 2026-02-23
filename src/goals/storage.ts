/**
 * Goal 存储系统
 * 跨会话持久化目标管理
 * 
 * 参照 task-storage.ts 的设计模式：
 * - 每个目标存储为独立 JSON 文件
 * - 存储路径：~/.claude/goals/{projectHash}/goal-{id}.json
 * - 水位线递增 ID
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';
import * as path from 'path';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 目标状态
 */
export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';

/**
 * 目标优先级
 */
export type GoalPriority = 'high' | 'medium' | 'low';

/**
 * 目标子任务状态
 */
export type GoalTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * 目标子任务
 */
export interface GoalTask {
  id: string;
  name: string;
  status: GoalTaskStatus;
  completedAt?: string;
}

/**
 * 目标数据结构
 */
export interface Goal {
  /** 唯一标识符 */
  id: string;
  /** 目标标题 */
  title: string;
  /** 详细描述 */
  description: string;
  /** 目标状态 */
  status: GoalStatus;
  /** 优先级 */
  priority: GoalPriority;
  /** 创建时间 */
  created: string;
  /** 更新时间 */
  updated: string;
  /** 项目路径 */
  project: string;
  /** 子任务列表 */
  tasks: GoalTask[];
  /** 备注 */
  notes: string;
}

// ============================================================================
// 存储实现
// ============================================================================

// 缓存已创建的目录
const createdDirs = new Set<string>();

// 目标 ID 计数器缓存（按项目路径分组）
const idCounters = new Map<string, number>();

/**
 * 获取目标存储根目录
 */
function getGoalsRootDir(): string {
  return join(homedir(), '.claude', 'goals');
}

/**
 * 将项目路径转为安全的目录名（对齐 notebook.ts 的 sanitizeProjectPath）
 */
function sanitizeProjectPath(projectPath: string): string {
  const hash = crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
  const projectName = path.basename(projectPath)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `${projectName}-${hash}`;
}

/**
 * 获取指定项目的目标存储目录
 * 返回 ~/.claude/goals/{projectHash}/
 */
export function getGoalsDir(projectPath: string): string {
  return join(getGoalsRootDir(), sanitizeProjectPath(projectPath));
}

/**
 * 获取目标文件路径
 */
function getGoalFile(projectPath: string, goalId: string): string {
  return join(getGoalsDir(projectPath), `${goalId}.json`);
}

/**
 * 确保目录存在
 */
function ensureDir(projectPath: string): void {
  const dir = getGoalsDir(projectPath);
  if (!createdDirs.has(dir)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    createdDirs.add(dir);
  }
}

/**
 * 高水位线存储文件名（对齐 task-storage.ts）
 */
const HIGH_WATER_MARK_FILE = '.high-water-mark';

/**
 * 获取高水位线文件路径
 */
function getHighWaterMarkFile(projectPath: string): string {
  return join(getGoalsDir(projectPath), HIGH_WATER_MARK_FILE);
}

/**
 * 读取高水位线
 * 返回已使用的最高目标 ID
 */
function readHighWaterMark(projectPath: string): number {
  const file = getHighWaterMarkFile(projectPath);
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
 * 保存已使用的最高目标 ID
 */
function writeHighWaterMark(projectPath: string, value: number): void {
  ensureDir(projectPath);
  const file = getHighWaterMarkFile(projectPath);
  writeFileSync(file, String(value));
}

/**
 * 获取下一个目标 ID（水位线递增）
 * 返回格式：'goal-N'
 */
export function getNextGoalId(projectPath: string): string {
  const dir = getGoalsDir(projectPath);
  const cacheKey = sanitizeProjectPath(projectPath);

  // 检查缓存
  if (!idCounters.has(cacheKey)) {
    let maxId = 0;

    // 首先读取高水位线
    const highWaterMark = readHighWaterMark(projectPath);
    maxId = highWaterMark;

    // 然后扫描现有文件，以防高水位线文件损坏
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.startsWith('goal-') || !file.endsWith('.json')) continue;
        const idStr = file.replace('goal-', '').replace('.json', '');
        const id = parseInt(idStr, 10);
        if (!isNaN(id) && id > maxId) {
          maxId = id;
        }
      }
    }

    idCounters.set(cacheKey, maxId);
  }

  const nextId = (idCounters.get(cacheKey) || 0) + 1;
  idCounters.set(cacheKey, nextId);

  // 更新高水位线
  writeHighWaterMark(projectPath, nextId);

  return `goal-${nextId}`;
}

/**
 * 验证目标数据
 */
function validateGoal(data: unknown): Goal | null {
  if (!data || typeof data !== 'object') return null;

  const goal = data as Record<string, unknown>;

  // 验证必需字段
  if (typeof goal.id !== 'string') return null;
  if (typeof goal.title !== 'string') return null;
  if (typeof goal.description !== 'string') return null;
  if (!['active', 'paused', 'completed', 'abandoned'].includes(goal.status as string)) return null;
  if (!['high', 'medium', 'low'].includes(goal.priority as string)) return null;
  if (typeof goal.created !== 'string') return null;
  if (typeof goal.updated !== 'string') return null;
  if (typeof goal.project !== 'string') return null;
  if (!Array.isArray(goal.tasks)) return null;
  if (typeof goal.notes !== 'string') return null;

  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    status: goal.status as GoalStatus,
    priority: goal.priority as GoalPriority,
    created: goal.created,
    updated: goal.updated,
    project: goal.project,
    tasks: goal.tasks as GoalTask[],
    notes: goal.notes,
  };
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 加载单个目标
 */
export function loadGoal(projectPath: string, id: string): Goal | null {
  const file = getGoalFile(projectPath, id);

  if (!existsSync(file)) {
    return null;
  }

  try {
    const content = readFileSync(file, 'utf-8');
    const data = JSON.parse(content);
    return validateGoal(data);
  } catch (err) {
    console.error(`[Goals] Failed to read goal ${id}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * 加载所有活跃目标
 * 返回状态为 'active' 或 'paused' 的目标
 */
export function loadActiveGoals(projectPath: string): Goal[] {
  const dir = getGoalsDir(projectPath);

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir);
  const goals: Goal[] = [];

  for (const file of files) {
    if (!file.startsWith('goal-') || !file.endsWith('.json')) continue;

    const goalId = file.replace('.json', '');
    const goal = loadGoal(projectPath, goalId);
    if (goal && (goal.status === 'active' || goal.status === 'paused')) {
      goals.push(goal);
    }
  }

  return goals;
}

/**
 * 保存目标
 */
export function saveGoal(projectPath: string, goal: Goal): void {
  ensureDir(projectPath);

  const file = getGoalFile(projectPath, goal.id);
  writeFileSync(file, JSON.stringify(goal, null, 2));
}

/**
 * 删除目标
 */
export function deleteGoal(projectPath: string, id: string): void {
  const file = getGoalFile(projectPath, id);

  if (existsSync(file)) {
    unlinkSync(file);
  }
}
