/**
 * MCP 服务器生命周期管理
 * 负责 MCP 服务器的启动、停止、监控和重启
 */

import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import type { McpServerConfig } from '../types/index.js';

// ============ 类型定义 ============

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crashed';

export interface ServerProcess {
  name: string;
  pid?: number;
  state: ServerState;
  startedAt?: Date;
  stoppedAt?: Date;
  restartCount: number;
  lastError?: Error;
  consecutiveFailures: number;
}

export interface LifecycleOptions {
  startupTimeout?: number;        // 启动超时（毫秒）
  shutdownTimeout?: number;       // 停止超时（毫秒）
  maxRestarts?: number;           // 最大重启次数
  restartDelay?: number;          // 重启延迟基数（毫秒）
  healthCheckInterval?: number;   // 健康检查间隔（毫秒）
  maxConsecutiveFailures?: number; // 最大连续失败次数
}

export interface HealthCheckResult {
  healthy: boolean;
  latency?: number;
  lastCheck: Date;
  error?: string;
  details?: Record<string, unknown>;
}

export interface StartOptions {
  force?: boolean;                // 强制启动（即使已在运行）
  waitForReady?: boolean;         // 等待服务就绪
  dependencies?: string[];        // 依赖的服务器
}

export interface StopOptions {
  force?: boolean;                // 强制停止
  killSignal?: NodeJS.Signals;    // 停止信号
  reason?: string;                // 停止原因
}

// ============ 默认配置 ============

const DEFAULT_OPTIONS: Required<LifecycleOptions> = {
  startupTimeout: 30000,          // 30秒
  shutdownTimeout: 10000,         // 10秒
  maxRestarts: 3,
  restartDelay: 1000,             // 1秒
  healthCheckInterval: 30000,     // 30秒
  maxConsecutiveFailures: 5,
};

// ============ 生命周期管理器 ============

export class McpLifecycleManager extends EventEmitter {
  private options: Required<LifecycleOptions>;
  private processes: Map<string, ServerProcess>;
  private configs: Map<string, McpServerConfig>;
  private childProcesses: Map<string, ChildProcess>;
  private healthCheckTimers: Map<string, NodeJS.Timeout>;
  private startupTimers: Map<string, NodeJS.Timeout>;
  private shutdownTimers: Map<string, NodeJS.Timeout>;
  private dependencies: Map<string, Set<string>>;

  constructor(options?: LifecycleOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.processes = new Map();
    this.configs = new Map();
    this.childProcesses = new Map();
    this.healthCheckTimers = new Map();
    this.startupTimers = new Map();
    this.shutdownTimers = new Map();
    this.dependencies = new Map();
  }

  // ============ 配置管理 ============

  /**
   * 注册服务器配置
   */
  registerServer(name: string, config: McpServerConfig): void {
    this.configs.set(name, config);

    if (!this.processes.has(name)) {
      this.processes.set(name, {
        name,
        state: 'stopped',
        restartCount: 0,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * 注销服务器
   */
  async unregisterServer(name: string): Promise<void> {
    // 先停止服务器
    if (this.isRunning(name)) {
      await this.stop(name, { force: true });
    }

    this.configs.delete(name);
    this.processes.delete(name);
    this.dependencies.delete(name);
  }

  /**
   * 设置服务器依赖关系
   */
  setDependencies(name: string, dependencies: string[]): void {
    this.dependencies.set(name, new Set(dependencies));
  }

  // ============ 启动管理 ============

  /**
   * 启动服务器
   */
  async start(serverName: string, options?: StartOptions): Promise<void> {
    const process = this.processes.get(serverName);
    const config = this.configs.get(serverName);

    if (!process || !config) {
      throw new Error(`Server not found: ${serverName}`);
    }

    // 检查是否已在运行
    if (process.state === 'running' && !options?.force) {
      return;
    }

    // 检查是否正在启动
    if (process.state === 'starting') {
      if (options?.waitForReady) {
        await this.waitForState(serverName, 'running');
      }
      return;
    }

    // 启动依赖服务
    if (options?.dependencies) {
      await this.startDependencies(serverName, options.dependencies);
    }

    // 更新状态
    this.updateState(serverName, 'starting');
    this.emit('server:starting', { serverName, process });

    try {
      await this.doStart(serverName, config, process);
    } catch (error) {
      this.handleStartupFailure(serverName, process, error as Error);
      throw error;
    }
  }

  /**
   * 启动所有服务器
   */
  async startAll(): Promise<void> {
    const servers = Array.from(this.configs.keys());
    const errors: Array<{ server: string; error: Error }> = [];

    for (const serverName of servers) {
      try {
        await this.start(serverName);
      } catch (error) {
        errors.push({ server: serverName, error: error as Error });
      }
    }

    if (errors.length > 0) {
      const errorMsg = errors.map(e => `${e.server}: ${e.error.message}`).join(', ');
      throw new Error(`Failed to start some servers: ${errorMsg}`);
    }
  }

  /**
   * 按依赖关系启动服务器
   */
  async startWithDependencies(serverName: string): Promise<void> {
    const dependencies = this.dependencies.get(serverName);

    if (dependencies && dependencies.size > 0) {
      // 递归启动依赖
      const depsArray = Array.from(dependencies);
      for (const dep of depsArray) {
        if (!this.isRunning(dep)) {
          await this.startWithDependencies(dep);
        }
      }
    }

    await this.start(serverName, { dependencies: dependencies ? Array.from(dependencies) : [] });
  }

  /**
   * 实际启动逻辑
   */
  private async doStart(
    serverName: string,
    config: McpServerConfig,
    process: ServerProcess
  ): Promise<void> {
    if (config.type !== 'stdio' || !config.command) {
      throw new Error(`Unsupported server type or missing command: ${config.type}`);
    }

    // 创建进程
    const childProcess = spawn(config.command, config.args || [], {
      env: { ...(globalThis.process?.env || {}), ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.childProcesses.set(serverName, childProcess);
    process.pid = childProcess.pid;
    process.startedAt = new Date();

    // 设置启动超时
    const timeoutId = setTimeout(() => {
      this.handleStartupTimeout(serverName, process);
    }, this.options.startupTimeout);
    this.startupTimers.set(serverName, timeoutId);

    // 监听进程事件
    this.attachProcessListeners(serverName, childProcess, process);

    // 等待进程就绪（简单实现：等待一小段时间）
    await this.waitForReady(serverName, childProcess);

    // 清除启动超时
    clearTimeout(timeoutId);
    this.startupTimers.delete(serverName);

    // 更新状态
    this.updateState(serverName, 'running');
    process.consecutiveFailures = 0;
    this.emit('server:started', { serverName, process, pid: process.pid });

    // 开始健康检查
    this.scheduleHealthCheck(serverName);
  }

  /**
   * 等待服务器就绪
   */
  private async waitForReady(serverName: string, childProcess: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      // 简单的就绪检测：等待进程稳定运行一小段时间
      const readyTimeout = setTimeout(() => {
        if (!resolved && !childProcess.killed) {
          resolved = true;
          resolve();
        }
      }, 1000);

      childProcess.once('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          reject(error);
        }
      });

      childProcess.once('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          reject(new Error(`Process exited with code ${code} during startup`));
        }
      });
    });
  }

  /**
   * 附加进程监听器
   */
  private attachProcessListeners(
    serverName: string,
    childProcess: ChildProcess,
    process: ServerProcess
  ): void {
    childProcess.on('error', (error) => {
      this.handleProcessError(serverName, process, error);
    });

    childProcess.on('exit', (code, signal) => {
      this.handleProcessExit(serverName, process, code, signal);
    });

    // 监听标准输出和错误输出
    childProcess.stdout?.on('data', (data) => {
      this.emit('server:stdout', { serverName, data: data.toString() });
    });

    childProcess.stderr?.on('data', (data) => {
      this.emit('server:stderr', { serverName, data: data.toString() });
    });
  }

  /**
   * 启动依赖服务
   */
  private async startDependencies(_serverName: string, dependencies: string[]): Promise<void> {
    for (const dep of dependencies) {
      if (!this.isRunning(dep)) {
        await this.start(dep, { waitForReady: true });
      }
    }
  }

  // ============ 停止管理 ============

  /**
   * 停止服务器
   */
  async stop(serverName: string, options?: StopOptions): Promise<void> {
    const process = this.processes.get(serverName);
    const childProcess = this.childProcesses.get(serverName);

    if (!process) {
      throw new Error(`Server not found: ${serverName}`);
    }

    if (process.state === 'stopped') {
      return;
    }

    // 停止健康检查
    this.cancelHealthCheck(serverName);

    // 更新状态
    this.updateState(serverName, 'stopping');
    this.emit('server:stopping', { serverName, process, reason: options?.reason });

    try {
      if (childProcess && !childProcess.killed) {
        await this.doStop(serverName, childProcess, options);
      }

      this.updateState(serverName, 'stopped');
      process.stoppedAt = new Date();
      process.pid = undefined;
      this.emit('server:stopped', { serverName, process });
    } catch (error) {
      this.updateState(serverName, 'error');
      process.lastError = error as Error;
      this.emit('server:error', { serverName, process, error });
      throw error;
    } finally {
      this.childProcesses.delete(serverName);
    }
  }

  /**
   * 停止所有服务器
   */
  async stopAll(force?: boolean): Promise<void> {
    const servers = Array.from(this.processes.entries())
      .filter(([, proc]) => proc.state === 'running' || proc.state === 'starting')
      .map(([name]) => name);

    const errors: Array<{ server: string; error: Error }> = [];

    for (const serverName of servers) {
      try {
        await this.stop(serverName, { force });
      } catch (error) {
        errors.push({ server: serverName, error: error as Error });
      }
    }

    if (errors.length > 0 && !force) {
      const errorMsg = errors.map(e => `${e.server}: ${e.error.message}`).join(', ');
      throw new Error(`Failed to stop some servers: ${errorMsg}`);
    }
  }

  /**
   * 实际停止逻辑
   */
  private async doStop(
    serverName: string,
    childProcess: ChildProcess,
    options?: StopOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = options?.killSignal || 'SIGTERM';
      let killed = false;

      // 设置停止超时
      const timeoutId = setTimeout(() => {
        if (!killed && !childProcess.killed) {
          // 超时后强制杀死进程
          childProcess.kill('SIGKILL');
          killed = true;
        }
      }, this.options.shutdownTimeout);

      this.shutdownTimers.set(serverName, timeoutId);

      childProcess.once('exit', () => {
        clearTimeout(timeoutId);
        this.shutdownTimers.delete(serverName);
        resolve();
      });

      // 发送停止信号
      try {
        if (options?.force) {
          childProcess.kill('SIGKILL');
        } else {
          childProcess.kill(signal);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        this.shutdownTimers.delete(serverName);
        reject(error);
      }
    });
  }

  // ============ 重启管理 ============

  /**
   * 重启服务器
   */
  async restart(serverName: string): Promise<void> {
    const process = this.processes.get(serverName);

    if (!process) {
      throw new Error(`Server not found: ${serverName}`);
    }

    this.emit('server:restarting', { serverName, process });

    // 停止服务器
    if (this.isRunning(serverName) || process.state === 'starting') {
      await this.stop(serverName);
    }

    // 增加重启计数
    process.restartCount++;

    // 计算退避延迟
    const delay = this.calculateBackoffDelay(process.restartCount);

    if (delay > 0) {
      await this.sleep(delay);
    }

    // 启动服务器
    await this.start(serverName);
  }

  /**
   * 重启所有服务器
   */
  async restartAll(): Promise<void> {
    const servers = Array.from(this.configs.keys());

    for (const serverName of servers) {
      try {
        await this.restart(serverName);
      } catch (error) {
        this.emit('server:error', {
          serverName,
          process: this.processes.get(serverName),
          error
        });
      }
    }
  }

  /**
   * 自动重启（内部使用）
   */
  private async autoRestart(serverName: string, process: ServerProcess): Promise<void> {
    // 检查是否应该重启
    if (!this.shouldAutoRestart(process)) {
      this.updateState(serverName, 'stopped');
      this.emit('server:crashed', { serverName, process, reason: 'max_restarts_exceeded' });
      return;
    }

    try {
      await this.restart(serverName);
    } catch (error) {
      process.lastError = error as Error;
      process.consecutiveFailures++;
      this.emit('server:error', { serverName, process, error });
    }
  }

  /**
   * 计算退避延迟
   */
  private calculateBackoffDelay(restartCount: number): number {
    // 指数退避：delay * 2^(n-1)
    const maxDelay = 60000; // 最大 60 秒
    const delay = this.options.restartDelay * Math.pow(2, Math.min(restartCount - 1, 6));
    return Math.min(delay, maxDelay);
  }

  /**
   * 判断是否应该自动重启
   */
  private shouldAutoRestart(process: ServerProcess): boolean {
    return (
      process.restartCount < this.options.maxRestarts &&
      process.consecutiveFailures < this.options.maxConsecutiveFailures
    );
  }

  // ============ 健康检查 ============

  /**
   * 执行健康检查
   */
  async healthCheck(serverName: string): Promise<HealthCheckResult> {
    const process = this.processes.get(serverName);
    const childProcess = this.childProcesses.get(serverName);

    const result: HealthCheckResult = {
      healthy: false,
      lastCheck: new Date(),
    };

    if (!process) {
      result.error = 'Server not found';
      return result;
    }

    if (process.state !== 'running') {
      result.error = `Server is ${process.state}`;
      return result;
    }

    if (!childProcess || childProcess.killed) {
      result.error = 'Process not found or killed';
      return result;
    }

    try {
      // 简单的健康检查：进程是否存活
      const startTime = Date.now();
      const alive = !childProcess.killed && childProcess.pid !== undefined;
      const latency = Date.now() - startTime;

      result.healthy = alive;
      result.latency = latency;
      result.details = {
        pid: childProcess.pid,
        uptime: process.startedAt ? Date.now() - process.startedAt.getTime() : 0,
        restartCount: process.restartCount,
      };

      if (result.healthy) {
        this.emit('health:ok', { serverName, result });
      } else {
        this.emit('health:failed', { serverName, result });
      }
    } catch (error) {
      result.error = (error as Error).message;
      this.emit('health:failed', { serverName, result, error });
    }

    return result;
  }

  /**
   * 检查所有服务器健康状态
   */
  async healthCheckAll(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    const serverNames = Array.from(this.processes.keys());

    for (const serverName of serverNames) {
      const result = await this.healthCheck(serverName);
      results.set(serverName, result);
    }

    return results;
  }

  /**
   * 调度健康检查
   */
  private scheduleHealthCheck(serverName: string): void {
    // 取消现有的健康检查
    this.cancelHealthCheck(serverName);

    // 调度新的健康检查
    const timerId = setInterval(async () => {
      const result = await this.healthCheck(serverName);

      if (!result.healthy) {
        const process = this.processes.get(serverName);
        if (process) {
          process.consecutiveFailures++;

          // 如果连续失败次数过多，尝试重启
          if (process.consecutiveFailures >= 3) {
            this.emit('health:degraded', { serverName, result });
            await this.autoRestart(serverName, process);
          }
        }
      } else {
        const process = this.processes.get(serverName);
        if (process) {
          process.consecutiveFailures = 0;
        }
      }
    }, this.options.healthCheckInterval);

    this.healthCheckTimers.set(serverName, timerId);
  }

  /**
   * 取消健康检查
   */
  private cancelHealthCheck(serverName: string): void {
    const timerId = this.healthCheckTimers.get(serverName);
    if (timerId) {
      clearInterval(timerId);
      this.healthCheckTimers.delete(serverName);
    }
  }

  // ============ 状态查询 ============

  /**
   * 获取服务器状态
   */
  getState(serverName: string): ServerState {
    const process = this.processes.get(serverName);
    return process?.state || 'stopped';
  }

  /**
   * 获取进程信息
   */
  getProcess(serverName: string): ServerProcess | null {
    return this.processes.get(serverName) || null;
  }

  /**
   * 获取所有进程信息
   */
  getAllProcesses(): ServerProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * 检查服务器是否运行中
   */
  isRunning(serverName: string): boolean {
    const process = this.processes.get(serverName);
    return process?.state === 'running';
  }

  /**
   * 获取运行中的服务器列表
   */
  getRunningServers(): string[] {
    const entries = Array.from(this.processes.entries());
    return entries
      .filter(([, proc]) => proc.state === 'running')
      .map(([name]) => name);
  }

  /**
   * 获取服务器统计信息
   */
  getStats(serverName: string): {
    uptime?: number;
    restartCount: number;
    consecutiveFailures: number;
    lastError?: string;
  } | null {
    const process = this.processes.get(serverName);

    if (!process) {
      return null;
    }

    return {
      uptime: process.startedAt ? Date.now() - process.startedAt.getTime() : undefined,
      restartCount: process.restartCount,
      consecutiveFailures: process.consecutiveFailures,
      lastError: process.lastError?.message,
    };
  }

  // ============ 配置更新 ============

  /**
   * 更新服务器配置（需要重启才能生效）
   */
  async onConfigChange(serverName: string, newConfig: McpServerConfig): Promise<void> {
    const wasRunning = this.isRunning(serverName);

    // 停止服务器
    if (wasRunning) {
      await this.stop(serverName);
    }

    // 更新配置
    this.configs.set(serverName, newConfig);
    this.emit('config:changed', { serverName, config: newConfig });

    // 如果之前在运行，重新启动
    if (wasRunning) {
      await this.start(serverName);
    }
  }

  // ============ 清理和销毁 ============

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    // 停止所有健康检查
    const healthCheckTimers = Array.from(this.healthCheckTimers.values());
    for (const timerId of healthCheckTimers) {
      clearInterval(timerId);
    }
    this.healthCheckTimers.clear();

    // 清除所有定时器
    const startupTimers = Array.from(this.startupTimers.values());
    for (const timerId of startupTimers) {
      clearTimeout(timerId);
    }
    this.startupTimers.clear();

    const shutdownTimers = Array.from(this.shutdownTimers.values());
    for (const timerId of shutdownTimers) {
      clearTimeout(timerId);
    }
    this.shutdownTimers.clear();

    // 停止所有服务器
    await this.stopAll(true);

    // 清空数据
    this.processes.clear();
    this.configs.clear();
    this.childProcesses.clear();
    this.dependencies.clear();

    // 移除所有监听器
    this.removeAllListeners();
  }

  // ============ 私有辅助方法 ============

  /**
   * 更新服务器状态
   */
  private updateState(serverName: string, state: ServerState): void {
    const process = this.processes.get(serverName);
    if (process) {
      process.state = state;
    }
  }

  /**
   * 处理进程错误
   */
  private handleProcessError(serverName: string, process: ServerProcess, error: Error): void {
    process.lastError = error;
    process.consecutiveFailures++;
    this.updateState(serverName, 'error');
    this.emit('server:error', { serverName, process, error });
  }

  /**
   * 处理进程退出
   */
  private handleProcessExit(
    serverName: string,
    process: ServerProcess,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    this.childProcesses.delete(serverName);
    this.cancelHealthCheck(serverName);

    // 如果是正常停止，不做处理
    if (process.state === 'stopping') {
      return;
    }

    // 异常退出
    if (code !== 0 && code !== null) {
      process.lastError = new Error(`Process exited with code ${code}`);
      process.consecutiveFailures++;
      this.updateState(serverName, 'crashed');
      this.emit('server:crashed', { serverName, process, code, signal });

      // 尝试自动重启
      this.autoRestart(serverName, process).catch((error) => {
        this.emit('server:error', { serverName, process, error });
      });
    } else {
      this.updateState(serverName, 'stopped');
      this.emit('server:stopped', { serverName, process, code, signal });
    }
  }

  /**
   * 处理启动超时
   */
  private handleStartupTimeout(serverName: string, process: ServerProcess): void {
    const childProcess = this.childProcesses.get(serverName);

    if (childProcess && !childProcess.killed) {
      childProcess.kill('SIGKILL');
    }

    process.lastError = new Error('Startup timeout exceeded');
    this.updateState(serverName, 'error');
    this.emit('server:error', {
      serverName,
      process,
      error: process.lastError
    });
  }

  /**
   * 处理启动失败
   */
  private handleStartupFailure(serverName: string, process: ServerProcess, error: Error): void {
    process.lastError = error;
    process.consecutiveFailures++;
    this.updateState(serverName, 'error');

    // 清理进程
    const childProcess = this.childProcesses.get(serverName);
    if (childProcess && !childProcess.killed) {
      childProcess.kill('SIGKILL');
    }
    this.childProcesses.delete(serverName);

    // 清除启动超时
    const timerId = this.startupTimers.get(serverName);
    if (timerId) {
      clearTimeout(timerId);
      this.startupTimers.delete(serverName);
    }
  }

  /**
   * 等待服务器达到指定状态
   */
  private async waitForState(serverName: string, targetState: ServerState, timeout = 30000): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkState = () => {
        const currentState = this.getState(serverName);

        if (currentState === targetState) {
          resolve();
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for state ${targetState}`));
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ 事件类型定义 ============

export interface ServerEvent {
  serverName: string;
  process: ServerProcess;
}

export interface ServerErrorEvent extends ServerEvent {
  error: Error;
}

export interface ServerCrashedEvent extends ServerEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface ServerRestartingEvent extends ServerEvent {}

export interface ServerStoppedEvent extends ServerEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

export interface HealthEvent {
  serverName: string;
  result: HealthCheckResult;
  error?: Error;
}

export interface ConfigChangedEvent {
  serverName: string;
  config: McpServerConfig;
}

// ============ 导出类型扩展 ============

declare module './lifecycle.js' {
  interface McpLifecycleManager {
    on(event: 'server:starting', listener: (data: ServerEvent) => void): this;
    on(event: 'server:started', listener: (data: ServerEvent & { pid?: number }) => void): this;
    on(event: 'server:stopping', listener: (data: ServerEvent & { reason?: string }) => void): this;
    on(event: 'server:stopped', listener: (data: ServerStoppedEvent) => void): this;
    on(event: 'server:error', listener: (data: ServerErrorEvent) => void): this;
    on(event: 'server:crashed', listener: (data: ServerCrashedEvent) => void): this;
    on(event: 'server:restarting', listener: (data: ServerRestartingEvent) => void): this;
    on(event: 'health:ok', listener: (data: HealthEvent) => void): this;
    on(event: 'health:degraded', listener: (data: HealthEvent) => void): this;
    on(event: 'health:failed', listener: (data: HealthEvent) => void): this;
    on(event: 'config:changed', listener: (data: ConfigChangedEvent) => void): this;
    on(event: 'server:stdout', listener: (data: { serverName: string; data: string }) => void): this;
    on(event: 'server:stderr', listener: (data: { serverName: string; data: string }) => void): this;
  }
}
