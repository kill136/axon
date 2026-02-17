import { spawn, ChildProcess } from 'child_process';
import type { ExecutionResult, RuntimeConfig } from '../types.js';

// Node.js wrapper 脚本，通过 stdin 接收 JSON 行，执行后输出结果
const WRAPPER_SCRIPT = `
const readline = require('readline');
const util = require('util');
const rl = readline.createInterface({ input: process.stdin });
const context = {};
rl.on('line', async (line) => {
  const {code, id} = JSON.parse(line);
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('context', 'with(context) { return (' + code + ') }');
    let result;
    try { result = await fn(context); } catch(e) {
      const fn2 = new AsyncFunction('context', 'with(context) { ' + code + ' }');
      await fn2(context);
      result = undefined;
    }
    const type = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
    const formatted = type === 'object' || type === 'array' ? util.inspect(result, {depth: 3}) : String(result ?? '');
    process.stdout.write(JSON.stringify({id, result: formatted, type, error: null}) + '\\n');
  } catch(e) {
    process.stdout.write(JSON.stringify({id, result: null, type: null, error: e.message}) + '\\n');
  }
});
`.trim();

export class NodeRuntime {
  private config: RuntimeConfig;
  private process: ChildProcess | null = null;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private requestId = 0;
  private buffer = '';

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.process = spawn('node', ['-e', WRAPPER_SCRIPT], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          const pending = this.pendingRequests.get(resp.id);
          if (pending) {
            this.pendingRequests.delete(resp.id);
            pending.resolve(resp);
          }
        } catch {}
      }
    });

    this.process.on('exit', () => {
      // 进程退出时拒绝所有待处理请求
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Node process exited unexpectedly'));
      }
      this.pendingRequests.clear();
      this.process = null;
    });

    // 等待进程就绪（短暂延迟确保进程启动）
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    if (!this.isAlive()) {
      throw new Error('Failed to start Node.js runtime');
    }
  }

  async execute(code: string, timeout: number): Promise<ExecutionResult> {
    // 进程不在运行时自动重启
    if (!this.isAlive()) {
      await this.start();
    }

    const id = ++this.requestId;
    const startTime = Date.now();

    const responsePromise = new Promise<any>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Execution timed out after ${timeout}ms`));
      }, timeout);
    });

    this.process!.stdin!.write(JSON.stringify({ code, id }) + '\n');

    try {
      const resp = await Promise.race([responsePromise, timeoutPromise]);
      const duration = Date.now() - startTime;

      return {
        output: '',
        result: resp.result ?? undefined,
        resultType: resp.type ?? undefined,
        error: resp.error ?? undefined,
        duration,
      };
    } catch (err: any) {
      return {
        output: '',
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null && !this.process.killed;
  }
}
