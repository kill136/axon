/**
 * Agent 笔记本系统
 *
 * 设计哲学：把 agent 当人看，给它一个自管理的笔记本。
 * agent 自己决定记什么、怎么组织、什么时候更新。
 *
 * 两个笔记本，两个生命周期：
 * - experience.md: 跨项目经验（用户信息、工作模式、教训）~4K tokens
 * - project.md:    项目知识（AXON.md 没覆盖的、agent 自己发现的）~8K tokens
 *
 * 当前会话的上下文由对话本身 + TodoWrite + Session Memory 负责，不需要额外笔记本。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { estimateTokens } from '../utils/token-estimate.js';

// ============================================================================
// 常量
// ============================================================================

/** 各笔记本的 token 预算 */
const MAX_TOKENS: Record<NotebookType, number> = {
  experience: 4000,
  project: 8000,
};

// ============================================================================
// 类型
// ============================================================================

export type NotebookType = 'experience' | 'project';

export interface NotebookWriteResult {
  success: boolean;
  error?: string;
  tokens: number;
  path: string;
}

export interface NotebookStats {
  experience: { tokens: number; exists: boolean; path: string };
  project: { tokens: number; exists: boolean; path: string };
  totalTokens: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 获取 ~/.claude 目录 */
function getClaudeDir(): string {
  return process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon');
}

/** 将项目路径转为安全的目录名 */
function sanitizeProjectPath(projectPath: string): string {
  const hash = crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
  const projectName = path.basename(projectPath)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `${projectName}-${hash}`;
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// NotebookManager
// ============================================================================

export class NotebookManager {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  // --------------------------------------------------------------------------
  // 路径管理
  // --------------------------------------------------------------------------

  /** 获取笔记本文件路径 */
  getPath(type: NotebookType): string {
    const claudeDir = getClaudeDir();
    const projectDir = path.join(claudeDir, 'memory', 'projects', sanitizeProjectPath(this.projectPath));

    switch (type) {
      case 'experience':
        return path.join(claudeDir, 'memory', 'experience.md');
      case 'project':
        return path.join(projectDir, 'project.md');
    }
  }

  // --------------------------------------------------------------------------
  // 读写操作
  // --------------------------------------------------------------------------

  /** 读取笔记本内容 */
  read(type: NotebookType): string {
    const filePath = this.getPath(type);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch (error) {
      console.warn(`[Notebook] Failed to read ${type}:`, error);
    }
    return '';
  }

  /** 写入笔记本（带 token 预算检查） */
  write(type: NotebookType, content: string): NotebookWriteResult {
    const filePath = this.getPath(type);
    const maxTokens = MAX_TOKENS[type];
    const tokens = estimateTokens(content);

    if (tokens > maxTokens) {
      return {
        success: false,
        error: `Content exceeds ${type} notebook budget (${tokens}/${maxTokens} tokens). Please condense and retry.`,
        tokens,
        path: filePath,
      };
    }

    try {
      ensureDir(path.dirname(filePath));
      // 原子写入：先写临时文件再 rename，防止进程崩溃导致文件损坏
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      return { success: true, tokens, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Write failed: ${error instanceof Error ? error.message : String(error)}`,
        tokens,
        path: filePath,
      };
    }
  }

  // --------------------------------------------------------------------------
  // System Prompt 集成
  // --------------------------------------------------------------------------

  /** 生成用于注入 system prompt 的笔记本摘要 */
  getNotebookSummaryForPrompt(): string {
    const parts: string[] = [];

    const experience = this.read('experience');
    if (experience.trim()) {
      parts.push(`<notebook type="experience" max-tokens="4000">\n${experience.trim()}\n</notebook>`);
    }

    const project = this.read('project');
    if (project.trim()) {
      parts.push(`<notebook type="project" max-tokens="8000">\n${project.trim()}\n</notebook>`);
    }

    if (parts.length === 0) {
      return '';
    }

    return parts.join('\n\n');
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  /** 获取统计信息 */
  getStats(): NotebookStats {
    const types: NotebookType[] = ['experience', 'project'];
    const stats: any = {};
    let totalTokens = 0;

    for (const type of types) {
      const content = this.read(type);
      const tokens = estimateTokens(content);
      totalTokens += tokens;
      stats[type] = {
        tokens,
        exists: content.trim().length > 0,
        path: this.getPath(type),
      };
    }

    stats.totalTokens = totalTokens;
    return stats as NotebookStats;
  }

  /** 获取项目路径 */
  getProjectPath(): string {
    return this.projectPath;
  }
}

// ============================================================================
// 单例管理（挂到 globalThis 上，避免热重载后模块变量被重置为 null）
// ============================================================================

const GLOBAL_KEY = '__claude_notebook_manager__' as const;

/** 初始化并获取 NotebookManager 实例 */
export function initNotebookManager(projectPath: string): NotebookManager {
  const manager = new NotebookManager(projectPath);
  (globalThis as any)[GLOBAL_KEY] = manager;
  return manager;
}

/** 获取 NotebookManager 实例（必须先调用 initNotebookManager） */
export function getNotebookManager(): NotebookManager | null {
  return (globalThis as any)[GLOBAL_KEY] || null;
}

/** 重置实例 */
export function resetNotebookManager(): void {
  (globalThis as any)[GLOBAL_KEY] = null;
}
