/**
 * 后台对话任务管理器
 * 用于实现 Ctrl+B 将当前对话转到后台运行的功能
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { isBackgroundTasksDisabled } from '../utils/env-check.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface BackgroundConversationTask {
  id: string;
  type: 'conversation';
  userInput: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  // 输出累积
  textOutput: string;
  toolCalls: Array<{
    name: string;
    input: unknown;
    result?: string;
    error?: string;
    timestamp: number;
  }>;
  // 输出文件路径
  outputFile: string;
  outputStream?: fs.WriteStream;
  // 取消标志
  cancelled: boolean;
  // 错误信息
  error?: string;
}

export interface TaskSummary {
  id: string;
  type: string;
  status: string;
  userInput: string;
  duration: number;
  outputPreview: string;
}

// ============================================================================
// 后台任务存储
// ============================================================================

const backgroundConversationTasks = new Map<string, BackgroundConversationTask>();

// 定时清理已完成的后台对话任务，防止 Map 无限增长
const CONV_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
let _convCleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureConvCleanupTimer(): void {
  if (_convCleanupTimer) return;
  _convCleanupTimer = setInterval(() => {
    cleanupCompletedTasks();
    if (backgroundConversationTasks.size === 0 && _convCleanupTimer) {
      clearInterval(_convCleanupTimer);
      _convCleanupTimer = null;
    }
  }, CONV_CLEANUP_INTERVAL_MS);
  if (_convCleanupTimer && typeof _convCleanupTimer === 'object' && 'unref' in _convCleanupTimer) {
    _convCleanupTimer.unref();
  }
}

// 获取任务输出目录
function getTasksDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const tasksDir = path.join(homeDir, '.claude', 'tasks', 'conversations');

  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  return tasksDir;
}

// 获取任务输出文件路径
function getTaskOutputPath(taskId: string): string {
  return path.join(getTasksDir(), `${taskId}.log`);
}

// ============================================================================
// 后台任务管理 API
// ============================================================================

/**
 * 创建新的后台对话任务
 */
export function createBackgroundTask(userInput: string): BackgroundConversationTask | null {
  // 检查环境变量：CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
  if (isBackgroundTasksDisabled()) {
    console.log('[BackgroundTasks] Background tasks disabled by environment variable');
    return null;
  }

  const taskId = uuidv4();
  const outputFile = getTaskOutputPath(taskId);
  const outputStream = fs.createWriteStream(outputFile, { flags: 'w' });

  const task: BackgroundConversationTask = {
    id: taskId,
    type: 'conversation',
    userInput,
    status: 'running',
    startTime: Date.now(),
    textOutput: '',
    toolCalls: [],
    outputFile,
    outputStream,
    cancelled: false,
  };

  backgroundConversationTasks.set(taskId, task);
  ensureConvCleanupTimer();

  // 写入任务开始信息
  outputStream.write(`=== Background Conversation Task Started ===\n`);
  outputStream.write(`Task ID: ${taskId}\n`);
  outputStream.write(`User Input: ${userInput}\n`);
  outputStream.write(`Start Time: ${new Date(task.startTime).toISOString()}\n`);
  outputStream.write(`\n`);

  return task;
}

/**
 * 更新任务文本输出
 */
export function appendTaskText(taskId: string, text: string): void {
  const task = backgroundConversationTasks.get(taskId);
  if (!task) return;

  task.textOutput += text;
  task.outputStream?.write(text);
}

/**
 * 添加工具调用记录
 */
export function addTaskToolCall(
  taskId: string,
  toolName: string,
  input: unknown,
  result?: string,
  error?: string
): void {
  const task = backgroundConversationTasks.get(taskId);
  if (!task) return;

  const toolCall = {
    name: toolName,
    input,
    result,
    error,
    timestamp: Date.now(),
  };

  task.toolCalls.push(toolCall);

  // 写入工具调用信息到文件
  task.outputStream?.write(`\n--- Tool: ${toolName} ---\n`);
  task.outputStream?.write(`Input: ${JSON.stringify(input, null, 2)}\n`);
  if (result) {
    task.outputStream?.write(`Result: ${result.substring(0, 1000)}${result.length > 1000 ? '...' : ''}\n`);
  }
  if (error) {
    task.outputStream?.write(`Error: ${error}\n`);
  }
  task.outputStream?.write(`\n`);
}

/**
 * 标记任务完成
 */
export function completeTask(taskId: string, success: boolean = true, error?: string): void {
  const task = backgroundConversationTasks.get(taskId);
  if (!task) return;

  task.status = success ? 'completed' : 'failed';
  task.endTime = Date.now();
  task.error = error;

  // 写入任务结束信息
  task.outputStream?.write(`\n=== Task ${success ? 'Completed' : 'Failed'} ===\n`);
  task.outputStream?.write(`End Time: ${new Date(task.endTime).toISOString()}\n`);
  task.outputStream?.write(`Duration: ${task.endTime - task.startTime}ms\n`);
  if (error) {
    task.outputStream?.write(`Error: ${error}\n`);
  }

  // 关闭输出流
  task.outputStream?.end();
  task.outputStream = undefined;
}

/**
 * 取消任务
 */
export function cancelTask(taskId: string): boolean {
  const task = backgroundConversationTasks.get(taskId);
  if (!task) return false;

  task.cancelled = true;
  completeTask(taskId, false, 'Task cancelled by user');

  return true;
}

/**
 * 获取任务
 */
export function getTask(taskId: string): BackgroundConversationTask | undefined {
  return backgroundConversationTasks.get(taskId);
}

/**
 * 获取所有任务
 */
export function getAllTasks(): BackgroundConversationTask[] {
  return Array.from(backgroundConversationTasks.values());
}

/**
 * 获取任务摘要列表
 */
export function getTaskSummaries(): TaskSummary[] {
  return Array.from(backgroundConversationTasks.values()).map((task) => ({
    id: task.id,
    type: task.type,
    status: task.status,
    userInput: task.userInput.substring(0, 100) + (task.userInput.length > 100 ? '...' : ''),
    duration: (task.endTime || Date.now()) - task.startTime,
    outputPreview: task.textOutput.substring(0, 200) + (task.textOutput.length > 200 ? '...' : ''),
  }));
}

/**
 * 删除任务
 */
export function deleteTask(taskId: string): boolean {
  const task = backgroundConversationTasks.get(taskId);
  if (!task) return false;

  // 如果任务还在运行，先取消
  if (task.status === 'running') {
    cancelTask(taskId);
  }

  // 删除任务
  backgroundConversationTasks.delete(taskId);

  // 可选：删除输出文件
  try {
    if (fs.existsSync(task.outputFile)) {
      fs.unlinkSync(task.outputFile);
    }
  } catch (err) {
    console.error(`Failed to delete task output file: ${err}`);
  }

  return true;
}

/**
 * 清理已完成的任务
 */
export function cleanupCompletedTasks(): number {
  let cleaned = 0;

  Array.from(backgroundConversationTasks.entries()).forEach(([id, task]) => {
    if (task.status !== 'running') {
      deleteTask(id);
      cleaned++;
    }
  });

  return cleaned;
}

/**
 * 获取任务数量统计
 */
export function getTaskStats(): {
  total: number;
  running: number;
  completed: number;
  failed: number;
} {
  const tasks = Array.from(backgroundConversationTasks.values());

  return {
    total: tasks.length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };
}

/**
 * 检查任务是否被取消
 */
export function isTaskCancelled(taskId: string): boolean {
  const task = backgroundConversationTasks.get(taskId);
  return task?.cancelled || false;
}
