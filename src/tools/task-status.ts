/**
 * TaskStatus 工具 - Worker AI 汇报任务完成状态
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getCurrentCwd } from '../core/cwd-context.js';

export interface UpdateTaskStatusInput {
  taskId: string;
  status: 'completed' | 'failed';
  summary?: string;
  error?: string;
}

export interface TaskProgress {
  taskId: string;
  status: string;
  summary?: string;
  error?: string;
  updatedAt: string;
}

/**
 * 获取状态文件路径
 */
function getStatusFilePath(projectPath: string, taskId: string): string {
  const dir = path.join(projectPath, '.axon', 'progress');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${taskId}.json`);
}

/**
 * 写入任务状态到磁盘
 */
export function writeTaskProgress(projectPath: string, progress: TaskProgress): void {
  const filePath = getStatusFilePath(projectPath, progress.taskId);
  fs.writeFileSync(filePath, JSON.stringify(progress, null, 2), 'utf-8');
}

/**
 * 读取任务状态
 */
export function readTaskProgress(projectPath: string, taskId: string): TaskProgress | null {
  try {
    const filePath = getStatusFilePath(projectPath, taskId);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // 忽略
  }
  return null;
}

export class UpdateTaskStatusTool extends BaseTool<UpdateTaskStatusInput, ToolResult> {
  name = 'UpdateTaskStatus';
  description = '任务完成后汇报状态';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 ID' },
        status: {
          type: 'string',
          enum: ['completed', 'failed'],
          description: '完成状态',
        },
        summary: { type: 'string', description: '完成摘要（完成时必须提供）' },
        error: { type: 'string', description: '失败时的错误信息' },
      },
      required: ['taskId', 'status'],
    };
  }

  async execute(input: UpdateTaskStatusInput): Promise<ToolResult> {
    const { taskId, status, summary, error } = input;

    if (status === 'failed' && !error) {
      return { success: false, error: 'status=failed 时必须提供 error' };
    }

    const progress: TaskProgress = {
      taskId,
      status,
      summary,
      error,
      updatedAt: new Date().toISOString(),
    };

    try {
      // 使用 AsyncLocalStorage 上下文获取正确的项目路径
      const projectPath = getCurrentCwd();
      writeTaskProgress(projectPath, progress);
    } catch (err) {
      return { success: false, error: `写入状态文件失败: ${err}` };
    }

    return {
      success: true,
      output: status === 'completed' ? `任务 ${taskId} 已完成` : `任务 ${taskId} 失败: ${error}`,
      data: progress,
    };
  }
}
