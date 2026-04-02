/**
 * REPL 工具
 * 交互式代码执行，支持 Python 和 Node.js
 * 同一会话内多次调用共享状态（变量、导入等持久化）
 */

import { spawn, ChildProcess } from 'child_process';
import { BaseTool } from './base.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { truncateString } from '../utils/truncated-buffer.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

// ============================================================================
// 类型定义
// ============================================================================

type ReplLanguage = 'python' | 'javascript';

interface ReplInput {
  /** 要执行的代码 */
  code: string;
  /** 语言：python 或 javascript */
  language: ReplLanguage;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 会话 ID，相同 ID 的调用共享状态。省略则使用语言默认会话 */
  session_id?: string;
  /** 设为 true 销毁指定会话 */
  restart?: boolean;
}

interface ReplSession {
  process: ChildProcess;
  language: ReplLanguage;
  createdAt: number;
  lastUsedAt: number;
}

// ============================================================================
// 会话管理
// ============================================================================

/** 全局 REPL 会话池 */
const sessions = new Map<string, ReplSession>();

/** 输出最大长度（字符数） */
const MAX_OUTPUT_LENGTH = 30000;

/** 默认超时 30s */
const DEFAULT_TIMEOUT = 30000;

/** 会话空闲超时 10 分钟，自动回收 */
const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000;

/** 结束标记，用于分隔执行结果 */
const SENTINEL = `__AXON_REPL_DONE_${Date.now()}__`;

/**
 * 清理所有 REPL 会话（进程退出时调用）
 */
export function cleanupAllReplSessions(): void {
  for (const [id, session] of sessions) {
    try {
      session.process.kill('SIGKILL');
    } catch {
      // ignore
    }
    sessions.delete(id);
  }
}

// 进程退出时清理
process.on('exit', cleanupAllReplSessions);

// ============================================================================
// REPL 工具
// ============================================================================

export class ReplTool extends BaseTool<ReplInput, ToolResult> {
  name = 'REPL';
  shouldDefer = true;
  searchHint = 'interactive code execution, python, node.js, javascript, repl, evaluate, run code';
  description = `Execute code in a persistent REPL (Read-Eval-Print Loop) session. The session retains state across calls — variables, imports, and function definitions persist.

Supported languages:
- **python**: Python 3 interactive interpreter
- **javascript**: Node.js REPL

Key features:
- State persists within the same session (same session_id + language)
- Use \`session_id\` to maintain separate contexts for different tasks
- Set \`restart: true\` to destroy a session and start fresh
- Output is automatically truncated if too large

When to use REPL vs Bash:
- Use REPL for iterative computation, data exploration, prototyping, or multi-step calculations where you need persistent state
- Use Bash for one-off shell commands, file operations, or system administration tasks`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to execute in the REPL session',
        },
        language: {
          type: 'string',
          enum: ['python', 'javascript'],
          description: 'The programming language to use',
        },
        timeout: {
          type: 'number',
          description: `Execution timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`,
        },
        session_id: {
          type: 'string',
          description: 'Session identifier for state isolation. Defaults to the language name.',
        },
        restart: {
          type: 'boolean',
          description: 'If true, destroy the existing session and create a new one',
        },
      },
      required: ['code', 'language'],
    };
  }

  async execute(input: ReplInput): Promise<ToolResult> {
    const { code, language, restart } = input;
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;
    const sessionId = input.session_id ?? language;
    const sessionKey = `${language}:${sessionId}`;

    // 验证语言
    if (language !== 'python' && language !== 'javascript') {
      return this.error(`Unsupported language: "${language}". Supported: python, javascript`);
    }

    // 验证代码不为空
    if (!code || !code.trim()) {
      return this.error('Code cannot be empty');
    }

    // 清理空闲超时的会话
    this.cleanupIdleSessions();

    // restart: 销毁现有会话
    if (restart) {
      this.destroySession(sessionKey);
    }

    // 获取或创建会话
    let session = sessions.get(sessionKey);
    if (!session || session.process.killed || session.process.exitCode !== null) {
      // 会话不存在或已退出，创建新的
      sessions.delete(sessionKey);
      try {
        session = this.createSession(language, sessionKey);
      } catch (err) {
        return this.error(`Failed to start ${language} REPL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    session.lastUsedAt = Date.now();

    // 执行代码
    try {
      const result = await this.executeCode(session, code, language, timeout);
      return this.success(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 超时或崩溃时销毁会话
      if (message.includes('timed out') || message.includes('exited')) {
        this.destroySession(sessionKey);
      }
      return this.error(message);
    }
  }

  /**
   * 创建 REPL 子进程
   */
  private createSession(language: ReplLanguage, sessionKey: string): ReplSession {
    const cwd = getCurrentCwd();
    let proc: ChildProcess;

    if (language === 'python') {
      // -u: 无缓冲输出; -i: 交互模式
      const pythonCmd = this.findPython();
      proc = spawn(pythonCmd, ['-u', '-i', '-q'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
      });
    } else {
      // Node.js REPL
      proc = spawn(process.execPath, ['--interactive'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_NO_READLINE: '1',
        },
      });
    }

    if (!proc.pid) {
      throw new Error(`Failed to spawn ${language} process`);
    }

    const session: ReplSession = {
      process: proc,
      language,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    sessions.set(sessionKey, session);
    return session;
  }

  /**
   * 在 REPL 会话中执行代码并收集输出
   */
  private executeCode(
    session: ReplSession,
    code: string,
    language: ReplLanguage,
    timeout: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const { process: proc } = session;

      if (!proc.stdin || !proc.stdout || !proc.stderr) {
        reject(new Error('REPL process stdio not available'));
        return;
      }

      let output = '';
      let timedOut = false;

      // 超时定时器
      const timer = setTimeout(() => {
        timedOut = true;
        // 发送中断信号
        try {
          proc.kill('SIGINT');
        } catch {
          // ignore
        }
        resolve(truncateString(
          output + '\n[Execution timed out after ' + timeout + 'ms]',
          MAX_OUTPUT_LENGTH,
        ));
      }, timeout);

      // 用 sentinel 来判断执行完成
      const sentinel = SENTINEL;
      let sentinelSent = false;

      const onStdout = (data: Buffer) => {
        const text = data.toString();
        // 检查 sentinel
        if (text.includes(sentinel)) {
          const parts = text.split(sentinel);
          output += parts[0];
          finish();
          return;
        }
        output += text;
      };

      const onStderr = (data: Buffer) => {
        const text = data.toString();
        // 过滤掉 Python/Node 的 prompt 和无关 stderr
        const filtered = this.filterStderr(text, language);
        if (filtered) {
          output += filtered;
        }
      };

      const onExit = (exitCode: number | null) => {
        clearTimeout(timer);
        cleanup();
        if (!timedOut) {
          if (output.trim()) {
            resolve(truncateString(output.trim(), MAX_OUTPUT_LENGTH));
          } else {
            reject(new Error(`REPL process exited with code ${exitCode}`));
          }
        }
      };

      const cleanup = () => {
        proc.stdout?.removeListener('data', onStdout);
        proc.stderr?.removeListener('data', onStderr);
        proc.removeListener('exit', onExit);
      };

      const finish = () => {
        clearTimeout(timer);
        cleanup();
        if (!timedOut) {
          // 清理输出：移除 prompt 符号
          const cleaned = this.cleanOutput(output, language);
          resolve(truncateString(cleaned, MAX_OUTPUT_LENGTH));
        }
      };

      proc.stdout.on('data', onStdout);
      proc.stderr.on('data', onStderr);
      proc.on('exit', onExit);

      // 构造带 sentinel 的执行代码
      const wrappedCode = this.wrapCode(code, sentinel, language);

      try {
        proc.stdin.write(wrappedCode);
      } catch (err) {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`Failed to write to REPL stdin: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /**
   * 将代码包装为带 sentinel 的形式
   */
  private wrapCode(code: string, sentinel: string, language: ReplLanguage): string {
    if (language === 'python') {
      // Python: 执行代码后 print sentinel
      // 使用 exec() 来处理多行代码，避免缩进问题
      const escapedCode = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      return `exec('${escapedCode}')\nprint("${sentinel}")\n`;
    } else {
      // Node.js: 执行代码后 console.log sentinel
      // 用 void 包裹避免 REPL 打印 undefined
      return `${code}\nconsole.log("${sentinel}")\n`;
    }
  }

  /**
   * 过滤 stderr 噪声
   */
  private filterStderr(text: string, language: ReplLanguage): string {
    if (language === 'python') {
      // 过滤 Python 的 >>> 和 ... prompt
      const lines = text.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed !== '>>>' && trimmed !== '...' && !trimmed.startsWith('>>> ') && !trimmed.startsWith('... ');
      });
      return filtered.join('\n');
    } else {
      // 过滤 Node.js 的 > prompt 和启动消息
      const lines = text.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed !== '>' && !trimmed.startsWith('> ') && !trimmed.startsWith('Welcome to Node.js');
      });
      return filtered.join('\n');
    }
  }

  /**
   * 清理输出中的 REPL prompt 等噪声
   */
  private cleanOutput(output: string, language: ReplLanguage): string {
    let cleaned = output;

    if (language === 'python') {
      // 移除 >>> 和 ... prompt
      cleaned = cleaned.replace(/^>>> /gm, '');
      cleaned = cleaned.replace(/^\.\.\. /gm, '');
      cleaned = cleaned.replace(/^>>> $/gm, '');
      cleaned = cleaned.replace(/^\.\.\. $/gm, '');
    } else {
      // 移除 Node.js > prompt 和 undefined 结果
      cleaned = cleaned.replace(/^> /gm, '');
      cleaned = cleaned.replace(/^undefined\n/gm, '');
    }

    // 移除首尾空白行
    cleaned = cleaned.replace(/^\s*\n/, '').replace(/\n\s*$/, '');

    return cleaned.trim();
  }

  /**
   * 查找可用的 Python 命令
   */
  private findPython(): string {
    // 优先使用 python3
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync('python3', ['--version'], { encoding: 'utf-8', timeout: 5000 });
      if (result.status === 0) return 'python3';
    } catch {
      // ignore
    }

    // 回退到 python
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync('python', ['--version'], { encoding: 'utf-8', timeout: 5000 });
      if (result.status === 0) return 'python';
    } catch {
      // ignore
    }

    // 默认返回 python3，让 spawn 阶段报错
    return 'python3';
  }

  /**
   * 销毁指定会话
   */
  private destroySession(sessionKey: string): void {
    const session = sessions.get(sessionKey);
    if (session) {
      try {
        session.process.kill('SIGKILL');
      } catch {
        // ignore
      }
      sessions.delete(sessionKey);
    }
  }

  /**
   * 清理空闲超时的会话
   */
  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [key, session] of sessions) {
      if (now - session.lastUsedAt > SESSION_IDLE_TIMEOUT) {
        this.destroySession(key);
      }
    }
  }
}
