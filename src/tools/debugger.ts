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
            return this.error('launch requires program parameter');
          }
          const session = await Promise.race([
            debugManager.launch(input),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('launch operation timed out')), timeout)
            ),
          ]);
          return this.success(
            `Debug session started\n` +
            `  Session ID: ${session.id}\n` +
            `  Program: ${session.program}\n` +
            `  PID: ${session.pid || 'N/A'}\n` +
            `  Runtime: ${session.runtime}\n` +
            `  Status: ${session.state} (waiting for continue)\n` +
            `\nUse "continue" to resume execution, or use "set_breakpoint" to set breakpoints first.`
          );
        }

        case 'attach': {
          if (!input.host || !input.port) {
            return this.error('attach requires host and port parameters');
          }
          // attach 模式：直接连接现有调试适配器
          return this.error('attach mode not yet implemented, please use launch to start a new debug session');
        }

        case 'disconnect': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.disconnect(session.id);
          return this.success(`Debug session ${session.id} disconnected, program terminated.`);
        }

        case 'set_breakpoint': {
          if (!input.file || !input.line) {
            return this.error('set_breakpoint requires file and line parameters');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session, please use launch to start debugging first');
          }
          const bp = await debugManager.setBreakpoint(
            session.id,
            input.file,
            input.line,
            input.condition,
            input.hitCondition
          );
          const status = bp.verified ? 'verified' : 'pending';
          const condInfo = bp.condition ? `\n  Condition: ${bp.condition}` : '';
          const hitInfo = bp.hitCondition ? `\n  Hit condition: ${bp.hitCondition}` : '';
          return this.success(
            `Breakpoint set\n` +
            `  ID: ${bp.id}\n` +
            `  File: ${bp.file}\n` +
            `  Line: ${bp.line}\n` +
            `  Status: ${status}${condInfo}${hitInfo}` +
            (bp.message ? `\n  Message: ${bp.message}` : '')
          );
        }

        case 'remove_breakpoint': {
          if (input.breakpointId === undefined) {
            return this.error('remove_breakpoint requires breakpointId parameter');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const removed = debugManager.removeBreakpoint(session.id, input.breakpointId);
          if (!removed) {
            return this.error(`Breakpoint ${input.breakpointId} does not exist`);
          }
          return this.success(`Breakpoint ${input.breakpointId} removed`);
        }

        case 'list_breakpoints': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          if (session.breakpoints.length === 0) {
            return this.success('No breakpoints in current session');
          }
          const list = session.breakpoints
            .map((bp) => {
              const verified = bp.verified ? '✓' : '○';
              const cond = bp.condition ? ` [condition: ${bp.condition}]` : '';
              return `  [${bp.id}] ${verified} ${bp.file}:${bp.line}${cond}`;
            })
            .join('\n');
          return this.success(`Breakpoint list (${session.breakpoints.length}):\n${list}`);
        }

        case 'continue': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.continueExecution(session.id);
          return this.success('Continued execution, program running...');
        }

        case 'step_over': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.stepOver(session.id);
          return this.success('Step Over executed');
        }

        case 'step_into': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.stepInto(session.id);
          return this.success('Step Into executed');
        }

        case 'step_out': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.stepOut(session.id);
          return this.success('Step Out executed');
        }

        case 'pause': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          await debugManager.pauseExecution(session.id);
          return this.success('Program paused');
        }

        case 'threads': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const threads = await debugManager.getThreads(session.id);
          if (threads.length === 0) {
            return this.success('No active threads');
          }
          const list = threads.map((t) => `  [${t.id}] ${t.name}`).join('\n');
          return this.success(`Thread list (${threads.length}):\n${list}`);
        }

        case 'stack_trace': {
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const frames = await Promise.race([
            debugManager.getStackTrace(session.id, input.frameId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('stack_trace operation timed out')), timeout)
            ),
          ]);
          if (frames.length === 0) {
            return this.success('Call stack is empty (program may be running or terminated)');
          }
          const list = frames
            .map((f, i) => `  ${i === 0 ? '▶' : ' '} [${f.id}] ${f.name}\n      ${f.file}:${f.line}:${f.column}`)
            .join('\n');
          return this.success(`Call stack (${frames.length} frames):\n${list}`);
        }

        case 'scopes': {
          if (input.frameId === undefined) {
            return this.error('scopes requires frameId parameter (obtain from stack_trace results)');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const scopes = await debugManager.getScopes(session.id, input.frameId);
          if (scopes.length === 0) {
            return this.success('No variable scopes available');
          }
          const list = scopes
            .map((s) => `  ${s.name} (variablesReference: ${s.variablesReference}${s.expensive ? ', expensive' : ''})`)
            .join('\n');
          return this.success(`Scope list:\n${list}\n\nUse "variables" with variablesReference to view specific variables.`);
        }

        case 'variables': {
          if (input.variablesReference === undefined) {
            return this.error('variables requires variablesReference parameter (obtain from scopes results)');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const vars = await Promise.race([
            debugManager.getVariables(session.id, input.variablesReference),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('variables operation timed out')), timeout)
            ),
          ]);
          if (vars.length === 0) {
            return this.success('No variables');
          }
          // Format as aligned table
          const maxNameLen = Math.max(...vars.map((v) => v.name.length), 4);
          const maxTypeLen = Math.max(...vars.map((v) => (v.type || '').length), 4);
          const header = `  ${'Name'.padEnd(maxNameLen)}  ${'Type'.padEnd(maxTypeLen)}  Value`;
          const divider = `  ${'-'.repeat(maxNameLen)}  ${'-'.repeat(maxTypeLen)}  ${'-'.repeat(20)}`;
          const rows = vars
            .map((v) => {
              const expandable = v.variablesReference > 0 ? ' [expandable]' : '';
              return `  ${v.name.padEnd(maxNameLen)}  ${(v.type || '').padEnd(maxTypeLen)}  ${v.value}${expandable}`;
            })
            .join('\n');
          return this.success(`Variable list (${vars.length}):\n${header}\n${divider}\n${rows}`);
        }

        case 'evaluate': {
          if (!input.expression) {
            return this.error('evaluate requires expression parameter');
          }
          const session = debugManager.getSession();
          if (!session) {
            return this.error('No active debug session');
          }
          const result = await Promise.race([
            debugManager.evaluate(session.id, input.expression, input.frameId),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('evaluate operation timed out')), timeout)
            ),
          ]);
          return this.success(`Expression: ${input.expression}\nResult: ${result}`);
        }

        default:
          return this.error(`Unknown action: ${(input as any).action}`);
      }
    } catch (error: any) {
      if (error.message?.includes('Cannot find module') && error.message?.includes('ws')) {
        return this.error('ws module not installed, please run: npm install ws');
      }
      if (error.message?.includes('Cannot find module') && error.message?.includes('debugpy')) {
        return this.error('debugpy not installed, please run: pip install debugpy');
      }
      return this.error(`Debugger error: ${error.message || String(error)}`);
    }
  }
}
