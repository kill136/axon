import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { DebuggerInput } from '../debugger/types.js';
import { fromMsysPath } from '../utils/platform.js';

export class DebuggerTool extends BaseTool<DebuggerInput, ToolResult> {
  name = 'Debugger';
  description = `
Debug Node.js and Python programs using DAP (Debug Adapter Protocol) and CDP (Chrome DevTools Protocol).
Supports launch, attach, breakpoints, stepping, variable inspection, and expression evaluation.

WORKFLOW:
1. Launch: Use "launch" action to start a program in debug mode
2. Set breakpoints: Use "set_breakpoint" to add breakpoints before continuing
3. Continue: Use "continue" to run until next breakpoint
4. Inspect: Use "stack_trace", "scopes", "variables", "evaluate" to inspect state
5. Step: Use "step_over", "step_into", "step_out" for stepping
6. Disconnect: Use "disconnect" to terminate the debug session

AVAILABLE ACTIONS:

Session Control:
  - launch: Start program in debug mode (requires: program, optional: args, runtime, cwd, env)
  - attach: Attach to running debug adapter (requires: host, port)
  - disconnect: Terminate debug session

Breakpoints:
  - set_breakpoint: Set a breakpoint (requires: file, line, optional: condition, hitCondition)
  - remove_breakpoint: Remove a breakpoint (requires: breakpointId)
  - list_breakpoints: List all breakpoints in current session

Execution Control:
  - continue: Continue execution until next breakpoint
  - step_over: Step over current line
  - step_into: Step into function call
  - step_out: Step out of current function
  - pause: Pause execution
  - threads: List all threads

Inspection:
  - stack_trace: Get current call stack
  - scopes: Get variable scopes for a frame (requires: frameId)
  - variables: Get variables in a scope (requires: variablesReference)
  - evaluate: Evaluate expression (requires: expression, optional: frameId, context)

SUPPORTED RUNTIMES:
  - node (default): Node.js via CDP (--inspect-brk)
  - python: Python via debugpy (DAP over TCP)
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'launch',
            'attach',
            'disconnect',
            'set_breakpoint',
            'remove_breakpoint',
            'list_breakpoints',
            'continue',
            'step_over',
            'step_into',
            'step_out',
            'pause',
            'stack_trace',
            'scopes',
            'variables',
            'evaluate',
            'threads',
          ],
          description: 'The debug action to perform',
        },
        program: {
          type: 'string',
          description: 'Path to the program to debug (for launch action)',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command-line arguments for the program (for launch action)',
        },
        runtime: {
          type: 'string',
          enum: ['node', 'python'],
          description: 'Runtime to use (default: node)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the program (for launch action)',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables for the program (for launch action)',
        },
        host: {
          type: 'string',
          description: 'Host to attach to (for attach action)',
        },
        port: {
          type: 'number',
          description: 'Port to attach to (for attach action)',
        },
        file: {
          type: 'string',
          description: 'File path for set_breakpoint action',
        },
        line: {
          type: 'number',
          description: 'Line number for set_breakpoint action',
        },
        condition: {
          type: 'string',
          description: 'Breakpoint condition expression (for set_breakpoint action)',
        },
        hitCondition: {
          type: 'string',
          description: 'Breakpoint hit condition (for set_breakpoint action)',
        },
        breakpointId: {
          type: 'number',
          description: 'Breakpoint ID (for remove_breakpoint action)',
        },
        frameId: {
          type: 'number',
          description: 'Stack frame ID (for scopes/evaluate actions)',
        },
        variablesReference: {
          type: 'number',
          description: 'Variables reference from scopes result (for variables action)',
        },
        expression: {
          type: 'string',
          description: 'Expression to evaluate (for evaluate action)',
        },
        context: {
          type: 'string',
          enum: ['watch', 'repl', 'hover'],
          description: 'Evaluation context (for evaluate action)',
        },
        timeout: {
          type: 'number',
          description: 'Operation timeout in milliseconds (default: 60000)',
        },
      },
      required: ['action'],
    };
  }

  async execute(input: DebuggerInput): Promise<ToolResult> {
    // 转换 MSYS 路径格式
    if (input.program) input = { ...input, program: fromMsysPath(input.program) };
    if (input.file) input = { ...input, file: fromMsysPath(input.file) };
    if (input.cwd) input = { ...input, cwd: fromMsysPath(input.cwd) };

    try {
      const { debugManager } = await import('../debugger/index.js');
      const timeout = input.timeout || 60000;

      switch (input.action) {
        case 'launch': {
          if (!input.program) {
            return this.error('launch 需要提供 program 参数');
          }
          const session = await Promise.race([
            debugManager.launch(input),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('launch 操作超时')), timeout)
            ),
          ]);
          return this.success(
            `已启动调试会话\n` +
            `  会话 ID: ${session.id}\n` +
            `  程序: ${session.program}\n` +
            `  PID: ${session.pid || 'N/A'}\n` +
            `  运行时: ${session.runtime}\n` +
            `  状态: ${session.state}（等待 continue 继续执行）\n` +
            `\n使用 "continue" 继续执行，或先用 "set_breakpoint" 设置断点。`
          );
        }

        case 'attach': {
          if (!input.host || !input.port) {
            return this.error('attach 需要提供 host 和 port 参数');
          }
          // attach 模式：直接连接现有调试适配器
          return this.error('attach 模式暂未实现，请使用 launch 启动新的调试会话');
        }

        case 'disconnect': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.disconnect(session.id);
          return this.success(`已断开调试会话 ${session.id}，程序已终止。`);
        }

        case 'set_breakpoint': {
          if (!input.file || !input.line) {
            return this.error('set_breakpoint 需要提供 file 和 line 参数');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话，请先使用 launch 启动调试');
          }
          const bp = await debugManager.setBreakpoint(
            session.id,
            input.file,
            input.line,
            input.condition,
            input.hitCondition
          );
          const status = bp.verified ? '已验证' : '待验证';
          const condInfo = bp.condition ? `\n  条件: ${bp.condition}` : '';
          const hitInfo = bp.hitCondition ? `\n  命中条件: ${bp.hitCondition}` : '';
          return this.success(
            `断点已设置\n` +
            `  ID: ${bp.id}\n` +
            `  文件: ${bp.file}\n` +
            `  行号: ${bp.line}\n` +
            `  状态: ${status}${condInfo}${hitInfo}` +
            (bp.message ? `\n  消息: ${bp.message}` : '')
          );
        }

        case 'remove_breakpoint': {
          if (input.breakpointId === undefined) {
            return this.error('remove_breakpoint 需要提供 breakpointId 参数');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const removed = debugManager.removeBreakpoint(session.id, input.breakpointId);
          if (!removed) {
            return this.error(`断点 ${input.breakpointId} 不存在`);
          }
          return this.success(`断点 ${input.breakpointId} 已移除`);
        }

        case 'list_breakpoints': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          if (session.breakpoints.length === 0) {
            return this.success('当前会话没有断点');
          }
          const list = session.breakpoints
            .map((bp) => {
              const verified = bp.verified ? '✓' : '○';
              const cond = bp.condition ? ` [条件: ${bp.condition}]` : '';
              return `  [${bp.id}] ${verified} ${bp.file}:${bp.line}${cond}`;
            })
            .join('\n');
          return this.success(`断点列表（${session.breakpoints.length} 个）:\n${list}`);
        }

        case 'continue': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.continueExecution(session.id);
          return this.success('已继续执行，程序运行中...');
        }

        case 'step_over': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.stepOver(session.id);
          return this.success('单步跳过（Step Over）已执行');
        }

        case 'step_into': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.stepInto(session.id);
          return this.success('单步进入（Step Into）已执行');
        }

        case 'step_out': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.stepOut(session.id);
          return this.success('单步跳出（Step Out）已执行');
        }

        case 'pause': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          await debugManager.pauseExecution(session.id);
          return this.success('程序已暂停');
        }

        case 'threads': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const threads = await debugManager.getThreads(session.id);
          if (threads.length === 0) {
            return this.success('没有活跃线程');
          }
          const list = threads.map((t) => `  [${t.id}] ${t.name}`).join('\n');
          return this.success(`线程列表（${threads.length} 个）:\n${list}`);
        }

        case 'stack_trace': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const frames = await Promise.race([
            debugManager.getStackTrace(session.id, input.frameId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('stack_trace 操作超时')), timeout)
            ),
          ]);
          if (frames.length === 0) {
            return this.success('调用栈为空（程序可能正在运行或已终止）');
          }
          const list = frames
            .map((f, i) => `  ${i === 0 ? '▶' : ' '} [${f.id}] ${f.name}\n      ${f.file}:${f.line}:${f.column}`)
            .join('\n');
          return this.success(`调用栈（${frames.length} 帧）:\n${list}`);
        }

        case 'scopes': {
          if (input.frameId === undefined) {
            return this.error('scopes 需要提供 frameId 参数（从 stack_trace 结果获取）');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const scopes = await debugManager.getScopes(session.id, input.frameId);
          if (scopes.length === 0) {
            return this.success('没有可用的变量作用域');
          }
          const list = scopes
            .map((s) => `  ${s.name} (variablesReference: ${s.variablesReference}${s.expensive ? ', 开销大' : ''})`)
            .join('\n');
          return this.success(`作用域列表:\n${list}\n\n使用 "variables" 并提供 variablesReference 查看具体变量。`);
        }

        case 'variables': {
          if (input.variablesReference === undefined) {
            return this.error('variables 需要提供 variablesReference 参数（从 scopes 结果获取）');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const vars = await Promise.race([
            debugManager.getVariables(session.id, input.variablesReference),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('variables 操作超时')), timeout)
            ),
          ]);
          if (vars.length === 0) {
            return this.success('没有变量');
          }
          // 格式化为对齐的表格
          const maxNameLen = Math.max(...vars.map((v) => v.name.length), 4);
          const maxTypeLen = Math.max(...vars.map((v) => (v.type || '').length), 4);
          const header = `  ${'名称'.padEnd(maxNameLen)}  ${'类型'.padEnd(maxTypeLen)}  值`;
          const divider = `  ${'-'.repeat(maxNameLen)}  ${'-'.repeat(maxTypeLen)}  ${'-'.repeat(20)}`;
          const rows = vars
            .map((v) => {
              const expandable = v.variablesReference > 0 ? ' [可展开]' : '';
              return `  ${v.name.padEnd(maxNameLen)}  ${(v.type || '').padEnd(maxTypeLen)}  ${v.value}${expandable}`;
            })
            .join('\n');
          return this.success(`变量列表（${vars.length} 个）:\n${header}\n${divider}\n${rows}`);
        }

        case 'evaluate': {
          if (!input.expression) {
            return this.error('evaluate 需要提供 expression 参数');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('没有活跃的调试会话');
          }
          const result = await Promise.race([
            debugManager.evaluate(session.id, input.expression, input.frameId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('evaluate 操作超时')), timeout)
            ),
          ]);
          return this.success(`表达式: ${input.expression}\n结果: ${result}`);
        }

        default:
          return this.error(`未知的 action: ${(input as any).action}`);
      }
    } catch (error: any) {
      if (error.message?.includes('Cannot find module') && error.message?.includes('ws')) {
        return this.error('ws 模块未安装，请运行: npm install ws');
      }
      if (error.message?.includes('Cannot find module') && error.message?.includes('debugpy')) {
        return this.error('debugpy 未安装，请运行: pip install debugpy');
      }
      return this.error(`调试器错误: ${error.message || String(error)}`);
    }
  }
}
