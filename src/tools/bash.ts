/**
 * Bash 工具
 * 执行 shell 命令，支持沙箱隔离
 * 跨平台支持: Windows (git-bash), macOS, Linux
 * 注意: Windows 上需要安装 Git for Windows，使用 git-bash 执行命令
 */

import { spawn, exec, ChildProcess, spawnSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { BaseTool } from './base.js';
import {
  executeInSandbox,
  isBubblewrapAvailable,
  isSandboxingEnabled,
  isAutoAllowBashIfSandboxedEnabled,
  willCommandRunInSandbox,
} from './sandbox.js';
import { runPreToolUseHooks, runPostToolUseHooks } from '../hooks/index.js';
import { processGitCommitCommand } from '../utils/git-helper.js';
import { configManager } from '../config/index.js';
import { isBackgroundTasksDisabled } from '../utils/env-check.js';
import { escapePathForShell } from '../utils/platform.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { parsePrCreateOutput, linkSessionToPr } from '../session/index.js';
import { getCurrentSessionId } from '../core/session.js';
import type { BashInput, BashResult, ToolDefinition } from '../types/index.js';
import { needsElevation, getElevationReason, executeElevated } from '../permissions/elevated-commands.js';
import { truncateString } from '../utils/truncated-buffer.js';
import { t } from '../i18n/index.js';


// WebUI 模式下的 WebSocket 广播（可选依赖）
// 仅在 WebUI 服务器模式下加载，通过 setBroadcastMessage() 注入
let broadcastMessage: ((message: any) => void) | null = null;

/**
 * 设置 WebSocket 广播函数（由 WebUI 服务器启动时调用）
 */
export function setBroadcastMessage(fn: (message: any) => void): void {
  broadcastMessage = fn;
}

const execAsync = promisify(exec);

// ============================================================================
// 跨平台支持
// ============================================================================

/** 平台检测 */
const IS_WINDOWS = os.platform() === 'win32';
const IS_WSL = os.platform() === 'linux' &&
  fs.existsSync('/proc/version') &&
  fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');

/** Shell 配置接口 */
interface ShellConfig {
  shell: string;
  args: string[];
  isCmd: boolean;
  isPowerShell: boolean;
  isGitBash: boolean;
}

/**
 * 查找命令的路径 (类似 which/where)
 * 官方实现: g1K 函数
 */
function which(command: string): string | null {
  try {
    const result = spawnSync(IS_WINDOWS ? 'where' : 'which', [command], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      // where 在 Windows 上可能返回多行，取第一行
      const firstLine = result.stdout.trim().split(/\r?\n/)[0];
      return firstLine || null;
    }
  } catch {
    // 命令不可用
  }
  return null;
}

/**
 * 从 git.exe 路径中找到 Git 安装根目录
 * Git 安装结构可能是:
 * - Git/cmd/git.exe -> 根目录是往上两级
 * - Git/bin/git.exe -> 根目录是往上一级
 * - Git/mingw64/bin/git.exe -> 根目录是往上三级
 */
function findGitRoot(gitExePath: string): string | null {
  // 标准化路径
  const normalized = path.normalize(gitExePath);
  const parts = normalized.split(path.sep);

  // 查找包含 'Git' 的目录部分
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase() === 'git') {
      return parts.slice(0, i + 1).join(path.sep);
    }
  }

  // 回退: 尝试往上几级查找 bin/bash.exe
  let dir = path.dirname(gitExePath);
  for (let i = 0; i < 4; i++) {
    const bashPath = path.join(dir, 'bin', 'bash.exe');
    if (fs.existsSync(bashPath)) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * 查找 Windows 上的 git-bash 路径
 * 官方逻辑：
 * 1. 检查 CLAUDE_CODE_GIT_BASH_PATH 环境变量
 * 2. 通过 git 命令路径推断 bash.exe 位置
 */
function findGitBash(): string | null {
  // 1. 检查环境变量
  const envPath = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    console.error(t('bash.gitBashNotFound', { path: envPath }));
    return null;
  }

  // 2. 通过 git 命令查找
  const gitPath = which('git');
  if (gitPath) {
    const gitRoot = findGitRoot(gitPath);
    if (gitRoot) {
      // bash.exe 通常在 Git/bin/bash.exe 或 Git/usr/bin/bash.exe
      const bashPath = path.join(gitRoot, 'bin', 'bash.exe');
      if (fs.existsSync(bashPath)) {
        return bashPath;
      }
      const bashPath2 = path.join(gitRoot, 'usr', 'bin', 'bash.exe');
      if (fs.existsSync(bashPath2)) {
        return bashPath2;
      }
    }
  }

  // 3. 常见安装路径
  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'D:\\Program Files\\Git\\bin\\bash.exe',
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/** 缓存的 git-bash 路径 */
let cachedGitBashPath: string | null | undefined = undefined;

function getGitBashPath(): string | null {
  if (cachedGitBashPath === undefined) {
    cachedGitBashPath = findGitBash();
  }
  return cachedGitBashPath;
}

/** 获取平台适配的 Shell 配置 */
function getPlatformShell(): ShellConfig {
  if (IS_WINDOWS) {
    // Windows: 必须使用 git-bash (官方要求，无降级方案)
    const gitBashPath = getGitBashPath();
    if (gitBashPath) {
      return {
        shell: gitBashPath,
        args: ['-c'],
        isCmd: false,
        isPowerShell: false,
        isGitBash: true,
      };
    }

    // git-bash 未找到，按官方行为直接退出
    console.error(
      'Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win). ' +
      'If installed but not in PATH, set environment variable pointing to your bash.exe, similar to: ' +
      'CLAUDE_CODE_GIT_BASH_PATH=C:\\Program Files\\Git\\bin\\bash.exe'
    );
    process.exit(1);
  }

  // Unix 系统: 使用 bash 或 sh
  const shell = process.env.SHELL || '/bin/bash';
  return {
    shell,
    args: ['-c'],
    isCmd: false,
    isPowerShell: false,
    isGitBash: false,
  };
}

/** 缓存的 Shell 配置 */
let cachedShellConfig: ShellConfig | null = null;

function getShellConfig(): ShellConfig {
  if (!cachedShellConfig) {
    cachedShellConfig = getPlatformShell();
  }
  return cachedShellConfig;
}

/**
 * v2.1.32: 修复 heredoc 中 JavaScript 模板字面量导致 "Bad substitution" 错误
 * 对齐官方 mV6() 函数
 *
 * 问题：当 heredoc 使用未引用定界符 (<<EOF) 且内容包含 ${index + 1} 等
 * JS 模板字面量时，bash 会尝试变量展开，导致 "Bad substitution" 错误。
 *
 * 修复：检测未引用定界符的 heredoc，如果其内容包含 ${...} 模式，
 * 自动将定界符改为引用形式 (<<'EOF')，阻止 bash 变量展开。
 *
 * 官方正则: /(?<!<)<<(?!<)(-)?[ \t]*(['"])?\\?(\w+)\2?/
 */
function fixHeredocTemplateLiterals(command: string): string {
  if (!command.includes('<<')) return command;

  // 匹配 heredoc 操作符: <<[-]?[QUOTE]?DELIMITER[QUOTE]?
  const heredocRegex = /(?<!<)<<(-?)[ \t]*(['"])?\\?(\w+)\2?/g;
  let result = command;
  let match;
  const replacements: Array<{ from: string; to: string; index: number }> = [];

  while ((match = heredocRegex.exec(command)) !== null) {
    const fullMatch = match[0];
    const dash = match[1] || '';
    const quote = match[2]; // 引号类型 (' 或 ")
    const delimiter = match[3]; // 定界符名称

    // 如果已经有引号，跳过（已经是安全的）
    if (quote) continue;

    // 查找 heredoc 内容（从定界符后到匹配的结束定界符）
    const afterMatch = command.slice(match.index + fullMatch.length);
    const contentStart = afterMatch.indexOf('\n');
    if (contentStart === -1) continue;

    const contentAfterNewline = afterMatch.slice(contentStart + 1);
    const lines = contentAfterNewline.split('\n');

    // 查找结束定界符
    let endIndex = -1;
    let heredocContent = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === delimiter) {
        endIndex = i;
        break;
      }
      heredocContent += lines[i] + '\n';
    }

    if (endIndex === -1) continue;

    // 检查 heredoc 内容是否包含 ${...} 模式（JS 模板字面量）
    // 排除纯 shell 变量引用如 ${HOME}, ${PATH} 等
    const templateLiteralPattern = /\$\{[^}]*[+\-*/% ][^}]*\}/;
    if (templateLiteralPattern.test(heredocContent)) {
      // 将 <<DELIMITER 改为 <<'DELIMITER'
      replacements.push({
        from: fullMatch,
        to: `<<${dash}'${delimiter}'`,
        index: match.index,
      });
    }
  }

  // 从后往前替换，避免索引偏移
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.index) + r.to + result.slice(r.index + r.from.length);
  }

  return result;
}

/**
 * Windows 路径反斜杠修复
 *
 * 问题：AI 模型有时会在 bash 命令中使用 Windows 反斜杠路径（如 F:\dir\file），
 * 但命令是通过 Git Bash 执行的。bash 会将 \d、\f、\t 等视为转义序列，
 * 导致路径被损坏（反斜杠被吞掉），文件创建在错误位置。
 *
 * 修复：在 Windows + Git Bash 环境下，将命令中 Windows 风格的路径
 * （驱动器号 + 反斜杠）转换为正斜杠。
 *
 * 匹配模式：[A-Z]:\ 开头的路径片段，将后续连续的 \ 都替换为 /
 * 不处理引号内的 \n \t 等显式转义（这些是用户有意的）
 */
function fixWindowsPathsForBash(command: string): string {
  if (!IS_WINDOWS) return command;

  // 匹配 Windows 驱动器路径：X:\ 后面跟着路径字符（字母、数字、下划线、点、横杠和反斜杠）
  // 例如：F:\claude-code-open\tests\file.ts → F:/claude-code-open/tests/file.ts
  // 注意：不匹配空格，因为空格在 bash 中是分词符。
  // 带空格的路径应该用引号括起来，引号内的反斜杠由 bash 自己处理。
  return command.replace(
    /([A-Za-z]):\\([\w.\-\\]+)/g,
    (_match, drive: string, rest: string) => {
      return drive + ':/' + rest.replace(/\\/g, '/');
    }
  );
}

/** 获取平台适配的终止信号类型 */
type TermSignal = 'SIGTERM' | 'SIGKILL' | 'SIGINT';

/**
 * 安全地终止进程（跨平台）
 */
function killProcessSafely(proc: ChildProcess, signal: TermSignal = 'SIGTERM'): boolean {
  try {
    if (IS_WINDOWS && proc.pid) {
      // Windows: 使用 taskkill 终止进程树
      try {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        return true;
      } catch {
        // 回退到标准方法
      }
    }
    proc.kill(signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取平台适配的 spawn 选项
 */
function getPlatformSpawnOptions(cwd: string): {
  shell: string | boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  stdio: ['ignore', 'pipe', 'pipe'];
} {
  const options: {
    shell: string | boolean;
    cwd: string;
    env: NodeJS.ProcessEnv;
    windowsHide?: boolean;
    stdio: ['ignore', 'pipe', 'pipe'];
  } = {
    shell: false,
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  if (IS_WINDOWS) {
    options.windowsHide = true;
  }

  return options;
}

// 后台任务管理（统一使用 task_id）
interface TaskState {
  taskId: string; // 使用 UUID 格式的 task_id
  process: ReturnType<typeof spawn>;
  output: string[];
  outputFile: string;
  outputStream?: fs.WriteStream;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  timeout?: NodeJS.Timeout;
  maxRuntime?: number;
  outputSize: number;
  command: string;
  exitCode?: number;
  description?: string;
  // 用于增量读取输出
  lastReadPosition: number;
}

// 使用 task_id 作为键，兼容官方格式
const backgroundTasks: Map<string, TaskState> = new Map();

// 向后兼容：保留旧的变量名作为别名
const backgroundShells = backgroundTasks;

// 定时清理已完成的后台任务，防止 Map 无限增长
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    cleanupCompletedTasks();
    cleanupTimedOutTasks();
    // 如果 Map 空了，停止定时器
    if (backgroundTasks.size === 0 && _cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  // 不阻止进程退出
  if (_cleanupTimer && typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    _cleanupTimer.unref();
  }
}

/**
 * 获取后台任务信息（供 TaskOutput 工具使用）
 */
export function getBackgroundTask(taskId: string): TaskState | undefined {
  return backgroundTasks.get(taskId);
}

/**
 * 向后兼容：获取后台 shell 信息
 */
export function getBackgroundShell(taskId: string): TaskState | undefined {
  return getBackgroundTask(taskId);
}

/**
 * 检查 ID 是否是任务 ID（支持 UUID 和旧格式）
 */
export function isTaskId(id: string): boolean {
  // 支持 UUID 格式和旧的 bash_ 格式
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id.startsWith('bash_');
}

/**
 * 向后兼容：检查 ID 是否是 shell ID
 */
export function isShellId(id: string): boolean {
  return isTaskId(id);
}

// 获取任务输出文件路径（使用官方的 tasks 目录）
export function getTaskOutputPath(taskId: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const tasksDir = path.join(homeDir, '.claude', 'tasks');

  // 确保目录存在
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  return path.join(tasksDir, `${taskId}.log`);
}

// 获取任务元数据文件路径
export function getTaskMetaPath(taskId: string): string {
  const logPath = getTaskOutputPath(taskId);
  return logPath.replace(/\.log$/, '.meta.json');
}

// 保存后台任务元数据到磁盘（进程重启后可恢复）
function saveTaskMeta(taskId: string, meta: {
  command: string;
  startTime: number;
  outputFile: string;
  status: string;
  endTime?: number;
  exitCode?: number;
}): void {
  try {
    const metaPath = getTaskMetaPath(taskId);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // 写入失败不影响主流程
  }
}

// 更新磁盘上的任务元数据状态
function updateTaskMeta(taskId: string, updates: Record<string, unknown>): void {
  try {
    const metaPath = getTaskMetaPath(taskId);
    if (!fs.existsSync(metaPath)) return;
    const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    fs.writeFileSync(metaPath, JSON.stringify({ ...existing, ...updates }, null, 2));
  } catch {
    // 更新失败不影响主流程
  }
}

// 从磁盘加载后台任务元数据（进程重启后的 fallback）
export function loadTaskMeta(taskId: string): {
  command: string;
  startTime: number;
  outputFile: string;
  status: string;
  endTime?: number;
  exitCode?: number;
} | null {
  try {
    const metaPath = getTaskMetaPath(taskId);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

// 向后兼容：保留旧的函数名
function getBackgroundOutputPath(taskId: string): string {
  return getTaskOutputPath(taskId);
}

// 配置
const MAX_OUTPUT_LENGTH = parseInt(process.env.BASH_MAX_OUTPUT_LENGTH || '30000', 10);
const DEFAULT_TIMEOUT = parseInt(process.env.BASH_DEFAULT_TIMEOUT_MS || '120000', 10); // 默认 2 分钟
const MAX_TIMEOUT = 600000;
const MAX_BACKGROUND_OUTPUT = 10 * 1024 * 1024; // 10MB per background shell
const MAX_BACKGROUND_SHELLS = parseInt(process.env.BASH_MAX_BACKGROUND_SHELLS || '10', 10);
const BACKGROUND_SHELL_MAX_RUNTIME = parseInt(process.env.BASH_BACKGROUND_MAX_RUNTIME || '3600000', 10); // 1 hour

// 危险命令黑名单
const DANGEROUS_COMMANDS = [
  'rm -rf /',
  'mkfs',
  'dd if=/dev/zero',
  'fork bomb',
  ':(){ :|:& };:',
  'chmod -R 777 /',
  'chown -R',
];

// 需要警告的命令模式
const WARNING_PATTERNS = [
  /rm\s+-rf/,
  /sudo\s+rm/,
  /chmod\s+777/,
  /eval\s+/,
  /exec\s+/,
  /\|\s*sh/,
  /curl.*\|\s*bash/,
  /wget.*\|\s*sh/,
];

// 命令审计日志
interface AuditLog {
  timestamp: number;
  command: string;
  cwd: string;
  sandboxed: boolean;
  success: boolean;
  exitCode?: number;
  duration: number;
  outputSize: number;
  background: boolean;
  elevated?: boolean;  // v2.1.28: 是否以管理员权限执行
}

const auditLogs: AuditLog[] = [];
const MAX_AUDIT_LOGS = 1000;

/**
 * 检查命令是否安全
 */
function checkCommandSafety(command: string): { safe: boolean; reason?: string; warning?: string } {
  // 检查危险命令
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (command.includes(dangerous)) {
      return { safe: false, reason: `Dangerous command detected: ${dangerous}` };
    }
  }

  // 检查警告模式
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: true,
        warning: `Potentially dangerous command pattern detected: ${pattern}. Use with caution.`,
      };
    }
  }

  return { safe: true };
}

/**
 * 记录审计日志
 */
function recordAudit(log: AuditLog): void {
  auditLogs.push(log);

  // 限制日志大小
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs.splice(0, auditLogs.length - MAX_AUDIT_LOGS);
  }

  // 可选：写入文件
  if (process.env.BASH_AUDIT_LOG_FILE) {
    try {
      const logLine = JSON.stringify(log) + '\n';
      fs.appendFileSync(process.env.BASH_AUDIT_LOG_FILE, logLine);
    } catch (err) {
      // 忽略日志写入错误
      console.error('Failed to write audit log:', err);
    }
  }
}

/**
 * 清理超时的后台任务
 */
function cleanupTimedOutTasks(): number {
  let cleaned = 0;
  const now = Date.now();

  Array.from(backgroundTasks.entries()).forEach(([id, task]) => {
    if (task.maxRuntime && now - task.startTime > task.maxRuntime) {
      try {
        task.process.kill('SIGTERM');
        // 关闭输出流
        task.outputStream?.end();
        setTimeout(() => {
          if (task.status === 'running') {
            task.process.kill('SIGKILL');
          }
        }, 1000);
        backgroundTasks.delete(id);
        cleaned++;
      } catch (err) {
        console.error(`Failed to cleanup task ${id}:`, err);
      }
    }
  });

  return cleaned;
}

// 向后兼容
const cleanupTimedOutShells = cleanupTimedOutTasks;

// 不支持自动超时转后台的命令列表（与官方对齐：IgY=["sleep"]）
const NON_BACKGROUNDABLE_COMMANDS = ['sleep'];

/**
 * 判断命令是否支持自动超时转后台执行
 * 与官方 mgY() 函数对齐：
 *   function mgY(A) { let q=vX(A); if(q.length===0) return true;
 *     let K=q[0]?.trim(); if(!K) return true; return !IgY.includes(K); }
 *   IgY=["sleep"]
 */
function isBackgroundable(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  // 提取第一个命令词（处理路径前缀如 /usr/bin/sleep）
  const firstWord = trimmed.split(/\s+/)[0];
  if (!firstWord) return true;
  const baseName = firstWord.split('/').pop() || firstWord;
  return !NON_BACKGROUNDABLE_COMMANDS.includes(baseName);
}

/**
 * 生成后台任务相关提示文本（条件性）
 * 根据 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS 环境变量决定是否显示
 */
function getBackgroundTasksPrompt(): string {
  if (isBackgroundTasksDisabled()) {
    return '';
  }
  return `
  - You can use the \`run_in_background\` parameter to run the command in the background, which allows you to continue working while the command runs. You can monitor the output using the BashOutput tool as it becomes available. You do not need to use '&' at the end of the command when using this parameter.`;
}

export class BashTool extends BaseTool<BashInput, BashResult> {
  name = 'Bash';
  description = `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to ${MAX_TIMEOUT}ms / ${MAX_TIMEOUT / 60000} minutes). If not specified, commands will timeout after ${DEFAULT_TIMEOUT}ms (${DEFAULT_TIMEOUT / 60000} minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${MAX_OUTPUT_LENGTH} characters, output will be truncated before being returned to you.${getBackgroundTasksPrompt()}
  - Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>

# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
  (1) User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
  (2) HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
  (3) Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless user explicitly requests it (requires force push)
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
  - IMPORTANT: Automatically append attribution to the commit message using the format specified in the configuration (defaults to including Co-Authored-By trailer)
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message that includes the attribution trailer.
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite or Task tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "$(cat <<'EOF'
   Commit message here.

   🤖 Generated with Claude Code (https://claude.com/claude-code)
   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   EOF
   )"
</example>
- The attribution (Co-Authored-By trailer) is configurable via the "attribution.commit" setting in ~/.claude/settings.json
- Users can disable attribution by setting "attribution.commit" to an empty string or "includeCoAuthoredBy" to false

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
EOF
)"
</example>

Important:
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000)',
        },
        description: {
          type: 'string',
          description: 'Clear, concise description of what this command does in 5-10 words',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Run command in the background',
        },
        dangerouslyDisableSandbox: {
          type: 'boolean',
          description: 'Disable sandbox mode (dangerous)',
        },
        echoOutput: {
          type: 'boolean',
          description: 'Echo output to terminal in real-time (only with run_in_background)',
        },
      },
      required: ['command'],
    };
  }

  /**
   * v2.1.34: Bash 工具权限检查 - 实现 autoAllowBashIfSandboxed 逻辑
   *
   * 对齐官方 EuA / E5z 函数：
   * - 当沙箱启用 + autoAllowBashIfSandboxed=true + 命令确实在沙箱中运行时 → 自动允许
   * - 当命令被 excludedCommands 排除或使用 dangerouslyDisableSandbox 时 → 需要正常权限检查（ask）
   *
   * 关键修复: 之前 excludedCommands 和 dangerouslyDisableSandbox 的命令
   * 在 autoAllowBashIfSandboxed 启用时也被自动允许了（绕过了 ask 权限），这是安全漏洞
   */
  async checkPermissions(input: BashInput): Promise<import('./base.js').PermissionCheckResult<BashInput>> {
    const command = input.command;
    const disableSandbox = input.dangerouslyDisableSandbox ?? false;

    // 检查是否满足 autoAllowBashIfSandboxed 条件
    if (isSandboxingEnabled() && isAutoAllowBashIfSandboxedEnabled()) {
      // 关键: 只有命令确实会在沙箱中运行时，才自动允许
      if (willCommandRunInSandbox(command, disableSandbox)) {
        // 命令会在沙箱中运行 → 自动允许（默认安全）
        return {
          behavior: 'allow',
          updatedInput: input,
        };
      } else {
        // v2.1.34 修复: 命令不会在沙箱中运行（被 excludedCommands 排除或 dangerouslyDisableSandbox）
        // 此时不能享受 autoAllow，必须走正常的 ask 流程
        return {
          behavior: 'ask',
          message: `Command "${command.substring(0, 80)}${command.length > 80 ? '...' : ''}" will run outside the sandbox. Allow?`,
          updatedInput: input,
        };
      }
    }

    // 未启用 autoAllowBashIfSandboxed 或沙箱未启用 → 默认行为（allow，由 loop 层决定是否 ask）
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  }

  async execute(input: BashInput): Promise<BashResult> {
    let {
      command,
      timeout = DEFAULT_TIMEOUT,
      run_in_background = false,
      dangerouslyDisableSandbox = false,
      echoOutput = false,
    } = input;

    const startTime = Date.now();
    const maxTimeout = Math.min(timeout, MAX_TIMEOUT);

    // Git commit 命令预处理：自动添加署名
    // 获取当前配置的模型ID用于署名
    const config = configManager.getAll();
    const modelId = config.model;

    // Windows 路径修复：将命令中的 Windows 反斜杠路径转为正斜杠
    // 防止 Git Bash 将 \t \n 等视为转义序列导致路径损坏
    command = fixWindowsPathsForBash(command);

    // v2.1.32: 修复 heredoc 中 JavaScript 模板字面量导致的 "Bad substitution" 错误
    // 当 heredoc 使用未引用的定界符且内容包含 ${...} 时，bash 会尝试变量展开
    // 修复方法：自动将未引用的定界符加上引号（如 <<EOF 变为 <<'EOF'）
    command = fixHeredocTemplateLiterals(command);

    // 处理 git commit 命令以添加署名
    // 修复 2.1.3: 添加友好的错误处理，防止命令注入异常导致不友好的错误消息
    try {
      command = processGitCommitCommand(command, modelId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Command injection detected')) {
        // 返回友好的安全错误消息
        const auditLog: AuditLog = {
          timestamp: Date.now(),
          command,
          cwd: getCurrentCwd(),
          sandboxed: false,
          success: false,
          duration: 0,
          outputSize: 0,
          background: run_in_background,
        };
        recordAudit(auditLog);

        return {
          success: false,
          error: t('bash.gitCommitBlocked', { message: error.message }),
          blocked: true,
        };
      }
      // 其他错误向上传播
      throw error;
    }

    // 安全检查
    const safetyCheck = checkCommandSafety(command);
    if (!safetyCheck.safe) {
      const auditLog: AuditLog = {
        timestamp: Date.now(),
        command,
        cwd: getCurrentCwd(),
        sandboxed: false,
        success: false,
        duration: 0,
        outputSize: 0,
        background: run_in_background,
      };
      recordAudit(auditLog);

      return {
        success: false,
        error: t('bash.commandBlocked', { reason: safetyCheck.reason }),
      };
    }

    // 记录警告
    if (safetyCheck.warning) {
      console.warn(`[Bash Security Warning] ${safetyCheck.warning}`);
    }

    // v2.1.28: 检测是否需要管理员权限
    // 如果命令需要提升权限，会触发权限请求弹框
    // 用户确认后才会执行，被拒绝则返回错误
    if (needsElevation(command)) {
      const reason = getElevationReason(command);
      console.log(`\n${t('bash.adminRequired', { command })}`);
      console.log(`   ${t('bash.adminReason', { reason })}`);
      console.log(`   ${t('bash.waitingConfirm')}`);

      // 这里会触发权限弹框（通过 hook 机制）
      // 用户可以选择: 批准(会触发 UAC/sudo)、拒绝、手动处理
      const hookResult = await runPreToolUseHooks('Bash', {
        ...input,
        _elevatedCommand: true,
        _elevationReason: reason,
      });

      if (!hookResult.allowed) {
        return {
          success: false,
          error: t('bash.adminDenied', { message: hookResult.message || t('bash.userCancelled') }) + '\n\n' + t('bash.adminDeniedHint'),
        };
      }

      // 用户批准，以提升权限执行
      try {
        const elevatedResult = await executeElevated(command, getCurrentCwd(), maxTimeout);

        const duration = Date.now() - startTime;
        const auditLog: AuditLog = {
          timestamp: Date.now(),
          command,
          cwd: getCurrentCwd(),
          sandboxed: false,
          success: elevatedResult.success,
          duration,
          outputSize: (elevatedResult.stdout?.length || 0) + (elevatedResult.stderr?.length || 0),
          background: false,
          elevated: true,  // 标记为提升权限执行
        };
        recordAudit(auditLog);

        let output = elevatedResult.stdout + (elevatedResult.stderr ? `\nSTDERR:\n${elevatedResult.stderr}` : '');
        output = truncateString(output, MAX_OUTPUT_LENGTH);

        return {
          success: elevatedResult.success,
          output: `${t('bash.adminExecOutput')}\n${output}`,
          stdout: elevatedResult.stdout,
          stderr: elevatedResult.stderr,
          exitCode: elevatedResult.exitCode,
          error: elevatedResult.error,
        };
      } catch (error) {
        return {
          success: false,
          error: t('bash.adminExecFailed', { error: error instanceof Error ? error.message : String(error) }),
        };
      }
    }

    // 运行 pre-tool hooks（普通命令）
    const hookResult = await runPreToolUseHooks('Bash', input);
    if (!hookResult.allowed) {
      return {
        success: false,
        error: t('bash.blockedByHook', { message: hookResult.message || 'Operation not allowed' }),
      };
    }

    // 后台执行（用户显式指定 run_in_background=true）
    if (run_in_background) {
      return this.executeBackground(command, maxTimeout, echoOutput);
    }

    // 自动超时转后台执行（与官方 djA 类对齐）
    // 条件：后台任务未禁用 且 命令可后台化（排除 sleep 等）
    // 官方逻辑：W = !oP6 && mgY(w) → pP6(w, signal, timeout, cb, preventCwd, sandbox, backgroundable)
    //   onTimeout 回调将前台命令自动转为后台任务，进程不被杀死
    if (!isBackgroundTasksDisabled() && isBackgroundable(command)) {
      return this.executeWithTimeoutToBackground(command, maxTimeout, input);
    }

    // 不可后台化的命令（如 sleep）或后台任务被禁用时，使用沙箱执行
    // 超时将直接杀死进程

    // 如果禁用沙箱，记录警告
    if (dangerouslyDisableSandbox) {
      console.warn('[Bash Security Warning] Sandbox disabled for command:', command);
    }

    try {
      let result: BashResult;

      // 统一使用 executeInSandbox 来执行命令
      // 它会根据各种条件自动决定是否真正使用沙箱
      const sandboxResult = await executeInSandbox(command, {
        cwd: getCurrentCwd(),
        timeout: maxTimeout,
        disableSandbox: dangerouslyDisableSandbox,
        command, // 传递命令用于特殊处理（如 MCP 检测）
        // 可选：传递权限上下文（暂时不传，使用全局状态）
        // permissionContext: getGlobalAppState()?.toolPermissionContext,
      });

      // v2.1.31: 过滤 sandbox 产生的 "Read-only file system" 伪错误
      // 当 sandbox 模式启用时，某些命令的 stderr 会包含 "Read-only file system" 错误
      // 但实际上命令可能已成功执行（exitCode === 0）。这些错误不应影响命令的成功判定。
      let filteredStderr = sandboxResult.stderr;
      if (sandboxResult.sandboxed && filteredStderr) {
        const lines = filteredStderr.split('\n');
        const filtered = lines.filter(line => !(/read-only file system/i.test(line)));
        filteredStderr = filtered.join('\n').trim();
      }

      let output = sandboxResult.stdout + (filteredStderr ? `\nSTDERR:\n${filteredStderr}` : '');
      output = truncateString(output, MAX_OUTPUT_LENGTH);

      // v2.1.23: 计算执行时间
      const duration = Date.now() - startTime;
      const elapsedTimeSeconds = Math.round(duration / 1000 * 10) / 10; // 保留一位小数

      // v2.1.31: 如果在 sandbox 中执行且失败原因仅是 "Read-only file system"
      // 则将命令视为成功
      let isSuccess = sandboxResult.exitCode === 0;
      if (!isSuccess && sandboxResult.sandboxed && sandboxResult.stderr) {
        const isOnlyErofsError = sandboxResult.stderr.split('\n')
          .filter(l => l.trim().length > 0)
          .every(l => /read-only file system/i.test(l));
        if (isOnlyErofsError && sandboxResult.stdout.trim().length > 0) {
          isSuccess = true;
        }
      }

      result = {
        success: isSuccess,
        output,
        stdout: sandboxResult.stdout,
        stderr: filteredStderr,
        exitCode: sandboxResult.exitCode ?? 1,
        error: sandboxResult.error,
        // v2.1.23: 添加超时时长显示
        elapsedTimeSeconds,
        timeoutMs: maxTimeout,
      };

      // v2.1.27: 检测 gh pr create 命令，自动链接 PR 到当前会话
      if (command.includes('gh pr create') && result.success && result.output) {
        const prInfo = parsePrCreateOutput(result.output);
        if (prInfo) {
          const sessionId = getCurrentSessionId();
          if (sessionId) {
            linkSessionToPr(
              sessionId,
              prInfo.prNumber,
              prInfo.prUrl,
              prInfo.prRepository
            );
            if (process.env.DEBUG) {
              console.log(`[Bash] Auto-linked session to PR #${prInfo.prNumber}`);
            }
          }
        }
      }

      // 运行 post-tool hooks
      await runPostToolUseHooks('Bash', input, result.output || '');
      const auditLog: AuditLog = {
        timestamp: Date.now(),
        command,
        cwd: getCurrentCwd(),
        sandboxed: sandboxResult.sandboxed, // 从 sandboxResult 中获取实际的沙箱状态
        success: result.success,
        exitCode: result.exitCode,
        duration,
        outputSize: (result.output || '').length,
        background: false,
      };
      recordAudit(auditLog);

      return result;
    } catch (err: any) {
      const exitCode = err.code || 1;
      const output = (err.stdout || '') + (err.stderr ? `\nSTDERR:\n${err.stderr}` : '');

      const result: BashResult = {
        success: false,
        error: err.message,
        output,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode,
      };

      // 运行 post-tool hooks
      await runPostToolUseHooks('Bash', input, result.output || result.error || '');

      // 记录审计日志
      const duration = Date.now() - startTime;
      const auditLog: AuditLog = {
        timestamp: Date.now(),
        command,
        cwd: getCurrentCwd(),
        sandboxed: false, // 发生错误时默认为 false
        success: false,
        exitCode,
        duration,
        outputSize: output.length,
        background: false,
      };
      recordAudit(auditLog);

      return result;
    }
  }

  private executeBackground(command: string, maxRuntime: number, echoOutput: boolean = false): BashResult {
    // 启动定时清理（懒初始化，首次创建后台任务时才启动）
    ensureCleanupTimer();

    // 检查后台任务数量限制
    if (backgroundTasks.size >= MAX_BACKGROUND_SHELLS) {
      // 尝试清理已完成的任务
      const cleaned = cleanupCompletedTasks();
      if (cleaned === 0 && backgroundTasks.size >= MAX_BACKGROUND_SHELLS) {
        return {
          success: false,
          error: t('bash.maxBackgroundTasks', { max: MAX_BACKGROUND_SHELLS }),
        };
      }
    }

    // 定期清理超时的任务
    cleanupTimedOutTasks();

    // 使用 UUID 作为 task_id，与官方一致
    const taskId = uuidv4();
    const outputFile = getTaskOutputPath(taskId);

    // 准备环境变量，确保临时目录路径在 Windows 上是安全的
    const safeEnv = { ...process.env };
    if (IS_WINDOWS) {
      if (safeEnv.TMPDIR) {
        safeEnv.TMPDIR = escapePathForShell(safeEnv.TMPDIR);
      }
      if (safeEnv.TEMP) {
        safeEnv.TEMP = escapePathForShell(safeEnv.TEMP);
      }
      if (safeEnv.TMP) {
        safeEnv.TMP = escapePathForShell(safeEnv.TMP);
      }
    }

    // 获取当前工作目录，确保路径在 Windows 上是安全的
    const safeCwd = IS_WINDOWS ? escapePathForShell(getCurrentCwd()) : getCurrentCwd();

    // 跨平台命令执行
    let proc;
    if (IS_WINDOWS) {
      // Windows: 使用 shell: true 让 Node.js 自动选择合适的 shell
      proc = spawn(command, [], {
        cwd: safeCwd,
        env: safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } else {
      // Unix: 使用 bash -c
      proc = spawn('bash', ['-c', command], {
        cwd: getCurrentCwd(),
        env: safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // 创建输出文件流
    const outputStream = fs.createWriteStream(outputFile, { flags: 'w' });

    const taskState: TaskState = {
      taskId,
      process: proc,
      output: [],
      outputFile,
      outputStream,
      status: 'running',
      startTime: Date.now(),
      maxRuntime: Math.min(maxRuntime, BACKGROUND_SHELL_MAX_RUNTIME),
      outputSize: 0,
      command,
      lastReadPosition: 0,
    };

    // 设置超时清理
    const timeout = setTimeout(() => {
      if (taskState.status === 'running') {
        console.warn(`[Bash] Background task ${taskId} exceeded max runtime, terminating...`);
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (taskState.status === 'running') {
              proc.kill('SIGKILL');
            }
          }, 1000);
        } catch (err) {
          console.error(`Failed to kill task ${taskId}:`, err);
        }
      }
    }, taskState.maxRuntime);

    taskState.timeout = timeout;

    proc.stdout?.on('data', (data) => {
      const dataStr = data.toString();
      taskState.outputSize += dataStr.length;

      // 实时输出到终端（如果启用）
      if (echoOutput) {
        process.stdout.write(dataStr);
      }

      // 写入文件
      taskState.outputStream?.write(dataStr);

      // WebUI: 向前端发送输出消息
      if (broadcastMessage) {
        broadcastMessage({
          type: 'bash:task-output',
          payload: {
            taskId,
            data: dataStr,
            stream: 'stdout',
          },
        });
      }

      // 同时保存在内存中（用于 TaskOutput 工具）
      if (taskState.outputSize < MAX_BACKGROUND_OUTPUT) {
        taskState.output.push(dataStr);
      } else if (taskState.output[taskState.output.length - 1] !== '[Output limit reached]') {
        taskState.output.push('[Output limit reached - further output discarded]');
      }
    });

    proc.stderr?.on('data', (data) => {
      const dataStr = data.toString();
      const stderrStr = `STDERR: ${dataStr}`;
      taskState.outputSize += dataStr.length;

      // 实时输出到终端（如果启用）
      if (echoOutput) {
        process.stderr.write(dataStr);
      }

      // 写入文件
      taskState.outputStream?.write(stderrStr);

      // WebUI: 向前端发送输出消息
      if (broadcastMessage) {
        broadcastMessage({
          type: 'bash:task-output',
          payload: {
            taskId,
            data: dataStr,
            stream: 'stderr',
          },
        });
      }

      // 同时保存在内存中
      if (taskState.outputSize < MAX_BACKGROUND_OUTPUT) {
        taskState.output.push(stderrStr);
      } else if (taskState.output[taskState.output.length - 1] !== '[Output limit reached]') {
        taskState.output.push('[Output limit reached - further output discarded]');
      }
    });

    proc.on('close', (code) => {
      taskState.status = code === 0 ? 'completed' : 'failed';
      taskState.exitCode = code ?? undefined;
      taskState.endTime = Date.now();

      // 同步更新磁盘元数据
      updateTaskMeta(taskId, {
        status: taskState.status,
        exitCode: taskState.exitCode,
        endTime: taskState.endTime,
      });

      if (taskState.timeout) {
        clearTimeout(taskState.timeout);
      }

      // 关闭输出文件流
      taskState.outputStream?.end();

      // WebUI: 向前端发送任务完成消息
      if (broadcastMessage) {
        broadcastMessage({
          type: 'bash:task-completed',
          payload: {
            taskId,
            exitCode: code ?? 1,
            success: code === 0,
            duration: Date.now() - taskState.startTime,
          },
        });
      }

      // 记录审计日志
      const auditLog: AuditLog = {
        timestamp: Date.now(),
        command,
        cwd: getCurrentCwd(),
        sandboxed: false,
        success: code === 0,
        exitCode: code ?? undefined,
        duration: Date.now() - taskState.startTime,
        outputSize: taskState.outputSize,
        background: true,
      };
      recordAudit(auditLog);
    });

    proc.on('error', (err) => {
      taskState.status = 'failed';
      const errorMsg = `ERROR: ${err.message}`;
      taskState.output.push(errorMsg);
      taskState.outputStream?.write(errorMsg + '\n');
      taskState.outputStream?.end();
      if (taskState.timeout) {
        clearTimeout(taskState.timeout);
      }
    });

    backgroundTasks.set(taskId, taskState);

    // 持久化元数据到磁盘（进程重启后 TaskOutput 可通过 fallback 恢复）
    saveTaskMeta(taskId, {
      command,
      startTime: taskState.startTime,
      outputFile,
      status: 'running',
    });

    // WebUI: 向前端发送任务启动消息
    if (broadcastMessage) {
      broadcastMessage({
        type: 'bash:task-started',
        payload: {
          taskId,
          command: command.substring(0, 200), // 限制长度避免消息过大
          cwd: getCurrentCwd(),
        },
      });
    }

    // 返回与官方一致的格式（使用 task_id）
    const statusMsg = `<task-id>${taskId}</task-id>
<task-type>bash</task-type>
<output-file>${outputFile}</output-file>
<status>running</status>
<summary>Background command "${command.substring(0, 50)}${command.length > 50 ? '...' : ''}" started.</summary>
Use TaskOutput tool with task_id="${taskId}" to retrieve the output.`;

    return {
      success: true,
      output: statusMsg,
      task_id: taskId, // 官方字段名
      shell_id: taskId, // 向后兼容
      bash_id: taskId, // 向后兼容
    };
  }

  /**
   * 带超时自动转后台的执行方法
   *
   * 与官方实现对齐（cli.js djA 类）：
   * 1. 前台执行命令，设置超时
   * 2. 如果命令在超时前完成 → 正常返回结果
   * 3. 如果超时触发 → 进程不被杀死，自动转为后台任务继续运行
   * 4. 返回 backgroundTaskId，用户可通过 TaskOutput 工具查询进度
   *
   * 官方关键代码：
   *   static #G(A) { if(A.#$ && A.#_) A.#_(A.background.bind(A)); else A.#P(Q94); }
   *   background(A) { this.#q=A; this.#A="backgrounded"; this.#Z(); return {stdoutStream, stderrStream}; }
   */
  private async executeWithTimeoutToBackground(
    command: string,
    timeout: number,
    input: BashInput
  ): Promise<BashResult> {
    const startTime = Date.now();
    const cwd = getCurrentCwd();

    // 获取 shell 配置并 spawn 进程（与 executeBackground 保持一致）
    const shellConfig = getShellConfig();
    const proc = spawn(shellConfig.shell, [...shellConfig.args, command], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
      windowsHide: IS_WINDOWS,
    });

    let stdout = '';
    let stderr = '';
    let processExited = false;

    const stdoutHandler = (data: Buffer) => { stdout += data.toString(); };
    const stderrHandler = (data: Buffer) => { stderr += data.toString(); };

    proc.stdout?.on('data', stdoutHandler);
    proc.stderr?.on('data', stderrHandler);

    // 进程完成的 Promise
    const processComplete = new Promise<{ code: number | null; error?: string }>((resolve) => {
      proc.on('close', (code) => {
        processExited = true;
        resolve({ code });
      });
      proc.on('error', (err) => {
        processExited = true;
        resolve({ code: null, error: err.message });
      });
    });

    // 超时 Promise
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout);
    });

    // 竞争：进程完成 vs 超时
    const raceResult = await Promise.race([processComplete, timeoutPromise]);

    if (raceResult !== 'timeout') {
      // 进程在超时前完成 → 正常返回结果
      const duration = Date.now() - startTime;
      let output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      output = truncateString(output, MAX_OUTPUT_LENGTH);

      const elapsedTimeSeconds = Math.round(duration / 1000 * 10) / 10;
      const result: BashResult = {
        success: raceResult.code === 0,
        output,
        stdout,
        stderr,
        exitCode: raceResult.code ?? 1,
        error: raceResult.error,
        elapsedTimeSeconds,
        timeoutMs: timeout,
      };

      await runPostToolUseHooks('Bash', input, result.output || '');
      recordAudit({
        timestamp: Date.now(),
        command,
        cwd,
        sandboxed: false,
        success: result.success,
        exitCode: result.exitCode,
        duration,
        outputSize: (result.output || '').length,
        background: false,
      });

      return result;
    }

    // === 超时触发：自动转后台 ===
    // 进程有可能在超时竞争中刚好退出（边界情况）
    if (processExited) {
      const exitResult = await processComplete;
      const duration = Date.now() - startTime;
      let output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      output = truncateString(output, MAX_OUTPUT_LENGTH);

      const result: BashResult = {
        success: exitResult.code === 0,
        output,
        stdout,
        stderr,
        exitCode: exitResult.code ?? 1,
        error: exitResult.error,
        elapsedTimeSeconds: Math.round(duration / 1000 * 10) / 10,
        timeoutMs: timeout,
      };

      await runPostToolUseHooks('Bash', input, result.output || '');
      recordAudit({
        timestamp: Date.now(),
        command,
        cwd,
        sandboxed: false,
        success: result.success,
        exitCode: result.exitCode,
        duration,
        outputSize: (result.output || '').length,
        background: false,
      });

      return result;
    }

    // 进程仍在运行 → 转为后台任务（不杀死进程）
    const taskId = uuidv4();
    const outputFile = getTaskOutputPath(taskId);
    const outputStream = fs.createWriteStream(outputFile, { flags: 'w' });

    // 写入已捕获的输出到文件
    const existingOutput = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
    if (existingOutput) {
      outputStream.write(existingOutput);
    }

    // 创建后台任务状态
    const taskState: TaskState = {
      taskId,
      process: proc,
      output: existingOutput ? [existingOutput] : [],
      outputFile,
      outputStream,
      status: 'running',
      startTime,
      maxRuntime: BACKGROUND_SHELL_MAX_RUNTIME,
      outputSize: existingOutput.length,
      command,
      lastReadPosition: 0,
    };

    // 替换 stdout/stderr 监听器：将后续输出重定向到文件
    proc.stdout?.removeListener('data', stdoutHandler);
    proc.stderr?.removeListener('data', stderrHandler);

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      taskState.output.push(text);
      taskState.outputSize += text.length;
      if (taskState.outputSize <= MAX_BACKGROUND_OUTPUT) {
        outputStream.write(text);
      } else if (taskState.output[taskState.output.length - 1] !== '[Output limit reached]') {
        outputStream.write('\n[Output limit reached]\n');
        taskState.output.push('[Output limit reached]');
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = `STDERR: ${data.toString()}`;
      taskState.output.push(text);
      taskState.outputSize += text.length;
      if (taskState.outputSize <= MAX_BACKGROUND_OUTPUT) {
        outputStream.write(text);
      }
    });

    // 后台任务的进程生命周期管理
    proc.on('close', (code) => {
      if (taskState.timeout) clearTimeout(taskState.timeout);
      taskState.status = code === 0 ? 'completed' : 'failed';
      taskState.exitCode = code ?? undefined;
      taskState.endTime = Date.now();
      outputStream.end();

      // 同步更新磁盘元数据
      updateTaskMeta(taskId, {
        status: taskState.status,
        exitCode: taskState.exitCode,
        endTime: taskState.endTime,
      });

      const duration = Date.now() - startTime;
      recordAudit({
        timestamp: Date.now(),
        command,
        cwd,
        sandboxed: false,
        success: code === 0,
        exitCode: code ?? undefined,
        duration,
        outputSize: taskState.outputSize,
        background: true,
      });
    });

    proc.on('error', (err) => {
      taskState.status = 'failed';
      taskState.endTime = Date.now();
      outputStream.write(`\nERROR: ${err.message}\n`);
      outputStream.end();
      updateTaskMeta(taskId, { status: 'failed', endTime: taskState.endTime });
    });

    // 设置后台最大运行时间超时
    taskState.timeout = setTimeout(() => {
      if (taskState.status === 'running') {
        console.warn(`[Bash] Background task ${taskId} exceeded max runtime, terminating...`);
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (taskState.status === 'running') {
              proc.kill('SIGKILL');
            }
          }, 1000);
        } catch (err) {
          console.error(`Failed to kill task ${taskId}:`, err);
        }
      }
    }, BACKGROUND_SHELL_MAX_RUNTIME);

    backgroundTasks.set(taskId, taskState);

    // 持久化元数据到磁盘（进程重启后 TaskOutput 可通过 fallback 恢复）
    saveTaskMeta(taskId, {
      command,
      startTime,
      outputFile,
      status: 'running',
    });

    // 记录审计日志
    const duration = Date.now() - startTime;
    const elapsedSeconds = Math.round(duration / 1000 * 10) / 10;

    recordAudit({
      timestamp: Date.now(),
      command,
      cwd,
      sandboxed: false,
      success: true,
      duration,
      outputSize: existingOutput.length,
      background: true,
    });

    // 返回结果（与官方格式对齐）
    // 官方: { stdout: "", stderr: "", code: 0, interrupted: false, backgroundTaskId: M }
    const statusMsg = `Command timed out after ${elapsedSeconds}s and was automatically moved to background execution.
<task-id>${taskId}</task-id>
<task-type>bash</task-type>
<output-file>${outputFile}</output-file>
<status>running</status>
<summary>Command "${command.substring(0, 50)}${command.length > 50 ? '...' : ''}" moved to background after timeout.</summary>
Use TaskOutput tool with task_id="${taskId}" to retrieve the output.`;

    return {
      success: true,
      output: statusMsg,
      task_id: taskId,
      shell_id: taskId,
      bash_id: taskId,
      backgroundTaskId: taskId,
      elapsedTimeSeconds: elapsedSeconds,
      timeoutMs: timeout,
    };
  }
}

export class KillShellTool extends BaseTool<{ shell_id: string }, BashResult> {
  name = 'TaskStop';
  description = `
- Kills a running background bash shell by its ID
- Takes a shell_id parameter identifying the shell to kill
- Returns a success or failure status
- Use this tool when you need to terminate a long-running shell
- Shell IDs can be found using the /tasks command`.trim();

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        shell_id: {
          type: 'string',
          description: 'The ID of the background shell to kill',
        },
      },
      required: ['shell_id'],
    };
  }

  async execute(input: { shell_id: string }): Promise<BashResult> {
    const task = backgroundTasks.get(input.shell_id);
    if (!task) {
      return { success: false, error: t('bash.shellNotFound', { id: input.shell_id }) };
    }

    try {
      task.process.kill('SIGTERM');
      // 关闭输出流
      task.outputStream?.end();

      // 等待一秒，如果还在运行则强制杀死
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (task.status === 'running') {
        task.process.kill('SIGKILL');
      }

      backgroundTasks.delete(input.shell_id);

      // v2.1.30: 显示被停止任务的命令/描述，而不是通用消息
      return {
        success: true,
        output: t('bash.taskStopped', { id: input.shell_id, command: task.command }),
      };
    } catch (err) {
      return { success: false, error: t('bash.taskStopFailed', { error: err }) };
    }
  }
}

/**
 * 获取所有后台任务的状态
 */
export function getBackgroundTasks(): Array<{
  id: string;
  status: string;
  duration: number;
}> {
  const result: Array<{ id: string; status: string; duration: number }> = [];

  Array.from(backgroundTasks.entries()).forEach(([id, task]) => {
    result.push({
      id,
      status: task.status,
      duration: Date.now() - task.startTime,
    });
  });

  return result;
}

/**
 * 向后兼容：获取所有后台 shell 的状态
 */
export function getBackgroundShells(): Array<{
  id: string;
  status: string;
  duration: number;
}> {
  return getBackgroundTasks();
}

/**
 * 清理已完成的后台任务
 */
export function cleanupCompletedTasks(): number {
  let cleaned = 0;

  Array.from(backgroundTasks.entries()).forEach(([id, task]) => {
    if (task.status !== 'running') {
      // 清理超时定时器
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      // 关闭输出流
      task.outputStream?.end();
      backgroundTasks.delete(id);
      cleaned++;
    }
  });

  return cleaned;
}

/**
 * 向后兼容：清理已完成的后台 shell
 */
export function cleanupCompletedShells(): number {
  return cleanupCompletedTasks();
}

/**
 * 获取审计日志
 */
export function getAuditLogs(options?: {
  limit?: number;
  since?: number;
  success?: boolean;
}): AuditLog[] {
  let logs = [...auditLogs];

  // 按时间筛选
  if (options?.since) {
    logs = logs.filter((log) => log.timestamp >= options.since);
  }

  // 按成功状态筛选
  if (options?.success !== undefined) {
    logs = logs.filter((log) => log.success === options.success);
  }

  // 限制数量
  if (options?.limit) {
    logs = logs.slice(-options.limit);
  }

  return logs;
}

/**
 * 获取审计统计
 */
export function getAuditStats(): {
  total: number;
  success: number;
  failed: number;
  sandboxed: number;
  background: number;
  avgDuration: number;
  totalOutputSize: number;
} {
  const total = auditLogs.length;
  const success = auditLogs.filter((log) => log.success).length;
  const failed = total - success;
  const sandboxed = auditLogs.filter((log) => log.sandboxed).length;
  const background = auditLogs.filter((log) => log.background).length;

  const totalDuration = auditLogs.reduce((sum, log) => sum + log.duration, 0);
  const avgDuration = total > 0 ? totalDuration / total : 0;

  const totalOutputSize = auditLogs.reduce((sum, log) => sum + log.outputSize, 0);

  return {
    total,
    success,
    failed,
    sandboxed,
    background,
    avgDuration,
    totalOutputSize,
  };
}

/**
 * 清除审计日志
 */
export function clearAuditLogs(): number {
  const count = auditLogs.length;
  auditLogs.length = 0;
  return count;
}

/**
 * 列出所有后台任务详细信息
 */
export function listBackgroundTasks(): Array<{
  id: string;
  command: string;
  status: string;
  duration: number;
  outputSize: number;
  maxRuntime?: number;
}> {
  const result: Array<{
    id: string;
    command: string;
    status: string;
    duration: number;
    outputSize: number;
    maxRuntime?: number;
  }> = [];

  Array.from(backgroundTasks.entries()).forEach(([id, task]) => {
    result.push({
      id,
      command: task.command.substring(0, 100) + (task.command.length > 100 ? '...' : ''),
      status: task.status,
      duration: Date.now() - task.startTime,
      outputSize: task.outputSize,
      maxRuntime: task.maxRuntime,
    });
  });

  return result;
}

/**
 * 向后兼容：列出所有后台 shell 详细信息
 */
export function listBackgroundShells(): Array<{
  id: string;
  command: string;
  status: string;
  duration: number;
  outputSize: number;
  maxRuntime?: number;
}> {
  return listBackgroundTasks();
}

/**
 * 强制终止所有后台任务
 */
export function killAllBackgroundTasks(): number {
  let killed = 0;

  Array.from(backgroundTasks.entries()).forEach(([id, task]) => {
    try {
      task.process.kill('SIGTERM');
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      // 关闭输出流
      task.outputStream?.end();
      setTimeout(() => {
        if (task.status === 'running') {
          task.process.kill('SIGKILL');
        }
      }, 1000);
      killed++;
    } catch (err) {
      console.error(`Failed to kill task ${id}:`, err);
    }
  });

  backgroundTasks.clear();
  return killed;
}

/**
 * 向后兼容：强制终止所有后台 shell
 */
export function killAllBackgroundShells(): number {
  return killAllBackgroundTasks();
}
