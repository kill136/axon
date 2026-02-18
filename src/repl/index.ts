import { NodeRuntime } from './runtimes/node.js';
import { PythonRuntime } from './runtimes/python.js';
import type { ExecutionResult, SessionInfo, RuntimeConfig } from './types.js';

const MAX_SESSIONS = 5;
// 30 分钟无操作自动清理
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

interface SessionEntry {
  runtime: NodeRuntime | PythonRuntime;
  info: SessionInfo;
  cleanupTimer: ReturnType<typeof setTimeout>;
}

export class REPLSessionManager {
  private sessions: Map<string, SessionEntry> = new Map();

  private resetCleanupTimer(name: string): void {
    const entry = this.sessions.get(name);
    if (!entry) return;
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = setTimeout(() => {
      this.stopSession(name);
    }, SESSION_TIMEOUT_MS);
  }

  async startSession(name: string, config: RuntimeConfig): Promise<SessionInfo> {
    if (this.sessions.has(name)) {
      throw new Error(`会话 '${name}' 已存在`);
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`已达到最大会话数限制 (${MAX_SESSIONS})，请先停止其他会话`);
    }

    const runtime =
      config.runtime === 'python'
        ? new PythonRuntime(config)
        : new NodeRuntime(config);

    await runtime.start();

    const pid = (runtime as any).process?.pid ?? 0;

    const info: SessionInfo = {
      name,
      runtime: config.runtime,
      pid,
      createdAt: new Date(),
      lastUsed: new Date(),
      execCount: 0,
    };

    const cleanupTimer = setTimeout(() => {
      this.stopSession(name);
    }, SESSION_TIMEOUT_MS);

    this.sessions.set(name, { runtime, info, cleanupTimer });

    return info;
  }

  async execute(sessionName: string, code: string, timeout: number): Promise<ExecutionResult> {
    const entry = this.sessions.get(sessionName);
    if (!entry) {
      throw new Error(`会话 '${sessionName}' 不存在，请先使用 start 操作创建会话`);
    }

    entry.info.lastUsed = new Date();
    entry.info.execCount++;
    this.resetCleanupTimer(sessionName);

    return entry.runtime.execute(code, timeout);
  }

  stopSession(name: string): void {
    const entry = this.sessions.get(name);
    if (!entry) return;
    clearTimeout(entry.cleanupTimer);
    entry.runtime.stop();
    this.sessions.delete(name);
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((e) => e.info);
  }

  async resetSession(name: string): Promise<void> {
    const entry = this.sessions.get(name);
    if (!entry) {
      throw new Error(`会话 '${name}' 不存在`);
    }
    const config: RuntimeConfig = {
      runtime: entry.info.runtime,
      cwd: (entry.runtime as any).config?.cwd ?? process.cwd(),
      env: (entry.runtime as any).config?.env ?? {},
      timeout: (entry.runtime as any).config?.timeout ?? 30000,
    };
    this.stopSession(name);
    await this.startSession(name, config);
  }
}

// 单例
export const replSessionManager = new REPLSessionManager();
