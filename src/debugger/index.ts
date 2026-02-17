import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as http from 'http';
import type { DebugSession, Breakpoint, StackFrame, Scope, Variable, DebuggerInput } from './types.js';

// 内部扩展的会话类型
interface InternalSession extends DebugSession {
  process: ChildProcess;
  client: any;
  cdpPort?: number;
  pendingBreakpoints: Array<{ file: string; line: number; condition?: string; hitCondition?: string }>;
}

export class DebugManager extends EventEmitter {
  private sessions: Map<string, InternalSession> = new Map();
  private breakpointIdCounter = 1;

  // 获取随机可用端口
  async getAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
    });
  }

  // 启动调试会话
  async launch(input: DebuggerInput): Promise<DebugSession> {
    if (!input.program) throw new Error('launch 需要提供 program 参数');
    const id = `session-${Date.now()}`;
    const runtime = input.runtime || 'node';
    const port = await this.getAvailablePort();

    if (runtime === 'node') {
      const proc = spawn('node', [`--inspect-brk=${port}`, input.program, ...(input.args || [])], {
        cwd: input.cwd || process.cwd(),
        env: { ...process.env, ...input.env } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 等待 debugger 监听就绪
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Node debugger start timeout')), 10000);
        proc.stderr!.on('data', (data: Buffer) => {
          if (data.toString().includes('Debugger listening')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        proc.on('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`进程意外退出，exit code: ${code}`));
        });
      });

      // 尝试通过 CDP WebSocket 连接
      let cdpClient: any = null;
      try {
        cdpClient = await this.connectCDP(port);
      } catch (_) {
        // CDP 连接失败不阻止会话创建
      }

      const session: DebugSession = {
        id,
        runtime,
        program: input.program,
        pid: proc.pid,
        state: 'paused',
        breakpoints: [],
      };

      const internal: InternalSession = {
        ...session,
        process: proc,
        client: cdpClient,
        cdpPort: port,
        pendingBreakpoints: [],
      };

      proc.on('exit', () => {
        const s = this.sessions.get(id);
        if (s) {
          s.state = 'terminated';
        }
      });

      this.sessions.set(id, internal);
      return session;
    } else {
      // Python debugpy
      const proc = spawn('python', [
        '-m', 'debugpy',
        '--listen', `localhost:${port}`,
        '--wait-for-client',
        input.program,
        ...(input.args || []),
      ], {
        cwd: input.cwd || process.cwd(),
        env: { ...process.env, ...input.env } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 等待 debugpy 就绪
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const dapClient = await this.connectDAPOverTCP('localhost', port);

      const session: DebugSession = {
        id,
        runtime,
        program: input.program,
        pid: proc.pid,
        state: 'paused',
        breakpoints: [],
      };

      const internal: InternalSession = {
        ...session,
        process: proc,
        client: dapClient,
        pendingBreakpoints: [],
      };

      proc.on('exit', () => {
        const s = this.sessions.get(id);
        if (s) {
          s.state = 'terminated';
        }
      });

      this.sessions.set(id, internal);
      return session;
    }
  }

  // 通过 CDP WebSocket 连接 Node.js 调试器
  private async connectCDP(port: number): Promise<any> {
    // 获取 CDP 端点
    const response = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = '';
        res.on('data', (chunk: any) => (data += chunk));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => reject(new Error('CDP endpoint timeout')));
    });

    const endpoints = JSON.parse(response);
    if (!endpoints || endpoints.length === 0) throw new Error('No CDP endpoints found');
    const wsUrl = endpoints[0].webSocketDebuggerUrl;

    const { WebSocket } = await import('ws');
    const ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      const client = {
        ws,
        seq: 1,
        pending: new Map<number, { resolve: Function; reject: Function }>(),
        send(method: string, params?: any): Promise<any> {
          const id = this.seq++;
          const msg = JSON.stringify({ id, method, params: params || {} });
          this.ws.send(msg);
          return new Promise((res, rej) => {
            this.pending.set(id, { resolve: res, reject: rej });
          });
        },
      };

      ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== undefined) {
            const pending = client.pending.get(msg.id);
            if (pending) {
              client.pending.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error.message));
              } else {
                pending.resolve(msg.result);
              }
            }
          }
        } catch (_) {}
      });

      ws.on('open', () => resolve(client));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), 5000);
    });
  }

  // 通过 TCP Socket 连接 DAP（用于 Python/debugpy）
  private async connectDAPOverTCP(host: string, port: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      let buffer = Buffer.alloc(0);
      let seq = 1;
      const pending = new Map<number, { resolve: Function; reject: Function }>();

      const client = {
        socket,
        async initialize(): Promise<any> {
          return this.sendRequest('initialize', {
            clientID: 'claude-code',
            adapterID: 'generic',
            pathFormat: 'path',
            linesStartAt1: true,
            columnsStartAt1: true,
            supportsVariableType: true,
          });
        },
        sendRequest(command: string, args?: any): Promise<any> {
          const id = seq++;
          const message = { seq: id, type: 'request', command, arguments: args };
          const content = JSON.stringify(message);
          const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
          socket.write(header + content);
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
          });
        },
        disconnect() {
          socket.destroy();
        },
      };

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) break;
          const header = buffer.slice(0, headerEnd).toString();
          const match = header.match(/Content-Length: (\d+)/);
          if (!match) break;
          const contentLength = parseInt(match[1]);
          const messageStart = headerEnd + 4;
          if (buffer.length < messageStart + contentLength) break;
          const msgStr = buffer.slice(messageStart, messageStart + contentLength).toString();
          buffer = buffer.slice(messageStart + contentLength);
          try {
            const msg = JSON.parse(msgStr);
            if (msg.type === 'response') {
              const p = pending.get(msg.request_seq);
              if (p) {
                pending.delete(msg.request_seq);
                if (msg.success) {
                  p.resolve(msg.body || {});
                } else {
                  p.reject(new Error(msg.message || 'DAP request failed'));
                }
              }
            }
          } catch (_) {}
        }
      });

      socket.on('connect', () => resolve(client));
      socket.on('error', reject);
      setTimeout(() => reject(new Error('DAP TCP connect timeout')), 10000);
    });
  }

  // 设置断点
  async setBreakpoint(sessionId: string, file: string, line: number, condition?: string, hitCondition?: string): Promise<Breakpoint> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    const bp: Breakpoint = {
      id: this.breakpointIdCounter++,
      file,
      line,
      condition,
      hitCondition,
      verified: false,
    };

    if (session.runtime === 'node' && session.client) {
      try {
        // CDP: Debugger.setBreakpointByUrl
        const result = await session.client.send('Debugger.setBreakpointByUrl', {
          lineNumber: line - 1,
          url: `file://${file.replace(/\\/g, '/')}`,
          condition: condition,
        });
        bp.verified = true;
        bp.message = `CDP breakpointId: ${result.breakpointId}`;
      } catch (e: any) {
        bp.message = `设置失败: ${e.message}`;
      }
    } else if (session.runtime === 'python' && session.client) {
      try {
        const result = await session.client.sendRequest('setBreakpoints', {
          source: { path: file },
          breakpoints: [{ line, condition, hitCondition }],
        });
        if (result.breakpoints && result.breakpoints[0]) {
          bp.verified = result.breakpoints[0].verified;
        }
      } catch (e: any) {
        bp.message = `设置失败: ${e.message}`;
      }
    } else {
      // 无活跃连接，记录为 pending
      session.pendingBreakpoints.push({ file, line, condition, hitCondition });
      bp.message = '已记录，将在连接后应用';
    }

    session.breakpoints.push(bp);
    return bp;
  }

  // 移除断点
  removeBreakpoint(sessionId: string, breakpointId: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);
    const idx = session.breakpoints.findIndex((b) => b.id === breakpointId);
    if (idx === -1) return false;
    session.breakpoints.splice(idx, 1);
    return true;
  }

  // 获取调用栈
  async getStackTrace(sessionId: string, frameId?: number): Promise<StackFrame[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'node' && session.client) {
      try {
        const result = await session.client.send('Debugger.getStackTrace', {});
        return (result.stackTrace?.callFrames || []).map((frame: any, i: number) => ({
          id: i,
          name: frame.functionName || '(anonymous)',
          file: frame.url?.replace('file://', '') || '',
          line: (frame.location?.lineNumber || 0) + 1,
          column: (frame.location?.columnNumber || 0) + 1,
        }));
      } catch (_) {
        return [];
      }
    } else if (session.runtime === 'python' && session.client) {
      try {
        const threadsResult = await session.client.sendRequest('threads');
        const threadId = threadsResult.threads?.[0]?.id || 1;
        const result = await session.client.sendRequest('stackTrace', { threadId });
        return (result.stackFrames || []).map((frame: any) => ({
          id: frame.id,
          name: frame.name,
          file: frame.source?.path || '',
          line: frame.line,
          column: frame.column,
        }));
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  // 获取作用域
  async getScopes(sessionId: string, frameId: number): Promise<Scope[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'python' && session.client) {
      try {
        const result = await session.client.sendRequest('scopes', { frameId });
        return (result.scopes || []).map((scope: any) => ({
          name: scope.name,
          variablesReference: scope.variablesReference,
          expensive: scope.expensive || false,
        }));
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  // 获取变量
  async getVariables(sessionId: string, variablesReference: number): Promise<Variable[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'python' && session.client) {
      try {
        const result = await session.client.sendRequest('variables', { variablesReference });
        return (result.variables || []).map((v: any) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: v.variablesReference,
          indexedVariables: v.indexedVariables,
          namedVariables: v.namedVariables,
        }));
      } catch (_) {
        return [];
      }
    } else if (session.runtime === 'node' && session.client) {
      try {
        const result = await session.client.send('Runtime.getProperties', {
          objectId: String(variablesReference),
          ownProperties: true,
        });
        return (result.result || []).map((prop: any) => ({
          name: prop.name,
          value: prop.value?.value !== undefined ? String(prop.value.value) : prop.value?.description || 'undefined',
          type: prop.value?.type,
          variablesReference: 0,
        }));
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  // 执行表达式
  async evaluate(sessionId: string, expression: string, frameId?: number): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'node' && session.client) {
      try {
        const result = await session.client.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
        });
        if (result.exceptionDetails) {
          return `Error: ${result.exceptionDetails.text}`;
        }
        return JSON.stringify(result.result?.value ?? result.result?.description ?? 'undefined');
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    } else if (session.runtime === 'python' && session.client) {
      try {
        const result = await session.client.sendRequest('evaluate', {
          expression,
          frameId,
          context: 'repl',
        });
        return result.result || 'undefined';
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    }
    return 'No active debug connection';
  }

  // 继续执行
  async continueExecution(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);
    session.state = 'running';

    if (session.runtime === 'node' && session.client) {
      await session.client.send('Debugger.resume');
    } else if (session.runtime === 'python' && session.client) {
      const threadsResult = await session.client.sendRequest('threads');
      const threadId = threadsResult.threads?.[0]?.id || 1;
      await session.client.sendRequest('continue', { threadId });
    }
  }

  // 单步跳过
  async stepOver(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'node' && session.client) {
      await session.client.send('Debugger.stepOver');
    } else if (session.runtime === 'python' && session.client) {
      const threadsResult = await session.client.sendRequest('threads');
      const threadId = threadsResult.threads?.[0]?.id || 1;
      await session.client.sendRequest('next', { threadId });
    }
  }

  // 单步进入
  async stepInto(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'node' && session.client) {
      await session.client.send('Debugger.stepInto');
    } else if (session.runtime === 'python' && session.client) {
      const threadsResult = await session.client.sendRequest('threads');
      const threadId = threadsResult.threads?.[0]?.id || 1;
      await session.client.sendRequest('stepIn', { threadId });
    }
  }

  // 单步跳出
  async stepOut(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'node' && session.client) {
      await session.client.send('Debugger.stepOut');
    } else if (session.runtime === 'python' && session.client) {
      const threadsResult = await session.client.sendRequest('threads');
      const threadId = threadsResult.threads?.[0]?.id || 1;
      await session.client.sendRequest('stepOut', { threadId });
    }
  }

  // 暂停执行
  async pauseExecution(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);
    session.state = 'paused';

    if (session.runtime === 'node' && session.client) {
      await session.client.send('Debugger.pause');
    } else if (session.runtime === 'python' && session.client) {
      const threadsResult = await session.client.sendRequest('threads');
      const threadId = threadsResult.threads?.[0]?.id || 1;
      await session.client.sendRequest('pause', { threadId });
    }
  }

  // 获取线程列表
  async getThreads(sessionId: string): Promise<Array<{ id: number; name: string }>> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    if (session.runtime === 'python' && session.client) {
      try {
        const result = await session.client.sendRequest('threads');
        return result.threads || [];
      } catch (_) {
        return [];
      }
    }
    // Node.js 是单线程模型
    return [{ id: 1, name: 'main' }];
  }

  // 断开连接并清理
  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    try {
      if (session.runtime === 'node' && session.client) {
        session.client.ws?.close?.();
      } else if (session.runtime === 'python' && session.client) {
        await session.client.sendRequest('disconnect', { terminateDebuggee: true }).catch(() => {});
        session.client.disconnect?.();
      }
    } catch (_) {}

    session.process.kill();
    session.state = 'terminated';
    this.sessions.delete(sessionId);
  }

  // 获取会话（无参数返回最近一个）
  getSession(sessionId?: string): DebugSession | undefined {
    if (sessionId) {
      const s = this.sessions.get(sessionId);
      if (!s) return undefined;
      const { process: _p, client: _c, pendingBreakpoints: _pb, cdpPort: _cp, ...session } = s;
      return session;
    }
    // 返回最后一个会话
    const sessions = Array.from(this.sessions.values());
    if (sessions.length === 0) return undefined;
    const last = sessions[sessions.length - 1];
    const { process: _p, client: _c, pendingBreakpoints: _pb, cdpPort: _cp, ...session } = last;
    return session;
  }

  // 列出所有会话 ID
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}

export const debugManager = new DebugManager();
