/**
 * 沙箱执行支持
 * 支持多平台: Linux (Bubblewrap), macOS (Seatbelt), Windows (无沙箱)
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getGlobalAppState } from './planmode.js';
import type { ToolPermissionContext } from './planmode.js';
import { escapePathForShell, isWindows } from '../utils/platform.js';
import { getCurrentCwd } from '../core/cwd-context.js';

// ============ 跨平台进程终止 ============

/** 获取平台适配的终止信号类型 */
type TermSignal = 'SIGTERM' | 'SIGKILL' | 'SIGINT';

/**
 * 安全地终止进程（跨平台）
 * 在Windows上使用taskkill终止进程树，Unix上使用信号
 */
function killProcessSafely(proc: ChildProcess, signal: TermSignal = 'SIGTERM'): boolean {
  try {
    if (isWindows() && proc.pid) {
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

// ============ 类型定义 ============

export type SandboxType = 'bubblewrap' | 'seatbelt' | 'none';

export interface SandboxOptions {
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 允许写入的路径 */
  writablePaths?: string[];
  /** 允许读取的路径 */
  readOnlyPaths?: string[];
  /** 是否允许网络访问 */
  network?: boolean;
  /** 是否禁用沙箱 */
  disableSandbox?: boolean;
  /** 是否允许访问 /dev */
  allowDevAccess?: boolean;
  /** 是否允许访问 /proc */
  allowProcAccess?: boolean;
  /** 是否允许访问 /sys */
  allowSysAccess?: boolean;
  /** 自定义环境变量白名单 */
  envWhitelist?: string[];
  /** 最大内存限制（字节） */
  maxMemory?: number;
  /** 最大 CPU 使用率 (0-100) */
  maxCpu?: number;
  /** 工具权限上下文（用于权限模式判断） */
  permissionContext?: ToolPermissionContext;
  /** 命令（用于特殊处理，如 mcp-cli） */
  command?: string;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  error?: string;
  /** 是否在沙箱中执行 */
  sandboxed: boolean;
  /** 使用的沙箱类型 */
  sandboxType: SandboxType;
}

export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 默认允许写入的路径 */
  defaultWritablePaths: string[];
  /** 默认只读路径 */
  defaultReadOnlyPaths: string[];
  /** 沙箱失败时是否降级执行 */
  fallbackOnError: boolean;
  /** 显示沙箱错误信息 */
  showSandboxErrors: boolean;
  /** 允许用户绕过沙箱 */
  allowBypass: boolean;
  /**
   * v2.1.34: 当沙箱启用时自动允许 Bash 命令
   * 默认 true（对齐官方）
   */
  autoAllowBashIfSandboxed?: boolean;
  /**
   * v2.1.34: 允许非沙箱命令（通过 dangerouslyDisableSandbox 参数）
   * 当设为 false 时，dangerouslyDisableSandbox 参数被完全忽略
   * 默认 true
   */
  allowUnsandboxedCommands?: boolean;
  /**
   * v2.1.34: 排除命令列表
   * 匹配的命令不会被沙箱包裹
   * 支持精确匹配、前缀匹配（"npm:*"）和通配符匹配
   */
  excludedCommands?: string[];
}

// ============ 全局配置 ============

let sandboxConfig: SandboxConfig = {
  enabled: true,
  defaultWritablePaths: [],
  defaultReadOnlyPaths: [],
  fallbackOnError: true,
  showSandboxErrors: true,
  allowBypass: true,
};

/**
 * 获取沙箱配置
 */
export function getSandboxConfig(): SandboxConfig {
  return { ...sandboxConfig };
}

/**
 * 设置沙箱配置
 */
export function setSandboxConfig(config: Partial<SandboxConfig>): void {
  sandboxConfig = { ...sandboxConfig, ...config };
}

// ============ 平台检测 ============

/**
 * 获取当前平台
 */
export function getPlatform(): 'linux' | 'darwin' | 'win32' | 'unknown' {
  const platform = os.platform();
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') {
    return platform;
  }
  return 'unknown';
}

/**
 * 检查 bubblewrap 是否可用 (Linux)
 */
export function isBubblewrapAvailable(): boolean {
  if (getPlatform() !== 'linux') {
    return false;
  }
  try {
    const result = spawnSync('which', ['bwrap'], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 检查 seatbelt 是否可用 (macOS)
 */
export function isSeatbeltAvailable(): boolean {
  if (getPlatform() !== 'darwin') {
    return false;
  }
  try {
    // macOS 自带 sandbox-exec
    const result = spawnSync('which', ['sandbox-exec'], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 检查是否有任何沙箱可用
 */
export function isSandboxAvailable(): boolean {
  return isBubblewrapAvailable() || isSeatbeltAvailable();
}

/**
 * 获取可用的沙箱类型
 */
export function getSandboxType(): SandboxType {
  if (isBubblewrapAvailable()) {
    return 'bubblewrap';
  }
  if (isSeatbeltAvailable()) {
    return 'seatbelt';
  }
  return 'none';
}

// ============ 沙箱状态 ============

/**
 * 沙箱状态信息
 */
export function getSandboxStatus(): {
  available: boolean;
  type: SandboxType;
  version?: string;
  platform: string;
  reason?: string;
} {
  const platform = getPlatform();

  if (isBubblewrapAvailable()) {
    try {
      const result = spawnSync('bwrap', ['--version'], { encoding: 'utf-8' });
      const version = result.stdout?.trim() || result.stderr?.trim();
      return {
        available: true,
        type: 'bubblewrap',
        version,
        platform,
      };
    } catch {
      return { available: true, type: 'bubblewrap', platform };
    }
  }

  if (isSeatbeltAvailable()) {
    return {
      available: true,
      type: 'seatbelt',
      version: 'macOS built-in',
      platform,
    };
  }

  // 返回不可用的原因
  let reason: string;
  if (platform === 'win32') {
    reason = 'Windows does not support sandboxing. Consider using WSL for sandbox support.';
  } else if (platform === 'linux') {
    reason = 'Bubblewrap (bwrap) is not installed. Install it with your package manager.';
  } else if (platform === 'darwin') {
    reason = 'sandbox-exec is not available on this macOS version.';
  } else {
    reason = `Unsupported platform: ${platform}`;
  }

  return { available: false, type: 'none', platform, reason };
}

// ============ Bubblewrap 配置 (Linux) ============

/**
 * 获取 Bubblewrap 的默认配置
 */
function getBubblewrapConfig(cwd: string, options: SandboxOptions = {}): string[] {
  const home = os.homedir();
  const tmpDir = '/tmp/claude';

  const config: string[] = [
    // 基本的隔离设置
    '--unshare-all',        // 取消共享所有命名空间
    '--die-with-parent',    // 父进程退出时终止
  ];

  // 网络访问控制
  if (options.network !== false) {
    config.push('--share-net');
  }

  // 基础文件系统 - 只读绑定
  const readOnlyDirs = ['/usr', '/bin', '/lib', '/lib64', '/sbin'];
  for (const dir of readOnlyDirs) {
    if (fs.existsSync(dir)) {
      config.push('--ro-bind', dir, dir);
    }
  }

  // 符号链接
  config.push('--symlink', '/usr/lib', '/lib');
  config.push('--symlink', '/usr/lib64', '/lib64');
  config.push('--symlink', '/usr/bin', '/bin');
  config.push('--symlink', '/usr/sbin', '/sbin');

  // /etc 下的必要文件
  const etcFiles = [
    '/etc/resolv.conf',
    '/etc/hosts',
    '/etc/passwd',
    '/etc/group',
    '/etc/ssl',
    '/etc/ca-certificates',
    '/etc/nsswitch.conf',
    '/etc/protocols',
    '/etc/services',
    '/etc/localtime',
    '/etc/alternatives',
  ];

  for (const file of etcFiles) {
    if (fs.existsSync(file)) {
      try {
        config.push('--ro-bind', file, file);
      } catch {
        // 忽略无法绑定的文件
      }
    }
  }

  // /proc 访问
  if (options.allowProcAccess !== false) {
    config.push('--proc', '/proc');
  }

  // /dev 访问
  if (options.allowDevAccess !== false) {
    config.push('--dev', '/dev');
  } else {
    // 最小化 /dev 访问 - 只允许必要的设备
    config.push('--dev-bind', '/dev/null', '/dev/null');
    config.push('--dev-bind', '/dev/zero', '/dev/zero');
    config.push('--dev-bind', '/dev/random', '/dev/random');
    config.push('--dev-bind', '/dev/urandom', '/dev/urandom');
    if (fs.existsSync('/dev/tty')) {
      config.push('--dev-bind', '/dev/tty', '/dev/tty');
    }
  }

  // /sys 访问（默认不允许）
  if (options.allowSysAccess === true && fs.existsSync('/sys')) {
    config.push('--ro-bind', '/sys', '/sys');
  }

  // 创建沙箱专用临时目录
  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    config.push('--bind', tmpDir, '/tmp');
    // 设置 TMPDIR 环境变量
    config.push('--setenv', 'TMPDIR', '/tmp/claude');
  } catch {
    config.push('--tmpfs', '/tmp');
  }

  // 工作目录（可写）
  if (fs.existsSync(cwd)) {
    config.push('--bind', cwd, cwd);
    config.push('--chdir', cwd);
  }

  // 用户目录（默认只读）
  if (fs.existsSync(home)) {
    config.push('--ro-bind', home, home);
  }

  // Node.js 和 npm 相关
  if (fs.existsSync('/usr/local')) {
    config.push('--ro-bind', '/usr/local', '/usr/local');
  }

  // 默认可写路径
  for (const p of sandboxConfig.defaultWritablePaths) {
    if (fs.existsSync(p)) {
      config.push('--bind', p, p);
    }
  }

  // 默认只读路径
  for (const p of sandboxConfig.defaultReadOnlyPaths) {
    if (fs.existsSync(p)) {
      config.push('--ro-bind', p, p);
    }
  }

  return config;
}

// ============ Seatbelt 配置 (macOS) ============

/**
 * 生成 Seatbelt 配置文件内容
 */
function getSeatbeltProfile(cwd: string, options: SandboxOptions = {}): string {
  const home = os.homedir();

  let profile = `
(version 1)
(deny default)

;; Allow basic process operations
(allow process-fork)
(allow process-exec)
(allow signal (target self))

;; Allow read access to system libraries and executables
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/sbin"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Applications"))
(allow file-read* (subpath "/private/var"))
(allow file-read* (subpath "/var"))

;; Allow read/write access to working directory
(allow file-read* (subpath "${cwd}"))
(allow file-write* (subpath "${cwd}"))

;; Allow read access to home directory (for configs)
(allow file-read* (subpath "${home}"))

;; Allow read/write to temp directories
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))
(allow file-read* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/tmp"))

;; Allow access to /dev
(allow file-read* (subpath "/dev"))
(allow file-write* (literal "/dev/null"))
(allow file-write* (literal "/dev/tty"))
(allow file-read-data (literal "/dev/urandom"))
(allow file-read-data (literal "/dev/random"))

;; Allow mach operations
(allow mach-lookup)
(allow mach-bootstrap)

;; Allow IPC
(allow ipc-posix-shm)

;; Allow sysctl reads
(allow sysctl-read)
`;

  // 网络访问
  if (options.network !== false) {
    profile += `
;; Allow network access
(allow network*)
`;
  }

  // 额外的可写路径
  for (const p of (options.writablePaths || [])) {
    profile += `(allow file-read* (subpath "${p}"))\n`;
    profile += `(allow file-write* (subpath "${p}"))\n`;
  }

  // 额外的只读路径
  for (const p of (options.readOnlyPaths || [])) {
    profile += `(allow file-read* (subpath "${p}"))\n`;
  }

  // 默认路径
  for (const p of sandboxConfig.defaultWritablePaths) {
    profile += `(allow file-read* (subpath "${p}"))\n`;
    profile += `(allow file-write* (subpath "${p}"))\n`;
  }
  for (const p of sandboxConfig.defaultReadOnlyPaths) {
    profile += `(allow file-read* (subpath "${p}"))\n`;
  }

  return profile;
}

// ============ 执行函数 ============

/**
 * 使用 Bubblewrap 执行命令 (Linux)
 */
async function executeWithBubblewrap(
  command: string,
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const {
    cwd = getCurrentCwd(),
    env = {},
    timeout = 120000,
    writablePaths = [],
    readOnlyPaths = [],
    network = true,
    allowDevAccess = true,
    allowProcAccess = true,
    allowSysAccess = false,
    envWhitelist,
  } = options;

  // 构建 bwrap 参数
  const bwrapArgs = getBubblewrapConfig(cwd, {
    network,
    allowDevAccess,
    allowProcAccess,
    allowSysAccess,
  });

  // 添加额外的可写路径
  for (const p of writablePaths) {
    if (fs.existsSync(p)) {
      bwrapArgs.push('--bind', p, p);
    }
  }

  // 添加额外的只读路径
  for (const p of readOnlyPaths) {
    if (fs.existsSync(p)) {
      bwrapArgs.push('--ro-bind', p, p);
    }
  }

  // 准备环境变量
  let sandboxEnv: Record<string, string | undefined> = { ...process.env, ...env };

  // 如果指定了环境变量白名单，则过滤
  if (envWhitelist && envWhitelist.length > 0) {
    const filteredEnv: Record<string, string> = {};
    for (const key of envWhitelist) {
      if (sandboxEnv[key]) {
        filteredEnv[key] = sandboxEnv[key]!;
      }
    }
    // 保留一些必要的环境变量
    const essentialVars = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'SHELL'];
    for (const key of essentialVars) {
      if (sandboxEnv[key] && !filteredEnv[key]) {
        filteredEnv[key] = sandboxEnv[key]!;
      }
    }
    sandboxEnv = filteredEnv;
  }

  // 添加命令
  bwrapArgs.push('--', 'bash', '-c', command);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('bwrap', bwrapArgs, {
      env: sandboxEnv as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      killProcessSafely(proc, 'SIGKILL');
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        killed,
        sandboxed: true,
        sandboxType: 'bubblewrap',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        killed: false,
        error: err.message,
        sandboxed: false,
        sandboxType: 'bubblewrap',
      });
    });
  });
}

/**
 * 使用 Seatbelt 执行命令 (macOS)
 */
async function executeWithSeatbelt(
  command: string,
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const {
    cwd = getCurrentCwd(),
    env = {},
    timeout = 120000,
    writablePaths = [],
    readOnlyPaths = [],
    network = true,
  } = options;

  // 生成 Seatbelt 配置
  const profile = getSeatbeltProfile(cwd, { writablePaths, readOnlyPaths, network });

  // 创建临时配置文件
  // 使用 path.join 确保正确的路径分隔符，避免手动拼接字符串导致的转义序列问题
  const tmpDir = os.tmpdir();
  const profilePath = path.join(tmpDir, `claude-sandbox-${Date.now()}.sb`);

  try {
    fs.writeFileSync(profilePath, profile);
  } catch (err) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      killed: false,
      error: `Failed to create sandbox profile: ${err}`,
      sandboxed: false,
      sandboxType: 'seatbelt',
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('sandbox-exec', ['-f', profilePath, 'bash', '-c', command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      killProcessSafely(proc, 'SIGKILL');
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      // 清理临时配置文件
      try {
        fs.unlinkSync(profilePath);
      } catch {
        // 忽略清理错误
      }
      resolve({
        stdout,
        stderr,
        exitCode: code,
        killed,
        sandboxed: true,
        sandboxType: 'seatbelt',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      // 清理临时配置文件
      try {
        fs.unlinkSync(profilePath);
      } catch {
        // 忽略清理错误
      }
      resolve({
        stdout,
        stderr,
        exitCode: null,
        killed: false,
        error: err.message,
        sandboxed: false,
        sandboxType: 'seatbelt',
      });
    });
  });
}

/**
 * 直接执行命令（无沙箱）
 * 跨平台支持：Windows 使用 cmd/powershell，Unix 使用 bash
 */
async function executeDirectly(
  command: string,
  options: { cwd: string; env: Record<string, string>; timeout: number }
): Promise<SandboxResult> {
  const { cwd, env, timeout } = options;

  // 在 Windows 上，需要对路径进行特殊处理
  // 临时目录路径可能包含 \t 或 \n 这样的字符，会被 shell 误解为转义序列
  const safeEnv = { ...process.env, ...env };

  // 确保 TMPDIR 和 TEMP 路径在 Windows 上是安全的
  if (isWindows()) {
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

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // 在 Windows 上使用 shell: true 来处理命令
    // 这样可以让系统选择正确的 shell (cmd 或 powershell)
    const spawnOptions: any = {
      cwd: escapePathForShell(cwd),
      env: safeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    let proc;
    if (isWindows()) {
      // Windows: 使用 shell: true 让 Node.js 自动选择合适的 shell
      spawnOptions.shell = true;
      proc = spawn(command, [], spawnOptions);
    } else {
      // Unix: 使用 bash -c
      proc = spawn('bash', ['-c', command], spawnOptions);
    }

    const timeoutId = setTimeout(() => {
      killed = true;
      // 使用跨平台的进程终止方法
      // Windows: 使用 taskkill 终止进程树
      // Unix: 使用 SIGKILL 信号
      killProcessSafely(proc, 'SIGKILL');
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        killed,
        sandboxed: false,
        sandboxType: 'none',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        killed: false,
        error: err.message,
        sandboxed: false,
        sandboxType: 'none',
      });
    });
  });
}

// ============ 主执行函数 ============

/**
 * v2.1.34: 检查命令是否在排除列表中（对齐官方 L5z / isCommandExcluded）
 *
 * 支持三种匹配模式：
 * - 精确匹配: "npm test" 只匹配完全相同的命令
 * - 前缀匹配: "npm:*" 匹配以 "npm" 开头的命令
 * - 通配符匹配: "npm run test:*" 使用 * 通配符
 */
export function isCommandExcluded(command: string): boolean {
  const excludedCommands = sandboxConfig.excludedCommands ?? [];
  if (excludedCommands.length === 0) return false;

  const trimmed = command.trim();

  for (const pattern of excludedCommands) {
    // 尝试前缀匹配 "xxx:*"
    const prefixMatch = pattern.match(/^(.+):\*$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      if (trimmed === prefix || trimmed.startsWith(prefix + ' ')) {
        return true;
      }
      continue;
    }

    // 通配符匹配
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(trimmed)) {
        return true;
      }
      continue;
    }

    // 精确匹配
    if (trimmed === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * 根据权限模式判断是否应该使用沙箱
 *
 * v2.1.34 对齐官方 wc() 函数：
 * 1. 沙箱未启用 → 不用沙箱
 * 2. dangerouslyDisableSandbox + allowUnsandboxedCommands → 不用沙箱
 * 3. 命令为空 → 不用沙箱
 * 4. 命令在 excludedCommands 列表中 → 不用沙箱
 * 5. 其他 → 使用沙箱
 *
 * 关键修复: 不再无条件地因为 disableSandbox=true 就跳过沙箱，
 * 现在需要 allowUnsandboxedCommands 也为 true 才可以
 */
function shouldUseSandbox(
  command: string,
  options: SandboxOptions,
  permissionContext?: ToolPermissionContext
): boolean {
  // 1. 如果沙箱全局禁用
  if (!sandboxConfig.enabled) {
    return false;
  }

  // 2. v2.1.34: dangerouslyDisableSandbox 只有在 allowUnsandboxedCommands=true 时才生效
  // 修复: 之前 disableSandbox=true 就直接返回 false，现在需要额外检查 allowUnsandboxedCommands
  if (options.disableSandbox && (sandboxConfig.allowUnsandboxedCommands !== false)) {
    return false;
  }

  // 3. 没有命令 → 不用沙箱
  if (!command || !command.trim()) {
    return false;
  }

  // 4. v2.1.34: 命令在 excludedCommands 列表中 → 不用沙箱
  if (isCommandExcluded(command)) {
    return false;
  }

  // 5. 检查沙箱是否可用
  if (!isSandboxAvailable()) {
    return false;
  }

  // 默认使用沙箱
  return true;
}

/**
 * 使用沙箱执行命令 - 自动选择最佳沙箱，支持自动重试
 *
 * 与官方实现对齐的自动重试逻辑：
 * 1. 优先尝试在沙箱中执行
 * 2. 检测到沙箱错误时自动重试（禁用沙箱）
 * 3. 记录详细的执行日志
 */
export async function executeInSandbox(
  command: string,
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const {
    cwd = getCurrentCwd(),
    env = {},
    timeout = 120000,
    disableSandbox = false,
    permissionContext,
    command: optionsCommand, // 从 options 中获取 command（用于 MCP 检测）
  } = options;

  // 使用传入的 command 参数（优先级：options.command > 函数参数 command）
  const actualCommand = optionsCommand || command;

  // 判断是否使用沙箱
  const useSandbox = shouldUseSandbox(actualCommand, options, permissionContext);

  // 如果不使用沙箱，直接执行
  if (!useSandbox) {
    return executeDirectly(actualCommand, { cwd, env, timeout });
  }

  const sandboxType = getSandboxType();

  try {
    let result: SandboxResult;

    if (sandboxType === 'bubblewrap') {
      result = await executeWithBubblewrap(actualCommand, options);
    } else if (sandboxType === 'seatbelt') {
      result = await executeWithSeatbelt(actualCommand, options);
    } else {
      // 没有可用的沙箱
      if (sandboxConfig.fallbackOnError) {
        console.warn('[Sandbox] No sandbox available, falling back to direct execution');
        return executeDirectly(actualCommand, { cwd, env, timeout });
      } else {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          killed: false,
          error: 'No sandbox available and fallback is disabled',
          sandboxed: false,
          sandboxType: 'none',
        };
      }
    }

    // ===== 关键的自动重试逻辑（与官方对齐）=====

    // 检查是否是沙箱错误，如果是则自动重试
    if (result.error && isSandboxError(result.error)) {
      if (sandboxConfig.fallbackOnError) {
        console.warn(`[Sandbox] Detected sandbox error, retrying without sandbox`);
        console.warn(`[Sandbox] Error: ${result.error}`);

        // 自动重试，禁用沙箱
        return executeDirectly(actualCommand, { cwd, env, timeout });
      }
    }

    // 检查 stderr 中的沙箱错误
    // 注意：只有在命令失败时才重试（exitCode !== 0）
    if (result.stderr && isSandboxError(result.stderr)) {
      if (sandboxConfig.fallbackOnError && result.exitCode !== 0) {
        console.warn(`[Sandbox] Detected sandbox error in stderr, retrying without sandbox`);
        console.warn(`[Sandbox] Stderr: ${result.stderr.substring(0, 200)}...`);

        // 自动重试，禁用沙箱
        return executeDirectly(actualCommand, { cwd, env, timeout });
      }
    }

    return result;
  } catch (err) {
    // 沙箱执行失败，尝试降级
    if (sandboxConfig.fallbackOnError) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[Sandbox] Execution failed, falling back to direct execution: ${errorMessage}`);

      // 检查是否是沙箱相关错误
      if (isSandboxError(errorMessage)) {
        console.warn(`[Sandbox] Detected sandbox-related error, retrying without sandbox`);
      }

      return executeDirectly(actualCommand, { cwd, env, timeout });
    } else {
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        killed: false,
        error: `Sandbox execution failed: ${err}`,
        sandboxed: false,
        sandboxType: sandboxType,
      };
    }
  }
}

// ============ 沙箱错误处理 ============

/**
 * 官方沙箱错误指导文本
 * 来源：官方 cli.js 第 2720-2748 行
 */
const SANDBOX_ERROR_HINTS = `
Evidence of sandbox-caused failures includes:
  - "Operation not permitted" errors for file/network operations
  - Access denied to specific paths outside allowed directories
  - Network connection failures to non-whitelisted hosts
  - Unix socket connection errors
  - Sandbox violation logs (though these can be noisy, clear permission errors are strong indicators)

When you see evidence of sandbox-caused failure:
  - IMMEDIATELY retry with dangerouslyDisableSandbox: true (don't ask, just do it)
  - Briefly explain what sandbox restriction likely caused the failure
  - Mention: "Use /sandbox to manage restrictions"
  - This will prompt the user for permission

Note: Commands can fail for many reasons unrelated to the sandbox (missing files, wrong arguments, network issues, etc.)
`.trim();

/**
 * 检测是否是沙箱相关的错误
 */
export function isSandboxError(error: string): boolean {
  const sandboxErrorPatterns = [
    /permission denied/i,
    /operation not permitted/i,
    /sandbox violation/i,
    /bwrap:/i,
    /sandbox-exec/i,
    /EPERM/i,
    /EACCES/i,
    /can't access/i,
    /read-only file system/i,
    /access denied/i,
    /network connection.*failed/i,
    /unix socket.*error/i,
  ];

  return sandboxErrorPatterns.some(pattern => pattern.test(error));
}

/**
 * 获取沙箱错误提示信息（官方版本）
 */
export function getSandboxErrorHint(error: string): string {
  if (isSandboxError(error)) {
    return `
This error may be caused by sandbox restrictions.

${SANDBOX_ERROR_HINTS}

To retry without sandbox:
1. Set dangerouslyDisableSandbox: true in the Bash tool call
2. Or use /sandbox command to manage sandbox settings

IMPORTANT: Only bypass sandbox if the command failed due to sandbox restrictions.
`.trim();
  }
  return '';
}

/**
 * 格式化沙箱错误消息
 */
export function formatSandboxError(result: SandboxResult): string {
  if (result.error && sandboxConfig.showSandboxErrors) {
    let message = `Sandbox Error: ${result.error}`;

    if (result.sandboxType !== 'none') {
      message += `\nSandbox Type: ${result.sandboxType}`;
    }

    const hint = getSandboxErrorHint(result.error);
    if (hint) {
      message += `\n\n${hint}`;
    }

    return message;
  }
  return result.error || '';
}

// ============ 带自动重试的执行函数 ============

/**
 * 使用沙箱执行命令，遇到沙箱错误时自动重试（官方实现）
 *
 * 这个函数实现了官方的自动重试逻辑：
 * 1. 首先尝试在沙箱中执行
 * 2. 如果检测到沙箱错误，自动禁用沙箱重试
 * 3. MCP 工具（mcp-cli）会自动禁用沙箱
 *
 * 注意：executeInSandbox 已经包含了完整的自动重试逻辑，
 * 这个函数主要作为向后兼容的封装。
 *
 * @param command 要执行的命令
 * @param options 沙箱选项
 * @returns 执行结果
 */
export async function executeWithSandboxFallback(
  command: string,
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  // executeInSandbox 已经包含了完整的自动重试逻辑
  // 直接调用即可，不需要额外的错误处理
  return executeInSandbox(command, {
    ...options,
    command, // 传递命令用于 MCP 检测和特殊处理
  });
}

// ============================================================================
// v2.1.34: Sandbox 公共 API（对齐官方 x8 对象）
// ============================================================================

/**
 * 判断沙箱是否启用（对齐官方 X46()）
 */
export function isSandboxingEnabled(): boolean {
  return sandboxConfig.enabled && isSandboxAvailable();
}

/**
 * 判断 autoAllowBashIfSandboxed 是否启用（对齐官方 tM5()）
 * 默认为 true
 */
export function isAutoAllowBashIfSandboxedEnabled(): boolean {
  return sandboxConfig.autoAllowBashIfSandboxed !== false;
}

/**
 * 判断是否允许非沙箱命令（对齐官方 eM5()）
 * 默认为 true
 */
export function areUnsandboxedCommandsAllowed(): boolean {
  return sandboxConfig.allowUnsandboxedCommands !== false;
}

/**
 * v2.1.34: 判断一个命令是否会实际在沙箱中运行
 *
 * 这个函数被 bash 权限检查使用，用于确定：
 * - 当命令确实在沙箱中运行时，可以享受 autoAllowBashIfSandboxed 的自动允许
 * - 当命令因为 excludedCommands 或 dangerouslyDisableSandbox 绕过沙箱时，
 *   不能享受自动允许，必须经过正常的权限检查
 *
 * 这是 v2.1.34 的关键修复：
 * 之前 excludedCommands 中的命令和 dangerouslyDisableSandbox=true 的命令
 * 在 autoAllowBashIfSandboxed 启用时也被自动允许了，这是一个安全漏洞
 */
export function willCommandRunInSandbox(
  command: string,
  dangerouslyDisableSandbox?: boolean,
): boolean {
  // 沙箱未启用
  if (!sandboxConfig.enabled) return false;

  // 沙箱不可用
  if (!isSandboxAvailable()) return false;

  // dangerouslyDisableSandbox 且允许非沙箱命令
  if (dangerouslyDisableSandbox && sandboxConfig.allowUnsandboxedCommands !== false) {
    return false;
  }

  // 命令在排除列表中
  if (isCommandExcluded(command)) {
    return false;
  }

  return true;
}
