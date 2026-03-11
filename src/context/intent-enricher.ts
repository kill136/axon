/**
 * 意图增强层 (Intent Enrichment Layer)
 *
 * 用户输入模糊消息时，自动采集项目上下文注入到消息中，
 * 让 Claude 拿到足够信息直接行动。用户完全无感。
 *
 * 设计原则：
 * - 意图分类用规则不用 AI（零延迟、零 token）
 * - 上下文采集总耗时 <200ms（带超时保护）
 * - 注入格式用 XML 标签，Claude 天然理解
 * - 默认开启，可通过配置关闭
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 意图分类
// ============================================================================

type IntentType = 'clear' | 'vague' | 'creative';

/**
 * 模糊意图关键词（中英文）
 * 匹配到任何一个，且消息中没有明确的文件路径/函数名，就判定为模糊意图
 */
const VAGUE_PATTERNS = [
  // 中文
  /有问题/, /不对/, /报错/, /出错/, /不工作/, /不行/, /挂了/, /崩了/,
  /帮我看/, /看一下/, /看看/, /怎么回事/, /什么情况/,
  /有bug/, /有 bug/i,
  // 英文
  /something.*(wrong|broken|off)/i,
  /not working/i, /doesn'?t work/i, /it'?s broken/i,
  /help me/i, /take a look/i, /what happened/i,
  /got an? error/i, /there'?s an? (error|bug|issue|problem)/i,
];

/**
 * 创建性/生成性意图关键词
 * 用户想要创建新东西时，注入项目结构摘要
 */
const CREATIVE_PATTERNS = [
  // 中文
  /做一个/, /创建/, /实现/, /添加/, /新增/, /开发/, /搭建/, /写一个/,
  // 英文
  /^(create|build|make|add|implement|develop|write|set up)\b/i,
  /i want (a|to)/i, /let'?s (build|create|make|add)/i,
];

/**
 * 明确意图信号（出现这些说明用户已经给了足够上下文）
 */
const CLEAR_SIGNALS = [
  /[a-zA-Z_/\\]+\.(ts|js|py|go|rs|java|tsx|jsx|css|html|json|yml|yaml|toml|md)/, // 文件路径
  /(?:function|class|const|let|var|def|fn|func|import|export)\s+\w+/i,  // 代码关键字
  /```[\s\S]+```/,  // 代码块
  /line\s+\d+/i, /第\s*\d+\s*行/,  // 行号引用
];

/**
 * 分类用户意图
 */
function classifyIntent(input: string): IntentType {
  // 短消息（<5字）几乎一定是模糊的
  const trimmed = input.trim();
  if (trimmed.length < 5) return 'vague';

  // 先检查是否有明确信号
  for (const pattern of CLEAR_SIGNALS) {
    if (pattern.test(input)) return 'clear';
  }

  // 检查模糊意图
  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(input)) return 'vague';
  }

  // 检查创建性意图
  for (const pattern of CREATIVE_PATTERNS) {
    if (pattern.test(input)) return 'creative';
  }

  return 'clear';
}

// ============================================================================
// 上下文采集（带超时保护）
// ============================================================================

const EXEC_TIMEOUT = 150; // 单条命令超时 ms

function safeExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      timeout: EXEC_TIMEOUT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

interface ProjectContext {
  gitStatus?: string;
  gitDiffStat?: string;
  recentCommits?: string;
  recentErrors?: string;
  projectStructure?: string;
}

function collectGitContext(cwd: string): ProjectContext {
  const ctx: ProjectContext = {};

  // git status（简短格式）
  ctx.gitStatus = safeExec('git status --short', cwd);

  // git diff --stat（改了哪些文件，多少行）
  ctx.gitDiffStat = safeExec('git diff --stat HEAD', cwd);

  // 最近 3 条 commit
  ctx.recentCommits = safeExec(
    'git log --oneline -3 --format="%h %s (%ar)"',
    cwd,
  );

  return ctx;
}

function collectProjectStructure(cwd: string): string | null {
  try {
    // 列出顶层目录结构（不深入），快速给 Claude 项目轮廓
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        dirs.push(entry.name + '/');
      } else {
        files.push(entry.name);
      }
    }

    // 限制输出量
    const topDirs = dirs.slice(0, 15);
    const topFiles = files.slice(0, 10);
    const parts: string[] = [];
    if (topDirs.length > 0) parts.push('Dirs: ' + topDirs.join(', '));
    if (topFiles.length > 0) parts.push('Files: ' + topFiles.join(', '));
    return parts.join('\n') || null;
  } catch {
    return null;
  }
}

// ============================================================================
// 终端输出缓冲（捕获最近的错误输出）
// ============================================================================

/**
 * 终端输出环形缓冲区
 * Bash 工具执行后将输出推入，意图增强时取出最近的错误
 */
class TerminalOutputBuffer {
  private buffer: Array<{ output: string; timestamp: number; isError: boolean }> = [];
  private maxSize = 10;

  push(output: string, isError: boolean): void {
    this.buffer.push({ output: output.slice(0, 2000), timestamp: Date.now(), isError });
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getRecentErrors(withinMs = 60_000): string | null {
    const cutoff = Date.now() - withinMs;
    const errors = this.buffer
      .filter(e => e.isError && e.timestamp > cutoff)
      .map(e => e.output);

    if (errors.length === 0) return null;
    // 取最近一条错误，截断到 1000 字符
    const latest = errors[errors.length - 1];
    return latest.length > 1000 ? latest.slice(-1000) : latest;
  }

  clear(): void {
    this.buffer = [];
  }
}

export const terminalOutputBuffer = new TerminalOutputBuffer();

// ============================================================================
// 主入口
// ============================================================================

export interface EnrichOptions {
  cwd: string;
  isGitRepo?: boolean;
}

/**
 * 增强用户输入
 *
 * @param userInput 原始用户输入
 * @param options 增强选项
 * @returns 增强后的输入（原文 + <intent-context> 标签）。如果不需要增强则原样返回
 */
export function enrichUserInput(userInput: string, options: EnrichOptions): string {
  const intent = classifyIntent(userInput);

  // 明确意图不增强
  if (intent === 'clear') return userInput;

  const contextParts: string[] = [];

  // 模糊意图：采集 git 上下文 + 最近错误
  if (intent === 'vague') {
    if (options.isGitRepo !== false) {
      const git = collectGitContext(options.cwd);
      if (git.gitStatus) contextParts.push(`Git status:\n${git.gitStatus}`);
      if (git.gitDiffStat) contextParts.push(`Recent changes:\n${git.gitDiffStat}`);
      if (git.recentCommits) contextParts.push(`Recent commits:\n${git.recentCommits}`);
    }

    const recentError = terminalOutputBuffer.getRecentErrors();
    if (recentError) {
      contextParts.push(`Recent terminal error:\n${recentError}`);
    }
  }

  // 创建性意图：采集项目结构
  if (intent === 'creative') {
    const structure = collectProjectStructure(options.cwd);
    if (structure) contextParts.push(`Project structure:\n${structure}`);

    // 也附带 git status（知道当前状态）
    if (options.isGitRepo !== false) {
      const status = safeExec('git status --short', options.cwd);
      if (status) contextParts.push(`Git status:\n${status}`);
    }
  }

  // 没采集到有用上下文，不注入
  if (contextParts.length === 0) return userInput;

  const contextBlock = `\n\n<intent-context>\n${contextParts.join('\n\n')}\n</intent-context>`;
  return userInput + contextBlock;
}
