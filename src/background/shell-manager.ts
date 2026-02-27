/**
 * 后台 Shell 管理器
 * 管理后台执行的 Shell 进程，包括状态追踪、输出收集和资源管理
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import { isWindows, escapePathForShell } from '../utils/platform.js';

export type ShellStatus = 'running' | 'completed' | 'failed' | 'paused' | 'terminated';

export interface BackgroundShell {
  id: string;
  command: string;
  cwd: string;
  process: ChildProcess;
  status: ShellStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string[];
  outputSize: number;
  maxRuntime?: number;
  timeout?: NodeJS.Timeout;
  metadata?: Record<string, any>;
}

export interface ShellManagerOptions {
  maxShells?: number;
  maxOutputSize?: number;
  defaultMaxRuntime?: number;
  onShellComplete?: (shell: BackgroundShell) => void;
  onShellFailed?: (shell: BackgroundShell) => void;
}

/**
 * 后台 Shell 管理器
 * 负责创建、追踪和管理后台运行的 shell 进程
 */
export class ShellManager extends EventEmitter {
  private shells = new Map<string, BackgroundShell>();
  private readonly maxShells: number;
  private readonly maxOutputSize: number;
  private readonly defaultMaxRuntime: number;
  private readonly options: ShellManagerOptions;

  constructor(options: ShellManagerOptions = {}) {
    super();
    this.maxShells = options.maxShells || 10;
    this.maxOutputSize = options.maxOutputSize || 10 * 1024 * 1024; // 10MB
    this.defaultMaxRuntime = options.defaultMaxRuntime || 3600000; // 1 hour
    this.options = options;
  }

  /**
   * 创建并启动一个后台 shell
   */
  createShell(
    command: string,
    options: {
      id?: string;
      cwd?: string;
      maxRuntime?: number;
      metadata?: Record<string, any>;
    } = {}
  ): { success: boolean; id?: string; error?: string } {
    // 检查 shell 数量限制
    if (this.shells.size >= this.maxShells) {
      // 尝试清理已完成的 shell
      const cleaned = this.cleanupCompleted();
      if (cleaned === 0 && this.shells.size >= this.maxShells) {
        return {
          success: false,
          error: `Maximum number of background shells (${this.maxShells}) reached`,
        };
      }
    }

    const id = options.id || this.generateShellId();
    const cwd = options.cwd || process.cwd();
    const maxRuntime = options.maxRuntime || this.defaultMaxRuntime;

    // 准备安全的环境变量，处理 Windows 临时目录路径转义问题
    const safeEnv = { ...process.env };
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

    // 确保工作目录路径在 Windows 上是安全的
    const safeCwd = isWindows() ? escapePathForShell(cwd) : cwd;

    // 创建进程（跨平台支持）
    let proc: ChildProcess;
    if (isWindows()) {
      // Windows: 使用 shell: true 让 Node.js 自动选择合适的 shell
      proc = spawn(command, [], {
        cwd: safeCwd,
        env: safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      });
    } else {
      // Unix: 使用 bash -c
      proc = spawn('bash', ['-c', command], {
        cwd,
        env: safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // 创建 shell 状态
    const shell: BackgroundShell = {
      id,
      command,
      cwd,
      process: proc,
      status: 'running',
      startTime: Date.now(),
      output: [],
      outputSize: 0,
      maxRuntime,
      metadata: options.metadata,
    };

    // 设置超时
    if (maxRuntime > 0) {
      const timeout = setTimeout(() => {
        this.terminateShell(id, 'timeout');
      }, maxRuntime);
      shell.timeout = timeout;
    }

    // 监听输出
    this.attachOutputListeners(shell);

    // 监听进程事件
    this.attachProcessListeners(shell);

    // 保存到管理器
    this.shells.set(id, shell);

    // 触发事件
    this.emit('shell:started', shell);

    return { success: true, id };
  }

  /**
   * 附加输出监听器 (v2.1.14 修复：添加引用追踪)
   */
  private attachOutputListeners(shell: BackgroundShell): void {
    if (!shell.process.stdout || !shell.process.stderr) {
      return;
    }

    // Stdout 监听器
    const stdoutHandler = (data: Buffer) => {
      const dataStr = data.toString();
      shell.outputSize += dataStr.length;

      // 检查输出大小限制
      if (shell.outputSize < this.maxOutputSize) {
        shell.output.push(dataStr);
      } else if (
        shell.output[shell.output.length - 1] !== '[Output limit reached - further output discarded]'
      ) {
        shell.output.push('[Output limit reached - further output discarded]');
      }

      this.emit('shell:output', { id: shell.id, data: dataStr, type: 'stdout' });
    };

    // Stderr 监听器
    const stderrHandler = (data: Buffer) => {
      const dataStr = `STDERR: ${data.toString()}`;
      shell.outputSize += dataStr.length;

      if (shell.outputSize < this.maxOutputSize) {
        shell.output.push(dataStr);
      } else if (
        shell.output[shell.output.length - 1] !== '[Output limit reached - further output discarded]'
      ) {
        shell.output.push('[Output limit reached - further output discarded]');
      }

      this.emit('shell:output', { id: shell.id, data: dataStr, type: 'stderr' });
    };

    shell.process.stdout.on('data', stdoutHandler);
    shell.process.stderr.on('data', stderrHandler);

    // v2.1.14: 保存监听器引用以便后续清理
    (shell as any).__stdoutHandler = stdoutHandler;
    (shell as any).__stderrHandler = stderrHandler;
  }

  /**
   * 附加进程事件监听器
   */
  private attachProcessListeners(shell: BackgroundShell): void {
    shell.process.on('close', (code) => {
      shell.endTime = Date.now();
      shell.exitCode = code ?? undefined;
      shell.status = code === 0 ? 'completed' : 'failed';

      // 清理超时定时器
      if (shell.timeout) {
        clearTimeout(shell.timeout);
        shell.timeout = undefined;
      }

      // 触发回调
      if (code === 0 && this.options.onShellComplete) {
        this.options.onShellComplete(shell);
      } else if (code !== 0 && this.options.onShellFailed) {
        this.options.onShellFailed(shell);
      }

      // 触发事件
      this.emit(code === 0 ? 'shell:completed' : 'shell:failed', shell);
    });

    shell.process.on('error', (err) => {
      shell.endTime = Date.now();
      shell.status = 'failed';
      shell.output.push(`ERROR: ${err.message}`);

      // 清理超时定时器
      if (shell.timeout) {
        clearTimeout(shell.timeout);
        shell.timeout = undefined;
      }

      // 触发回调
      if (this.options.onShellFailed) {
        this.options.onShellFailed(shell);
      }

      // 触发事件
      this.emit('shell:error', { id: shell.id, error: err });
    });
  }

  /**
   * 获取 shell 状态
   */
  getShell(id: string): BackgroundShell | undefined {
    return this.shells.get(id);
  }

  /**
   * 清理shell的所有流资源 (v2.1.14 内存泄漏修复)
   * 修复官方报告的shell命令流资源未清理导致的内存泄漏
   */
  private cleanupShellStreams(shell: BackgroundShell): void {
    try {
      // 1. 移除stdout监听器
      if (shell.process.stdout) {
        shell.process.stdout.removeAllListeners();
        // 如果流还打开，销毁它
        if (!shell.process.stdout.destroyed) {
          shell.process.stdout.destroy();
        }
      }

      // 2. 移除stderr监听器  
      if (shell.process.stderr) {
        shell.process.stderr.removeAllListeners();
        if (!shell.process.stderr.destroyed) {
          shell.process.stderr.destroy();
        }
      }

      // 3. 移除进程监听器
      shell.process.removeAllListeners();

      // 4. 清理引用
      delete (shell as any).__stdoutHandler;
      delete (shell as any).__stderrHandler;
    } catch (err) {
      // 忽略清理错误，只记录日志
      console.warn(`Failed to cleanup stream for shell ${shell.id}:`, err);
    }
  }

  /**
   * 获取 shell 输出（并清空已读输出）
   */
  getOutput(id: string, options: { clear?: boolean; filter?: RegExp } = {}): string | null {
    const shell = this.shells.get(id);
    if (!shell) return null;

    let output = shell.output.join('');

    // 应用过滤器
    if (options.filter) {
      output = output
        .split('\n')
        .filter((line) => options.filter!.test(line))
        .join('\n');
    }

    // 清空输出
    if (options.clear !== false) {
      shell.output = [];
    }

    return output;
  }

  /**
   * 终止 shell (v2.1.14 修复：添加流清理)
   */
  terminateShell(id: string, reason: 'manual' | 'timeout' | 'error' = 'manual'): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;

    try {
      // 先发送 SIGTERM
      shell.process.kill('SIGTERM');

      // 等待 1 秒，如果还在运行则强制 SIGKILL
      setTimeout(() => {
        if (shell.status === 'running') {
          shell.process.kill('SIGKILL');
        }
      }, 1000);

      shell.status = 'terminated';

      // 清理超时定时器
      if (shell.timeout) {
        clearTimeout(shell.timeout);
        shell.timeout = undefined;
      }

      // v2.1.14: 清理所有流资源
      this.cleanupShellStreams(shell);

      this.emit('shell:terminated', { id, reason });

      return true;
    } catch (err) {
      console.error(`Failed to terminate shell ${id}:`, err);
      return false;
    }
  }

  /**
   * 暂停 shell（发送 SIGSTOP）
   */
  pauseShell(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell || shell.status !== 'running') return false;

    try {
      shell.process.kill('SIGSTOP');
      shell.status = 'paused';
      this.emit('shell:paused', shell);
      return true;
    } catch (err) {
      console.error(`Failed to pause shell ${id}:`, err);
      return false;
    }
  }

  /**
   * 恢复 shell（发送 SIGCONT）
   */
  resumeShell(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell || shell.status !== 'paused') return false;

    try {
      shell.process.kill('SIGCONT');
      shell.status = 'running';
      this.emit('shell:resumed', shell);
      return true;
    } catch (err) {
      console.error(`Failed to resume shell ${id}:`, err);
      return false;
    }
  }

  /**
   * 列出所有 shell
   */
  listShells(): Array<{
    id: string;
    command: string;
    status: ShellStatus;
    duration: number;
    outputSize: number;
  }> {
    return Array.from(this.shells.values()).map((shell) => ({
      id: shell.id,
      command: shell.command.substring(0, 100) + (shell.command.length > 100 ? '...' : ''),
      status: shell.status,
      duration: shell.endTime ? shell.endTime - shell.startTime : Date.now() - shell.startTime,
      outputSize: shell.outputSize,
    }));
  }

  /**
   * 清理已完成的 shell (v2.1.14 修复：添加流清理)
   */
  cleanupCompleted(): number {
    let cleaned = 0;

    Array.from(this.shells.entries()).forEach(([id, shell]) => {
      if (shell.status === 'completed' || shell.status === 'failed' || shell.status === 'terminated') {
        // 清理超时定时器
        if (shell.timeout) {
          clearTimeout(shell.timeout);
        }

        // v2.1.14: 清理所有流资源
        this.cleanupShellStreams(shell);

        this.shells.delete(id);
        cleaned++;
      }
    });

    return cleaned;
  }

  /**
   * 清理超时的 shell
   */
  cleanupTimedOut(): number {
    let cleaned = 0;
    const now = Date.now();

    Array.from(this.shells.entries()).forEach(([id, shell]) => {
      if (shell.maxRuntime && now - shell.startTime > shell.maxRuntime && shell.status === 'running') {
        this.terminateShell(id, 'timeout');
        this.shells.delete(id);
        cleaned++;
      }
    });

    return cleaned;
  }

  /**
   * 终止所有 shell (v2.1.14 修复：添加流清理)
   */
  terminateAll(): number {
    let terminated = 0;

    Array.from(this.shells.values()).forEach((shell) => {
      if (this.terminateShell(shell.id)) {
        // terminateShell已经包含流清理
        terminated++;
      }
    });

    this.shells.clear();
    return terminated;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const statuses = {
      running: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      terminated: 0,
    };

    Array.from(this.shells.values()).forEach((shell) => {
      statuses[shell.status]++;
    });

    return {
      total: this.shells.size,
      ...statuses,
      maxShells: this.maxShells,
      available: this.maxShells - statuses.running - statuses.paused,
    };
  }

  /**
   * 生成唯一的 shell ID
   */
  private generateShellId(): string {
    return `bash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
