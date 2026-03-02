/**
 * Terminal Manager - 管理 WebUI 中的伪终端会话
 * 使用 node-pty 创建真正的 PTY，支持 ANSI 颜色、交互式程序等
 */

import * as os from 'os';

// node-pty 是可选依赖，动态导入
let pty: typeof import('node-pty') | null = null;
try {
  pty = await import('node-pty');
} catch (err) {
  console.warn('[TerminalManager] node-pty unavailable, using child_process fallback');
}

import { spawn, type ChildProcess } from 'child_process';

type IPty = import('node-pty').IPty;

interface TerminalSession {
  id: string;
  pty: IPty | null;
  process: ChildProcess | null;
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();

  /**
   * 获取默认 shell
   */
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      // Windows: 优先使用 PowerShell
      return 'powershell.exe';
    }
    // Unix: 使用用户的默认 shell
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * 获取默认 shell 参数
   */
  private getDefaultShellArgs(): string[] {
    const shell = this.getDefaultShell();
    if (os.platform() === 'win32') {
      if (shell.toLowerCase().includes('powershell')) {
        return ['-NoLogo'];
      }
      return [];
    }
    // Unix: 使用 login shell
    return ['-l'];
  }

  /**
   * 创建新的终端会话
   */
  create(
    id: string,
    options: {
      cols?: number;
      rows?: number;
      cwd?: string;
      onData: (data: string) => void;
      onExit: (code: number) => void;
    }
  ): boolean {
    if (this.sessions.has(id)) {
      console.warn(`[TerminalManager] Session ${id} already exists`);
      return false;
    }

    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || process.cwd();
    const shell = this.getDefaultShell();
    const shellArgs = this.getDefaultShellArgs();

    const session: TerminalSession = {
      id,
      pty: null,
      process: null,
      cwd,
      cols,
      rows,
      onData: options.onData,
      onExit: options.onExit,
    };

    if (pty) {
      // 使用 node-pty（推荐）
      try {
        const ptyProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
          } as Record<string, string>,
        });

        ptyProcess.onData((data: string) => {
          options.onData(data);
        });

        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
          options.onExit(exitCode);
          this.sessions.delete(id);
        });

        session.pty = ptyProcess;
        this.sessions.set(id, session);
        console.log(`[TerminalManager] PTY session created: ${id}, shell=${shell}, cwd=${cwd}`);
        return true;
      } catch (err) {
        console.error(`[TerminalManager] Failed to create PTY:`, err);
        // 回退到 child_process
      }
    }

    // 回退方案：使用 child_process（功能受限）
    try {
      const childProcess = spawn(shell, shellArgs, {
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });

      childProcess.stdout?.on('data', (data: Buffer) => {
        options.onData(data.toString());
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        options.onData(data.toString());
      });

      childProcess.on('exit', (code: number | null) => {
        options.onExit(code ?? 0);
        this.sessions.delete(id);
      });

      childProcess.on('error', (err: Error) => {
        options.onData(`\r\nError: ${err.message}\r\n`);
        options.onExit(1);
        this.sessions.delete(id);
      });

      session.process = childProcess;
      this.sessions.set(id, session);
      console.log(`[TerminalManager] child_process session created: ${id}, shell=${shell}`);
      return true;
    } catch (err) {
      console.error(`[TerminalManager] Failed to create terminal:`, err);
      return false;
    }
  }

  /**
   * 向终端写入数据（用户输入）
   */
  write(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.pty) {
      session.pty.write(data);
      return true;
    }

    if (session.process?.stdin) {
      session.process.stdin.write(data);
      return true;
    }

    return false;
  }

  /**
   * 调整终端大小
   */
  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.cols = cols;
    session.rows = rows;

    if (session.pty) {
      try {
        session.pty.resize(cols, rows);
        return true;
      } catch (err) {
        console.error(`[TerminalManager] Failed to resize:`, err);
        return false;
      }
    }

    // child_process 不支持 resize
    return false;
  }

  /**
   * 销毁终端会话
   */
  destroy(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.pty) {
      session.pty.kill();
    }

    if (session.process) {
      session.process.kill();
    }

    this.sessions.delete(id);
    console.log(`[TerminalManager] Session destroyed: ${id}`);
    return true;
  }

  /**
   * 销毁所有会话
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }

  /**
   * 获取活跃会话数
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 检查会话是否存在
   */
  has(id: string): boolean {
    return this.sessions.has(id);
  }
}
