import { spawn, ChildProcess } from 'child_process';
import type { ExecutionResult, RuntimeConfig } from '../types.js';

// Python wrapper 脚本，通过 stdin 接收 JSON 行，执行后输出结果
const WRAPPER_SCRIPT = `
import sys, json, io, traceback
context = {}
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    req_id = None
    old_stdout = sys.stdout
    try:
        req = json.loads(line)
        code = req['code']
        req_id = req['id']
        sys.stdout = io.StringIO()
        try:
            try:
                result = eval(compile(code, '<repl>', 'eval'), context)
                result_type = type(result).__name__
                result_str = repr(result)
            except SyntaxError:
                exec(compile(code, '<repl>', 'exec'), context)
                result = None
                result_type = 'NoneType'
                result_str = ''
            output = sys.stdout.getvalue()
        finally:
            sys.stdout = old_stdout
        print(json.dumps({'id': req_id, 'result': result_str, 'type': result_type, 'output': output, 'error': None}), flush=True)
    except Exception as e:
        sys.stdout = old_stdout
        print(json.dumps({'id': req_id, 'result': None, 'type': None, 'output': '', 'error': traceback.format_exc()}), flush=True)
`.trim();

// Windows 平台可能使用 python 或 python3
function getPythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

export class PythonRuntime {
  private config: RuntimeConfig;
  private process: ChildProcess | null = null;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private requestId = 0;
  private buffer = '';

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const pythonCmd = getPythonCommand();

    this.process = spawn(pythonCmd, ['-c', WRAPPER_SCRIPT], {
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
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Python process exited unexpectedly'));
      }
      this.pendingRequests.clear();
      this.process = null;
    });

    // 等待进程就绪
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    if (!this.isAlive()) {
      // 尝试备用命令
      throw new Error(
        `Failed to start Python runtime. Make sure Python is installed and accessible as '${pythonCmd}'.`
      );
    }
  }

  async execute(code: string, timeout: number): Promise<ExecutionResult> {
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
        output: resp.output ?? '',
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
