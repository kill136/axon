/**
 * Unified Sandbox Executor
 * Automatically selects the appropriate sandbox based on platform and configuration
 */

import * as os from 'os';
import * as child_process from 'child_process';
import { SandboxConfig } from './config.js';
import { execInSandbox, SandboxResult as BwrapResult } from './bubblewrap.js';
import { execInSeatbelt, SeatbeltResult } from './seatbelt.js';
import { execInDocker, DockerResult } from './docker.js';
import { ResourceLimiter, ResourceLimits, buildUlimitArgs } from './resource-limits.js';
import { isWindows, escapePathForShell } from '../utils/platform.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxed: boolean;
  sandboxType: 'bubblewrap' | 'seatbelt' | 'docker' | 'none';
  duration?: number;
}

export interface ExecutorOptions {
  config: SandboxConfig;
  command: string;
  args?: string[];
  timeout?: number;
}

// ============================================================================
// Unified Executor
// ============================================================================

/**
 * Execute command with automatic sandbox selection
 */
export async function executeInSandbox(
  command: string,
  args: string[] = [],
  config: SandboxConfig
): Promise<ExecutorResult> {
  const platform = os.platform();

  // Disabled sandbox
  if (!config.enabled || config.type === 'none') {
    return executeUnsandboxed(command, args, config);
  }

  // Docker mode (cross-platform)
  if (config.type === 'docker') {
    const result = await execInDocker(command, args, {
      image: config.docker?.image,
      volumes: config.docker?.volumes,
      network: config.docker?.network,
      memory: config.resourceLimits?.maxMemory
        ? `${Math.floor(config.resourceLimits.maxMemory / 1024 / 1024)}m`
        : undefined,
      cpus: config.resourceLimits?.maxCpu
        ? `${config.resourceLimits.maxCpu / 100}`
        : undefined,
      timeout: config.resourceLimits?.maxExecutionTime,
      env: config.environmentVariables,
    });

    return {
      ...result,
      sandboxType: 'docker',
    };
  }

  // Platform-specific sandboxes
  if (platform === 'linux' && config.type === 'bubblewrap') {
    const result = await execInSandbox(command, args, {
      config: {
        enabled: true,
        allowNetwork: config.networkAccess,
        allowRead: config.readOnlyPaths,
        allowWrite: config.writablePaths,
      },
      timeout: config.resourceLimits?.maxExecutionTime,
      env: config.environmentVariables,
    });

    return {
      ...result,
      sandboxType: 'bubblewrap',
    };
  }

  if (platform === 'darwin') {
    const result = await execInSeatbelt(command, args, {
      allowNetwork: config.networkAccess,
      allowRead: config.readOnlyPaths,
      allowWrite: config.writablePaths,
      timeout: config.resourceLimits?.maxExecutionTime,
      env: config.environmentVariables,
    });

    return {
      ...result,
      sandboxType: 'seatbelt',
    };
  }

  // Fallback to unsandboxed
  console.warn(`No sandbox available for platform: ${platform}, executing unsandboxed`);
  return executeUnsandboxed(command, args, config);
}

/**
 * 准备安全的环境变量（处理 Windows 临时目录路径转义问题）
 */
function prepareSafeEnv(env?: Record<string, string>): NodeJS.ProcessEnv {
  const safeEnv = { ...(env || process.env) };

  // 在 Windows 上，临时目录路径可能包含 \t 或 \n 这样的字符
  // 这些会被 shell 误解为转义序列，需要进行处理
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

  return safeEnv as NodeJS.ProcessEnv;
}

/**
 * Execute without sandbox
 */
async function executeUnsandboxed(
  command: string,
  args: string[],
  config: SandboxConfig
): Promise<ExecutorResult> {
  const startTime = Date.now();

  // Apply resource limits if specified
  if (config.resourceLimits) {
    const ulimitArgs = buildUlimitArgs(config.resourceLimits);
    if (ulimitArgs.length > 0) {
      return executeWithUlimit(command, args, config);
    }
  }

  // 准备安全的环境变量
  const safeEnv = prepareSafeEnv(config.environmentVariables);

  return new Promise((resolve) => {
    const proc = child_process.spawn(command, args, {
      env: safeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: config.resourceLimits?.maxExecutionTime,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        sandboxed: false,
        sandboxType: 'none',
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        sandboxed: false,
        sandboxType: 'none',
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Execute with ulimit resource limits
 */
async function executeWithUlimit(
  command: string,
  args: string[],
  config: SandboxConfig
): Promise<ExecutorResult> {
  const startTime = Date.now();
  const ulimitArgs = buildUlimitArgs(config.resourceLimits!);

  const fullCommand = `ulimit ${ulimitArgs.join(' ')} && ${command} ${args.join(' ')}`;

  // 准备安全的环境变量
  const safeEnv = prepareSafeEnv(config.environmentVariables);

  return new Promise((resolve) => {
    // ulimit 是 Unix 专属命令，在 Windows 上不可用
    // 如果在 Windows 上调用此函数，应该直接使用 shell: true
    let proc;
    if (isWindows()) {
      // Windows 上不支持 ulimit，直接执行命令
      proc = child_process.spawn(`${command} ${args.join(' ')}`, [], {
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: config.resourceLimits?.maxExecutionTime,
        shell: true,
        windowsHide: true,
      });
    } else {
      proc = child_process.spawn('sh', ['-c', fullCommand], {
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: config.resourceLimits?.maxExecutionTime,
      });
    }

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        sandboxed: false,
        sandboxType: 'none',
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        sandboxed: false,
        sandboxType: 'none',
        duration: Date.now() - startTime,
      });
    });
  });
}

// ============================================================================
// Executor Class
// ============================================================================

export class SandboxExecutor {
  private config: SandboxConfig;
  private resourceLimiter?: ResourceLimiter;

  constructor(config: SandboxConfig) {
    this.config = config;

    if (config.resourceLimits) {
      this.resourceLimiter = new ResourceLimiter(config.resourceLimits);
    }
  }

  /**
   * Execute command in sandbox
   */
  async execute(command: string, args: string[] = []): Promise<ExecutorResult> {
    return executeInSandbox(command, args, this.config);
  }

  /**
   * Execute multiple commands in sequence
   */
  async executeSequence(commands: Array<{ command: string; args?: string[] }>): Promise<ExecutorResult[]> {
    const results: ExecutorResult[] = [];

    for (const { command, args = [] } of commands) {
      const result = await this.execute(command, args);
      results.push(result);

      // Stop on first error
      if (result.exitCode !== 0) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple commands in parallel
   */
  async executeParallel(commands: Array<{ command: string; args?: string[] }>): Promise<ExecutorResult[]> {
    const promises = commands.map(({ command, args = [] }) =>
      this.execute(command, args)
    );

    return Promise.all(promises);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.resourceLimits) {
      this.resourceLimiter = new ResourceLimiter(config.resourceLimits);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detect best sandbox for current platform
 */
export function detectBestSandbox(): 'bubblewrap' | 'seatbelt' | 'docker' | 'none' {
  const platform = os.platform();

  if (platform === 'linux') {
    try {
      child_process.execSync('which bwrap', { stdio: 'ignore' });
      return 'bubblewrap';
    } catch {
      // Fall through
    }
  }

  if (platform === 'darwin') {
    try {
      child_process.execSync('which sandbox-exec', { stdio: 'ignore' });
      return 'seatbelt';
    } catch {
      // Fall through
    }
  }

  // Check for Docker
  try {
    child_process.execSync('docker version', { stdio: 'ignore' });
    return 'docker';
  } catch {
    // Fall through
  }

  return 'none';
}

/**
 * Get sandbox capabilities
 */
export function getSandboxCapabilities(): {
  bubblewrap: boolean;
  seatbelt: boolean;
  docker: boolean;
  resourceLimits: boolean;
} {
  const platform = os.platform();
  let bubblewrap = false;
  let seatbelt = false;
  let docker = false;

  if (platform === 'linux') {
    try {
      child_process.execSync('which bwrap', { stdio: 'ignore' });
      bubblewrap = true;
    } catch {
      // Ignore
    }
  }

  if (platform === 'darwin') {
    try {
      child_process.execSync('which sandbox-exec', { stdio: 'ignore' });
      seatbelt = true;
    } catch {
      // Ignore
    }
  }

  try {
    child_process.execSync('docker version', { stdio: 'ignore' });
    docker = true;
  } catch {
    // Ignore
  }

  return {
    bubblewrap,
    seatbelt,
    docker,
    resourceLimits: platform === 'linux' || platform === 'darwin',
  };
}
