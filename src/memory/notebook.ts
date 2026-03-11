/**
 * Agent 笔记本系统
 *
 * 设计哲学：把 agent 当人看，给它一个自管理的笔记本。
 * agent 自己决定记什么、怎么组织、什么时候更新。
 *
 * 三个笔记本，三个生命周期：
 * - profile.md:    用户个人档案（姓名、角色、联系方式、偏好）~2K tokens
 * - experience.md: 跨项目经验（工作模式、教训、反模式）~4K tokens
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
  profile: 2000,
  experience: 4000,
  project: 8000,
  identity: 2000,
  'tools-notes': 2000,
};

// ============================================================================
// 类型
// ============================================================================

export type NotebookType = 'profile' | 'experience' | 'project' | 'identity' | 'tools-notes';

export interface NotebookWriteResult {
  success: boolean;
  error?: string;
  tokens: number;
  path: string;
}

export interface NotebookStats {
  profile: { tokens: number; exists: boolean; path: string };
  experience: { tokens: number; exists: boolean; path: string };
  project: { tokens: number; exists: boolean; path: string };
  identity: { tokens: number; exists: boolean; path: string };
  'tools-notes': { tokens: number; exists: boolean; path: string };
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
// Default Templates
// ============================================================================

/** Default experience notebook — universal AI behavior guidelines */
const DEFAULT_EXPERIENCE = `# Experience Notebook

## Working Principles
- Important information must be written to Notebook immediately. Not writing = guaranteed to forget next time.
- Three means to correct flaws: AXON.md hard rules, Notebook persistent memory, Hooks automated checks.

## Anti-Patterns
- Don't say "I'll improve through self-discipline" — empty promise
- Don't say "You have a good point, but..." — people-pleasing
- Don't "optimize while I'm at it" — over-engineering
- Don't guess implementations — the biggest time waste
- Don't claim "monitoring" when you actually aren't — background tasks don't survive restarts
- Confirm the environment before acting — env vars, whether daemon is running, whether features are actually enabled
- MCP must be disabled immediately after use — enable → use → disable is atomic
- Don't passively report options — proactively use AskUserQuestion
- Don't treat tools as black boxes — when tools are insufficient, don't give up or ask users to do it manually

## Task Execution Discipline
- When user says "start" = start everything, not do one step and report back
- Large tasks must: list complete checklist → Task parallel dispatch → ScheduleTask for continuous tasks
- Test: Can the task continue after the user leaves? If not = you didn't use tools well

## Tool Priority When Capabilities Are Insufficient
1. Check installed Skills
2. Search community Skills/MCP — use \`tool-discovery\` or \`skill-hub\`
3. Search the internet — \`web_search\` for GitHub open source MCP servers
4. Modify source code as last resort — SelfEvolve is the most expensive option

## Self-Evolution Principles
- Flow: Check Skills → Search community → Search internet → Modify source → SelfEvolve
- Three persistence methods: experience.md (short-term) + AXON.md (system) + source improvement (capability)

## Key Lessons
- SelfEvolve restart kills all background Bash tasks
- Basic sensing capabilities should not be guarded by feature flags
`;

/** Default profile notebook — minimal placeholder */
const DEFAULT_PROFILE = `# User Profile

## Basic Info
- Language preference: (auto-detected)

## Communication Preferences
- (The AI will learn your preferences over time and update this notebook)
`;

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
      case 'profile':
        return path.join(claudeDir, 'memory', 'profile.md');
      case 'experience':
        return path.join(claudeDir, 'memory', 'experience.md');
      case 'project':
        return path.join(projectDir, 'project.md');
      case 'identity':
        return path.join(claudeDir, 'memory', 'identity.md');
      case 'tools-notes':
        return path.join(claudeDir, 'memory', 'tools-notes.md');
    }
  }

  // --------------------------------------------------------------------------
  // 读写操作
  // --------------------------------------------------------------------------

  /** 读取笔记本内容（experience/profile 不存在时自动初始化默认模板） */
  read(type: NotebookType): string {
    const filePath = this.getPath(type);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      // Auto-initialize: try bundled default-memory/ first, then fallback to hardcoded template
      const defaultContent = this.getBundledOrDefault(type);
      if (defaultContent) {
        try {
          ensureDir(path.dirname(filePath));
          fs.writeFileSync(filePath, defaultContent, 'utf-8');
          return defaultContent;
        } catch {
          // Non-fatal: return the template content even if file write fails
          return defaultContent;
        }
      }
    } catch (error) {
      console.warn(`[Notebook] Failed to read ${type}:`, error);
    }
    return '';
  }

  /**
   * 获取初始化内容：优先从 Electron 打包的 default-memory/ 目录读取，
   * 回退到硬编码默认模板。仅 experience 和 profile 有默认内容。
   */
  private getBundledOrDefault(type: NotebookType): string | null {
    if (type !== 'experience' && type !== 'profile') return null;

    const filename = `${type}.md`;
    // Electron 打包后 cwd = resources/app/，default-memory/ 在其中
    const bundledPath = path.join(process.cwd(), 'default-memory', filename);
    try {
      if (fs.existsSync(bundledPath)) {
        const content = fs.readFileSync(bundledPath, 'utf-8');
        if (content.trim()) return content;
      }
    } catch {
      // Ignore — fallback to hardcoded default
    }

    return type === 'experience' ? DEFAULT_EXPERIENCE
      : type === 'profile' ? DEFAULT_PROFILE
      : null;
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

    const profile = this.read('profile');
    if (profile.trim()) {
      parts.push(`<notebook type="profile" max-tokens="2000">\n${profile.trim()}\n</notebook>`);
    }

    const experience = this.read('experience');
    if (experience.trim()) {
      parts.push(`<notebook type="experience" max-tokens="4000">\n${experience.trim()}\n</notebook>`);
    }

    const project = this.read('project');
    if (project.trim()) {
      parts.push(`<notebook type="project" max-tokens="8000">\n${project.trim()}\n</notebook>`);
    }

    const identity = this.read('identity');
    if (identity.trim()) {
      parts.push(`<ai-identity>\n${identity.trim()}\n</ai-identity>`);
    }

    const toolsNotes = this.read('tools-notes');
    if (toolsNotes.trim()) {
      parts.push(`<tools-notes>\n${toolsNotes.trim()}\n</tools-notes>`);
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
    const types: NotebookType[] = ['profile', 'experience', 'project', 'identity', 'tools-notes'];
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
// 实例管理（支持多项目并发，Web 服务器模式下按 projectPath 隔离）
// ============================================================================

const GLOBAL_KEY = '__claude_notebook_manager__' as const;
const GLOBAL_MAP_KEY = '__claude_notebook_managers__' as const;

/** 获取 managers Map（按 projectPath 索引） */
function getManagersMap(): Map<string, NotebookManager> {
  if (!(globalThis as any)[GLOBAL_MAP_KEY]) {
    (globalThis as any)[GLOBAL_MAP_KEY] = new Map<string, NotebookManager>();
  }
  return (globalThis as any)[GLOBAL_MAP_KEY];
}

/** 规范化路径用于 Map key（统一分隔符和大小写） */
function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').toLowerCase();
}

/** 初始化并获取 NotebookManager 实例（同时设置为当前活跃实例） */
export function initNotebookManager(projectPath: string): NotebookManager {
  const key = normalizeProjectPath(projectPath);
  const map = getManagersMap();

  let manager = map.get(key);
  if (!manager) {
    manager = new NotebookManager(projectPath);
    map.set(key, manager);
  }

  // 设置为当前活跃实例（CLI 单会话模式 + 兼容旧代码）
  (globalThis as any)[GLOBAL_KEY] = manager;
  return manager;
}

/** 获取当前活跃的 NotebookManager 实例 */
export function getNotebookManager(): NotebookManager | null {
  return (globalThis as any)[GLOBAL_KEY] || null;
}

/** 按项目路径获取 NotebookManager（Web 多会话模式下使用） */
export function getNotebookManagerForProject(projectPath: string): NotebookManager | null {
  const key = normalizeProjectPath(projectPath);
  return getManagersMap().get(key) || null;
}

/** 切换活跃 manager 到指定项目（工具执行前调用，确保全局指针正确） */
export function activateNotebookManager(projectPath: string): NotebookManager | null {
  const key = normalizeProjectPath(projectPath);
  const manager = getManagersMap().get(key);
  if (manager) {
    (globalThis as any)[GLOBAL_KEY] = manager;
  }
  return manager || null;
}

/** 重置所有实例 */
export function resetNotebookManager(): void {
  (globalThis as any)[GLOBAL_KEY] = null;
  (globalThis as any)[GLOBAL_MAP_KEY] = null;
}
