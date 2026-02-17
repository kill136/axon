import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { REPLInput } from '../repl/types.js';

export class REPLTool extends BaseTool<REPLInput, ToolResult> {
  name = 'REPL';
  description = `
Execute code interactively in a persistent REPL session (Node.js or Python).
Sessions maintain state between executions - variables defined in one call are available in subsequent calls.

ACTIONS:
  - start: Create a new REPL session (runtime: node or python)
  - execute: Run code in an existing session
  - stop: Terminate a session
  - list: Show all active sessions
  - reset: Clear session state (stop + restart)

USAGE NOTES:
  - Always call "start" before "execute"
  - Default session name is "default"
  - Sessions are automatically cleaned up after 30 minutes of inactivity
  - Maximum 5 concurrent sessions
  - Node.js sessions support async/await
  - Python sessions support both expressions and statements
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'execute', 'stop', 'list', 'reset'],
          description: 'The REPL action to perform',
        },
        session: {
          type: 'string',
          description: 'Session name (default: "default")',
        },
        runtime: {
          type: 'string',
          enum: ['node', 'python'],
          description: 'Runtime to use when starting a session (default: node)',
        },
        code: {
          type: 'string',
          description: 'Code to execute (required for execute action)',
        },
        timeout: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 30000)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the session',
        },
        env: {
          type: 'object',
          description: 'Additional environment variables',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['action'],
    };
  }

  async execute(input: REPLInput): Promise<ToolResult> {
    const { replSessionManager } = await import('../repl/index.js');

    const sessionName = input.session ?? 'default';
    const timeout = input.timeout ?? 30000;

    try {
      switch (input.action) {
        case 'start': {
          const runtime = input.runtime ?? 'node';
          const config = {
            runtime,
            cwd: input.cwd ?? process.cwd(),
            env: input.env ?? {},
            timeout,
          };
          await replSessionManager.startSession(sessionName, config);
          return this.success(`会话 '${sessionName}' 已启动 (${runtime})`);
        }

        case 'execute': {
          if (!input.code) {
            return this.error('缺少必需参数: code');
          }
          const result = await replSessionManager.execute(sessionName, input.code, timeout);

          const parts: string[] = [];

          if (result.error) {
            parts.push(`错误:\n${result.error}`);
          } else {
            if (result.output) {
              parts.push(`输出:\n${result.output}`);
            }
            if (result.result !== undefined && result.result !== '') {
              parts.push(`结果 (${result.resultType ?? 'unknown'}): ${result.result}`);
            }
            if (!result.output && (result.result === undefined || result.result === '')) {
              parts.push('（无输出）');
            }
          }

          parts.push(`耗时: ${result.duration}ms`);

          return result.error
            ? this.error(parts.join('\n'))
            : this.success(parts.join('\n'));
        }

        case 'stop': {
          replSessionManager.stopSession(sessionName);
          return this.success(`会话 '${sessionName}' 已停止`);
        }

        case 'list': {
          const sessions = replSessionManager.listSessions();
          if (sessions.length === 0) {
            return this.success('当前没有活跃的 REPL 会话');
          }
          const header = '名称            运行时    PID     执行次数  最后使用';
          const separator = '─'.repeat(60);
          const rows = sessions.map((s) => {
            const name = s.name.padEnd(16);
            const rt = s.runtime.padEnd(10);
            const pid = String(s.pid).padEnd(8);
            const count = String(s.execCount).padEnd(10);
            const lastUsed = s.lastUsed.toLocaleTimeString();
            return `${name}${rt}${pid}${count}${lastUsed}`;
          });
          return this.success([header, separator, ...rows].join('\n'));
        }

        case 'reset': {
          await replSessionManager.resetSession(sessionName);
          return this.success(`会话 '${sessionName}' 已重置`);
        }

        default:
          return this.error(`未知操作: ${(input as any).action}`);
      }
    } catch (err: any) {
      return this.error(err.message ?? String(err));
    }
  }
}
