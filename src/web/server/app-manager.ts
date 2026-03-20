/**
 * App Manager — 应用进程管理系统
 *
 * 管理由 AI 创建的 Web 应用的完整生命周期：
 * - 注册/更新/删除 App 记录（持久化到 ~/.axon/apps/）
 * - 启动/停止/重启 App 服务进程
 * - 为每个 App 独立管理 Cloudflare Tunnel
 * - 进程日志环形缓冲
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ============================================================================
// 类型定义
// ============================================================================

export interface AppRecord {
  id: string;
  name: string;
  description: string;
  directory: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;

  // 运行配置
  startCommand: string;
  port?: number;
  entryPath?: string; // 入口路径，如 /snake.html，预览时拼接到端口后面
  env?: Record<string, string>;
}

export type AppStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface AppRuntime extends AppRecord {
  status: AppStatus;
  pid: number | null;
  tunnelUrl: string | null;
  error: string | null;
  startedAt: number | null;
  uptime: number | null; // 秒
}

interface ProcessState {
  process: ChildProcess;
  status: AppStatus;
  startedAt: number | null;
  error: string | null;
  logs: string[]; // 环形缓冲
}

// ============================================================================
// 常量
// ============================================================================

const APPS_DIR = path.join(os.homedir(), '.axon', 'apps');
const MAX_LOG_LINES = 1000;
const IS_WINDOWS = os.platform() === 'win32';

// ============================================================================
// AppManager
// ============================================================================

export class AppManager extends EventEmitter {
  private apps = new Map<string, AppRecord>();
  private processes = new Map<string, ProcessState>();
  private tunnels = new Map<string, any>(); // CloudflareTunnel instances

  constructor() {
    super();
    this.ensureAppsDir();
    this.loadApps();
  }

  // ========================================
  // 持久化
  // ========================================

  private ensureAppsDir(): void {
    if (!fs.existsSync(APPS_DIR)) {
      fs.mkdirSync(APPS_DIR, { recursive: true });
    }
  }

  private appFilePath(id: string): string {
    return path.join(APPS_DIR, `${id}.json`);
  }

  private loadApps(): void {
    try {
      const files = fs.readdirSync(APPS_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(APPS_DIR, file), 'utf-8');
          const app: AppRecord = JSON.parse(content);
          if (app.id) {
            this.apps.set(app.id, app);
          }
        } catch {
          // 跳过损坏的文件
        }
      }
    } catch {
      // 目录不存在或无法读取
    }
  }

  private saveApp(app: AppRecord): void {
    this.ensureAppsDir();
    fs.writeFileSync(this.appFilePath(app.id), JSON.stringify(app, null, 2), 'utf-8');
  }

  private deleteAppFile(id: string): void {
    const filePath = this.appFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // ========================================
  // CRUD
  // ========================================

  register(input: {
    name: string;
    description?: string;
    directory: string;
    icon?: string;
    startCommand: string;
    port?: number;
    entryPath?: string;
    env?: Record<string, string>;
    sessionId?: string;
  }): AppRecord {
    const now = Date.now();
    const app: AppRecord = {
      id: randomUUID(),
      name: input.name,
      description: input.description || '',
      directory: input.directory,
      icon: input.icon || '📦',
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
      startCommand: input.startCommand,
      port: input.port,
      entryPath: input.entryPath,
      env: input.env,
    };

    this.apps.set(app.id, app);
    this.saveApp(app);
    this.emit('registered', app);
    return app;
  }

  update(id: string, updates: Partial<Omit<AppRecord, 'id' | 'createdAt'>>): AppRecord {
    const app = this.apps.get(id);
    if (!app) throw new Error(`App not found: ${id}`);

    const updated: AppRecord = {
      ...app,
      ...updates,
      id: app.id, // 不可变
      createdAt: app.createdAt, // 不可变
      updatedAt: Date.now(),
    };

    this.apps.set(id, updated);
    this.saveApp(updated);
    this.emit('updated', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    // 先停止进程和隧道
    await this.stop(id).catch(() => {});
    await this.stopTunnel(id).catch(() => {});

    this.apps.delete(id);
    this.processes.delete(id);
    this.deleteAppFile(id);
    this.emit('removed', id);
  }

  get(id: string): AppRuntime | null {
    const app = this.apps.get(id);
    if (!app) return null;
    return this.toRuntime(app);
  }

  list(): AppRuntime[] {
    return Array.from(this.apps.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(app => this.toRuntime(app));
  }

  private toRuntime(app: AppRecord): AppRuntime {
    const proc = this.processes.get(app.id);
    const tunnel = this.tunnels.get(app.id);
    const now = Date.now();

    return {
      ...app,
      status: proc?.status || 'stopped',
      pid: proc?.process?.pid ?? null,
      error: proc?.error ?? null,
      startedAt: proc?.startedAt ?? null,
      uptime: proc?.startedAt ? Math.floor((now - proc.startedAt) / 1000) : null,
      tunnelUrl: tunnel?.info?.url ?? null,
    };
  }

  // ========================================
  // 进程管理
  // ========================================

  async start(id: string): Promise<AppRuntime> {
    const app = this.apps.get(id);
    if (!app) throw new Error(`App not found: ${id}`);

    // 如果已经在运行，先停止
    const existing = this.processes.get(id);
    if (existing && existing.status === 'running') {
      await this.stop(id);
    }

    const state: ProcessState = {
      process: null as any,
      status: 'starting',
      startedAt: null,
      error: null,
      logs: [],
    };
    this.processes.set(id, state);
    this.emit('status', { id, status: 'starting' });

    try {
      const child = this.spawnProcess(app);
      state.process = child;
      state.status = 'running';
      state.startedAt = Date.now();

      // 日志收集
      const appendLog = (data: Buffer | string) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            state.logs.push(line);
            if (state.logs.length > MAX_LOG_LINES) {
              state.logs.shift();
            }
          }
        }
      };

      child.stdout?.on('data', appendLog);
      child.stderr?.on('data', appendLog);

      child.on('error', (err) => {
        state.status = 'error';
        state.error = err.message;
        this.emit('status', { id, status: 'error', error: err.message });
      });

      child.on('exit', (code, signal) => {
        // 只有当状态还是 running 时才更新（stop() 会主动设为 stopped）
        if (state.status === 'running' || state.status === 'starting') {
          if (code === 0) {
            state.status = 'stopped';
            state.error = null;
          } else {
            state.status = 'error';
            state.error = `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
          }
          this.emit('status', { id, status: state.status, error: state.error });
        }
      });

      this.emit('status', { id, status: 'running' });
      return this.toRuntime(app);
    } catch (err: any) {
      state.status = 'error';
      state.error = err.message;
      this.emit('status', { id, status: 'error', error: err.message });
      return this.toRuntime(app);
    }
  }

  async stop(id: string): Promise<AppRuntime> {
    const app = this.apps.get(id);
    if (!app) throw new Error(`App not found: ${id}`);

    const proc = this.processes.get(id);
    if (!proc || proc.status === 'stopped') {
      return this.toRuntime(app);
    }

    proc.status = 'stopped';
    proc.startedAt = null;
    proc.error = null;

    try {
      this.killProcess(proc.process);
    } catch {
      // ignore
    }

    this.emit('status', { id, status: 'stopped' });
    return this.toRuntime(app);
  }

  async restart(id: string): Promise<AppRuntime> {
    await this.stop(id);
    // 等进程完全退出
    await new Promise(resolve => setTimeout(resolve, 500));
    return this.start(id);
  }

  getLogs(id: string, lines?: number): string[] {
    const proc = this.processes.get(id);
    if (!proc) return [];
    const n = lines || MAX_LOG_LINES;
    return proc.logs.slice(-n);
  }

  private spawnProcess(app: AppRecord): ChildProcess {
    const dir = app.directory;
    if (!fs.existsSync(dir)) {
      throw new Error(`Directory not found: ${dir}`);
    }

    const env = { ...process.env, ...app.env };

    if (IS_WINDOWS) {
      // Windows: 使用 cmd /c 执行命令
      return spawn('cmd', ['/c', app.startCommand], {
        cwd: dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      // Unix: 使用 sh -c
      return spawn('sh', ['-c', app.startCommand], {
        cwd: dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
  }

  private killProcess(child: ChildProcess): void {
    if (!child.pid) return;

    if (IS_WINDOWS) {
      // Windows: 使用 taskkill 杀掉进程树
      try {
        spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      // Unix: 先 SIGTERM，2 秒后 SIGKILL
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          if (!child.killed) {
            process.kill(-child.pid!, 'SIGKILL');
          }
        } catch {
          // 进程可能已退出
        }
      }, 2000);
    }
  }

  // ========================================
  // Tunnel 管理
  // ========================================

  async startTunnel(id: string): Promise<string> {
    const app = this.apps.get(id);
    if (!app) throw new Error(`App not found: ${id}`);
    if (!app.port) throw new Error(`App has no port configured`);

    // 如果已有隧道，先停止
    await this.stopTunnel(id).catch(() => {});

    const { CloudflareTunnel } = await import('./tunnel.js');
    const tunnel = new CloudflareTunnel(app.port);
    this.tunnels.set(id, tunnel);

    const info = await tunnel.start();
    if (info.status === 'error') {
      this.tunnels.delete(id);
      throw new Error(info.error || 'Failed to start tunnel');
    }

    this.emit('tunnel', { id, url: info.url });
    return info.url || '';
  }

  async stopTunnel(id: string): Promise<void> {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return;

    await tunnel.stop();
    this.tunnels.delete(id);
    this.emit('tunnel', { id, url: null });
  }

  // ========================================
  // 生命周期
  // ========================================

  async shutdown(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [id] of this.processes) {
      promises.push(this.stop(id).then(() => {}));
    }
    for (const [id] of this.tunnels) {
      promises.push(this.stopTunnel(id));
    }

    await Promise.allSettled(promises);
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let instance: AppManager | null = null;

export function getAppManager(): AppManager {
  if (!instance) {
    instance = new AppManager();
  }
  return instance;
}
