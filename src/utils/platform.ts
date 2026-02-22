/**
 * 跨平台工具模块
 * 处理 Windows/macOS/Linux 平台差异
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, SpawnOptions, ChildProcess, execSync, spawnSync } from 'child_process';

// ============================================================================
// 平台检测
// ============================================================================

/**
 * 获取当前平台类型
 */
export type PlatformType = 'windows' | 'macos' | 'linux' | 'unknown';

export function getPlatform(): PlatformType {
  switch (os.platform()) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

/**
 * 检查是否为 Windows 平台
 */
export function isWindows(): boolean {
  return os.platform() === 'win32';
}

/**
 * 检查是否为 macOS 平台
 */
export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

/**
 * 检查是否为 Linux 平台
 */
export function isLinux(): boolean {
  return os.platform() === 'linux';
}

/**
 * 检查是否在 WSL 环境中运行
 */
export function isWSL(): boolean {
  if (os.platform() !== 'linux') return false;

  try {
    // 检查 /proc/version 是否包含 Microsoft 或 WSL
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * 检查是否在 Windows 上使用 Windows NPM (而非 WSL NPM)
 */
export function isWindowsNpmInWSL(): boolean {
  if (!isWSL()) return false;

  // 检查当前可执行文件路径是否在 /mnt/c 或 /mnt/d 等
  const execPath = process.execPath;
  return execPath.startsWith('/mnt/');
}

// ============================================================================
// 路径处理
// ============================================================================

/**
 * 获取用户主目录
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * 获取配置目录 (~/.claude 或 %USERPROFILE%\.claude)
 */
export function getConfigDir(): string {
  const home = getHomeDir();
  return path.join(home, '.claude');
}

/**
 * 获取会话存储目录
 */
export function getSessionsDir(): string {
  return path.join(getConfigDir(), 'sessions');
}

/**
 * 获取临时目录
 * 支持 CLAUDE_CODE_TMPDIR 环境变量覆盖
 */
export function getTempDir(): string {
  if (process.env.CLAUDE_CODE_TMPDIR) {
    return process.env.CLAUDE_CODE_TMPDIR;
  }
  if (isWindows()) {
    return process.env.TEMP || 'C:\\Temp';
  }
  return '/tmp';
}

/**
 * 获取安全的临时目录路径（用于 shell 命令）
 * 在 Windows 上，临时目录路径可能包含 \t 或 \n 这样的字符序列，
 * 这些会被 shell 误解为转义序列（制表符或换行符）。
 * 此函数确保路径在传递给 shell 时是安全的。
 */
export function getSafeTempDir(): string {
  const tmpDir = getTempDir();
  // 在 Windows 上，使用正斜杠来避免反斜杠被误解为转义序列
  // 或者对反斜杠进行双重转义
  if (isWindows()) {
    // 使用 path.normalize 确保路径正确，然后转换为正斜杠
    return path.normalize(tmpDir).replace(/\\/g, '/');
  }
  return tmpDir;
}

/**
 * 转义路径中的特殊字符，使其可以安全地在 shell 命令中使用
 * 主要用于 Windows 上防止 \t, \n 等被误解为转义序列
 */
export function escapePathForShell(filePath: string): string {
  if (isWindows()) {
    // 在 Windows 上，将反斜杠替换为正斜杠
    // 这在大多数情况下都能正常工作（包括 Git Bash, PowerShell 等）
    return filePath.replace(/\\/g, '/');
  }
  return filePath;
}

/**
 * 双重转义路径中的反斜杠，用于需要在字符串中保留原始反斜杠的场景
 * 例如：C:\Users\Test 变成 C:\\Users\\Test
 */
export function doubleEscapeBackslashes(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\');
}

/**
 * 规范化路径（处理斜杠方向）
 */
export function normalizePath(filePath: string): string {
  // 使用 path.normalize 处理路径
  return path.normalize(filePath);
}

/**
 * 将 Windows 路径转换为 Unix 风格（用于显示）
 */
export function toUnixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * 将 Unix 路径转换为当前平台风格
 */
export function toPlatformPath(filePath: string): string {
  if (isWindows()) {
    return filePath.replace(/\//g, '\\');
  }
  return filePath;
}

/**
 * 解析环境变量路径（支持 %VAR% 和 $VAR 格式）
 */
export function expandEnvPath(filePath: string): string {
  let result = filePath;

  // 处理 Windows 格式 %VAR%
  result = result.replace(/%([^%]+)%/g, (_, varName) => {
    return process.env[varName] || '';
  });

  // 处理 Unix 格式 $VAR 和 ${VAR}
  result = result.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) => {
    return process.env[varName] || '';
  });

  // 处理 ~ 开头的路径
  if (result.startsWith('~')) {
    result = path.join(getHomeDir(), result.slice(1));
  }

  return result;
}

/**
 * 确保路径使用正确的分隔符
 */
export function ensureCorrectSeparator(filePath: string): string {
  if (isWindows()) {
    // Windows: 保留驱动器号，转换斜杠
    return filePath.replace(/\//g, '\\');
  } else {
    // Unix: 转换反斜杠为正斜杠
    return filePath.replace(/\\/g, '/');
  }
}

/**
 * 将 MSYS/Git Bash 路径转换为 Windows 路径
 *
 * Git Bash 输出的路径格式为 /c/Users/... 或 /f/claude-code-open/...
 * Node.js 的 fs 模块不认识这种格式（会解释为 C:\c\Users\...），需要转换为 C:/Users/...
 *
 * 匹配规则：以 / 开头，紧跟单个字母，再跟 /
 * 例如：/f/claude-code-open → F:/claude-code-open
 */
export function fromMsysPath(filePath: string): string {
  if (!isWindows()) return filePath;
  // /x/... → X:/...
  const match = filePath.match(/^\/([a-zA-Z])(\/.*)/);
  if (match) {
    return match[1].toUpperCase() + ':' + match[2];
  }
  return filePath;
}

/**
 * 安全地拼接路径
 */
export function safePath(...paths: string[]): string {
  return path.join(...paths);
}

/**
 * 获取相对路径（安全版本）
 */
export function safeRelative(from: string, to: string): string {
  try {
    return path.relative(from, to);
  } catch {
    return to;
  }
}

// ============================================================================
// Shell 命令处理
// ============================================================================

export interface ShellInfo {
  shell: string;
  args: string[];
  isCmd: boolean;
  isPowerShell: boolean;
}

/**
 * 获取默认 Shell
 */
export function getDefaultShell(): ShellInfo {
  if (isWindows()) {
    // 优先使用 PowerShell，回退到 cmd
    const powershell = process.env.COMSPEC?.toLowerCase().includes('powershell')
      ? process.env.COMSPEC
      : 'powershell.exe';

    // 检查 PowerShell 是否可用
    try {
      execSync('powershell -Command "echo test"', { stdio: 'ignore', windowsHide: true });
      return {
        shell: powershell,
        args: ['-NoProfile', '-Command'],
        isCmd: false,
        isPowerShell: true,
      };
    } catch {
      // 回退到 cmd
      const cmd = process.env.COMSPEC || 'cmd.exe';
      return {
        shell: cmd,
        args: ['/c'],
        isCmd: true,
        isPowerShell: false,
      };
    }
  }

  // Unix 系统
  const shell = process.env.SHELL || '/bin/bash';
  return {
    shell,
    args: ['-c'],
    isCmd: false,
    isPowerShell: false,
  };
}

/**
 * 包装命令以适配不同的 Shell
 */
export function wrapCommand(command: string): { shell: string; args: string[] } {
  const shellInfo = getDefaultShell();

  if (shellInfo.isPowerShell) {
    // PowerShell 需要特殊处理
    return {
      shell: shellInfo.shell,
      args: [...shellInfo.args, command],
    };
  }

  if (shellInfo.isCmd) {
    // CMD 需要转义特殊字符
    const escapedCommand = command.replace(/[&|<>^]/g, '^$&');
    return {
      shell: shellInfo.shell,
      args: [...shellInfo.args, escapedCommand],
    };
  }

  // Unix shells
  return {
    shell: shellInfo.shell,
    args: [...shellInfo.args, command],
  };
}

/**
 * 执行跨平台命令
 */
export function executeCommand(
  command: string,
  options: SpawnOptions = {}
): ChildProcess {
  const wrapped = wrapCommand(command);

  const defaultOptions: SpawnOptions = {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  return spawn(wrapped.shell, wrapped.args, { ...defaultOptions, ...options });
}

/**
 * 同步执行跨平台命令
 */
export function executeCommandSync(
  command: string,
  options: { cwd?: string; timeout?: number; encoding?: BufferEncoding } = {}
): { stdout: string; stderr: string; status: number | null } {
  const wrapped = wrapCommand(command);

  try {
    const result = spawnSync(wrapped.shell, wrapped.args, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 30000,
      encoding: options.encoding || 'utf-8',
      env: process.env,
    });

    return {
      stdout: result.stdout?.toString() || '',
      stderr: result.stderr?.toString() || '',
      status: result.status,
    };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: err.message || 'Command execution failed',
      status: 1,
    };
  }
}

// ============================================================================
// 进程信号处理
// ============================================================================

export type PlatformSignal = 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP' | 'SIGQUIT';

/**
 * 获取平台支持的信号
 */
export function getSupportedSignals(): PlatformSignal[] {
  if (isWindows()) {
    // Windows 只支持有限的信号
    return ['SIGTERM', 'SIGKILL', 'SIGINT'];
  }

  return ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGQUIT'];
}

/**
 * 安全地发送信号到进程
 */
export function killProcess(
  pid: number | ChildProcess,
  signal: PlatformSignal = 'SIGTERM'
): boolean {
  try {
    if (typeof pid === 'number') {
      process.kill(pid, signal);
    } else if (pid && typeof pid.kill === 'function') {
      pid.kill(signal);
    } else {
      return false;
    }
    return true;
  } catch (err: any) {
    // 进程可能已经退出
    if (err.code === 'ESRCH') {
      return true; // 进程不存在，视为成功
    }
    console.error(`Failed to kill process: ${err.message}`);
    return false;
  }
}

/**
 * 强制终止进程（跨平台）
 */
export async function forceKillProcess(
  pid: number | ChildProcess,
  graceTimeout: number = 1000
): Promise<boolean> {
  // 首先尝试优雅终止
  if (!killProcess(pid, 'SIGTERM')) {
    return false;
  }

  // 等待一段时间后强制终止
  await new Promise(resolve => setTimeout(resolve, graceTimeout));

  // 发送 SIGKILL
  return killProcess(pid, 'SIGKILL');
}

/**
 * 在 Windows 上使用 taskkill 终止进程树
 */
export function killProcessTree(pid: number): boolean {
  try {
    if (isWindows()) {
      // Windows: 使用 taskkill 终止整个进程树
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      // Unix: 使用 SIGTERM 发送到进程组
      process.kill(-pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// 文件权限处理
// ============================================================================

/**
 * 设置文件权限（跨平台兼容）
 */
export function setFilePermissions(filePath: string, mode: number): boolean {
  try {
    if (isWindows()) {
      // Windows 不支持 Unix 风格的权限，使用 ACL
      // 简单实现：确保文件可读写
      fs.accessSync(filePath, fs.constants.W_OK);
      return true;
    } else {
      fs.chmodSync(filePath, mode);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * 检查文件是否可执行
 */
export function isExecutable(filePath: string): boolean {
  try {
    if (isWindows()) {
      // Windows: 检查扩展名
      const ext = path.extname(filePath).toLowerCase();
      return ['.exe', '.cmd', '.bat', '.com', '.ps1'].includes(ext);
    } else {
      // Unix: 检查执行权限
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * 设置文件为可执行
 */
export function makeExecutable(filePath: string): boolean {
  try {
    if (isWindows()) {
      // Windows 不需要设置执行位
      return true;
    } else {
      // Unix: 添加执行权限
      const stat = fs.statSync(filePath);
      fs.chmodSync(filePath, stat.mode | 0o111);
      return true;
    }
  } catch {
    return false;
  }
}

// ============================================================================
// 环境变量处理
// ============================================================================

/**
 * 获取 PATH 分隔符
 */
export function getPathSeparator(): string {
  return path.delimiter; // Windows: ';', Unix: ':'
}

/**
 * 拆分 PATH 环境变量
 */
export function splitPath(pathEnv?: string): string[] {
  const p = pathEnv || process.env.PATH || '';
  return p.split(getPathSeparator()).filter(Boolean);
}

/**
 * 合并 PATH 环境变量
 */
export function joinPath(paths: string[]): string {
  return paths.filter(Boolean).join(getPathSeparator());
}

/**
 * 查找可执行文件
 */
export function findExecutable(name: string, additionalPaths: string[] = []): string | null {
  const paths = [...additionalPaths, ...splitPath()];

  // Windows 需要添加扩展名
  const extensions = isWindows() ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];

  for (const dir of paths) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, name + ext);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return fullPath;
      } catch {
        // 继续检查
      }
    }
  }

  return null;
}

/**
 * 获取平台特定的环境变量
 */
export function getPlatformEnv(): Record<string, string> {
  const baseEnv: Record<string, string> = { ...process.env } as Record<string, string>;

  if (isWindows()) {
    // 确保 Windows 常用变量存在
    baseEnv.USERPROFILE = process.env.USERPROFILE || getHomeDir();
    baseEnv.APPDATA = process.env.APPDATA || path.join(getHomeDir(), 'AppData', 'Roaming');
    baseEnv.LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local');
  } else {
    // 确保 Unix 常用变量存在
    baseEnv.HOME = process.env.HOME || getHomeDir();
    baseEnv.USER = process.env.USER || os.userInfo().username;
  }

  return baseEnv;
}

// ============================================================================
// 终端标题设置 (v2.1.6+)
// v2.1.7: 添加终端标题 spinner 动画，使用等宽 braille 字符避免抖动
// ============================================================================

// 当前终端标题后缀（如项目名）
let currentTerminalTitleSuffix = '';

// 静态图标
const TERMINAL_TITLE_STATIC_ICON = '✳';

// v2.1.7: 等宽 braille 字符用于终端标题 spinner
// 这些字符宽度相同，避免终端标题宽度变化导致的抖动
const TERMINAL_TITLE_SPINNER_FRAMES = ['⠂', '⠐'];

// 动画间隔 (毫秒)
const TERMINAL_TITLE_ANIMATION_INTERVAL = 960;

// 动画状态
let titleSpinnerTimer: ReturnType<typeof setInterval> | null = null;
let titleSpinnerFrameIndex = 0;

/**
 * 内部函数：设置终端标题
 * @param icon 图标字符
 * @param suffix 后缀
 */
function setTerminalTitleInternal(icon: string, suffix?: string): void {
  // 检查是否禁用终端标题
  if (process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) {
    return;
  }

  const fullTitle = suffix ? `${icon} ${suffix}` : icon;

  if (isWindows()) {
    process.title = fullTitle;
  } else {
    // 使用 ANSI 转义序列设置终端标题
    // \x1B]0;...\x07 - 设置图标名称和窗口标题
    process.stdout.write(`\x1B]0;${fullTitle}\x07`);
  }
}

/**
 * 设置终端标题后缀
 *
 * @param suffix 标题后缀（如项目名）
 */
export function setTerminalTitle(title: string, suffix?: string): void {
  // 检查是否禁用终端标题
  if (process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) {
    return;
  }

  // 存储后缀
  currentTerminalTitleSuffix = suffix ? `${title} ${suffix}` : title;

  // 如果没有在播放动画，立即更新标题
  if (!titleSpinnerTimer) {
    setTerminalTitleInternal(TERMINAL_TITLE_STATIC_ICON, currentTerminalTitleSuffix);
  }
}

/**
 * 设置终端标题后缀（不包含图标）
 *
 * @param suffix 标题后缀
 */
export function setTerminalTitleSuffix(suffix: string): void {
  currentTerminalTitleSuffix = suffix;

  // 如果没有在播放动画，立即更新标题
  if (!titleSpinnerTimer) {
    setTerminalTitleInternal(TERMINAL_TITLE_STATIC_ICON, currentTerminalTitleSuffix);
  }
}

/**
 * 重置终端标题为 "Claude Code"
 */
export function resetTerminalTitle(): void {
  setTerminalTitleSuffix('Claude Code');
}

/**
 * 获取当前终端标题后缀
 */
export function getTerminalTitle(): string {
  return currentTerminalTitleSuffix;
}

/**
 * v2.1.7: 开始终端标题 spinner 动画
 *
 * 使用等宽 braille 字符避免终端标题宽度变化导致的抖动
 */
export function startTerminalTitleSpinner(): void {
  // 检查是否禁用终端标题
  if (process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) {
    return;
  }

  // 如果已经在播放动画，不重复启动
  if (titleSpinnerTimer) {
    return;
  }

  titleSpinnerFrameIndex = 0;

  titleSpinnerTimer = setInterval(() => {
    titleSpinnerFrameIndex = (titleSpinnerFrameIndex + 1) % TERMINAL_TITLE_SPINNER_FRAMES.length;
    const frame = TERMINAL_TITLE_SPINNER_FRAMES[titleSpinnerFrameIndex] ?? TERMINAL_TITLE_STATIC_ICON;
    setTerminalTitleInternal(frame, currentTerminalTitleSuffix);
  }, TERMINAL_TITLE_ANIMATION_INTERVAL);
}

/**
 * v2.1.7: 停止终端标题 spinner 动画
 *
 * 恢复静态图标
 */
export function stopTerminalTitleSpinner(): void {
  if (titleSpinnerTimer) {
    clearInterval(titleSpinnerTimer);
    titleSpinnerTimer = null;
  }

  // 恢复静态图标
  setTerminalTitleInternal(TERMINAL_TITLE_STATIC_ICON, currentTerminalTitleSuffix);
}

/**
 * v2.1.7: 检查终端标题 spinner 是否正在运行
 */
export function isTerminalTitleSpinnerRunning(): boolean {
  return titleSpinnerTimer !== null;
}

// ============================================================================
// 沙箱兼容性
// ============================================================================

export interface SandboxCapabilities {
  bubblewrap: boolean;
  windowsSandbox: boolean;
  docker: boolean;
  none: boolean;
}

/**
 * 获取平台沙箱能力
 */
export function getSandboxCapabilities(): SandboxCapabilities {
  const caps: SandboxCapabilities = {
    bubblewrap: false,
    windowsSandbox: false,
    docker: false,
    none: true,
  };

  if (isLinux()) {
    // 检查 bubblewrap
    try {
      execSync('which bwrap', { stdio: 'ignore' });
      caps.bubblewrap = true;
    } catch {
      // Not available
    }
  }

  if (isWindows()) {
    // 检查 Windows Sandbox
    try {
      execSync('powershell -Command "Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM"', { stdio: 'ignore', windowsHide: true });
      caps.windowsSandbox = true;
    } catch {
      // Not available
    }
  }

  // 检查 Docker
  try {
    execSync(isWindows() ? 'docker --version' : 'which docker', { stdio: 'ignore' });
    caps.docker = true;
  } catch {
    // Not available
  }

  return caps;
}

/**
 * 获取推荐的沙箱类型
 */
export function getRecommendedSandbox(): 'bubblewrap' | 'docker' | 'none' {
  const caps = getSandboxCapabilities();

  if (caps.bubblewrap) return 'bubblewrap';
  if (caps.docker) return 'docker';

  return 'none';
}

// ============================================================================
// 导出
// ============================================================================

export default {
  // 平台检测
  getPlatform,
  isWindows,
  isMacOS,
  isLinux,
  isWSL,
  isWindowsNpmInWSL,

  // 路径处理
  getHomeDir,
  getConfigDir,
  getSessionsDir,
  getTempDir,
  getSafeTempDir,
  escapePathForShell,
  doubleEscapeBackslashes,
  normalizePath,
  toUnixPath,
  toPlatformPath,
  expandEnvPath,
  ensureCorrectSeparator,
  safePath,
  safeRelative,

  // Shell 命令
  getDefaultShell,
  wrapCommand,
  executeCommand,
  executeCommandSync,

  // 进程信号
  getSupportedSignals,
  killProcess,
  forceKillProcess,
  killProcessTree,

  // 文件权限
  setFilePermissions,
  isExecutable,
  makeExecutable,

  // 环境变量
  getPathSeparator,
  splitPath,
  joinPath,
  findExecutable,
  getPlatformEnv,

  // 沙箱
  getSandboxCapabilities,
  getRecommendedSandbox,

  // 终端标题
  setTerminalTitle,
  setTerminalTitleSuffix,
  resetTerminalTitle,
  getTerminalTitle,
  // v2.1.7: 终端标题 spinner 动画
  startTerminalTitleSpinner,
  stopTerminalTitleSpinner,
  isTerminalTitleSpinnerRunning,
};
