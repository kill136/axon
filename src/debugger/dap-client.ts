import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export class DAPClient extends EventEmitter {
  private process!: ChildProcess;
  private buffer: Buffer = Buffer.alloc(0);
  private seq: number = 1;
  private pendingRequests: Map<number, { resolve: Function; reject: Function; timer: NodeJS.Timeout }> = new Map();

  constructor(private adapterPath: string, private adapterArgs: string[]) {
    super();
  }

  async start(): Promise<void> {
    this.process = spawn(this.adapterPath, this.adapterArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdout!.on('data', (chunk: Buffer) => this.handleData(chunk));
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = this.buffer.slice(0, headerEnd).toString();
      const match = header.match(/Content-Length: (\d+)/);
      if (!match) break;
      const contentLength = parseInt(match[1]);
      const messageStart = headerEnd + 4;
      if (this.buffer.length < messageStart + contentLength) break;
      const messageStr = this.buffer.slice(messageStart, messageStart + contentLength).toString();
      this.buffer = this.buffer.slice(messageStart + contentLength);
      try {
        const message = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch (_) {
        // 解析失败跳过
      }
    }
  }

  private handleMessage(message: any): void {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.request_seq);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.request_seq);
        if (message.success) {
          pending.resolve(message.body || {});
        } else {
          pending.reject(new Error(message.message || 'DAP request failed'));
        }
      }
    } else if (message.type === 'event') {
      this.emit(message.event, message.body);
    }
  }

  async sendRequest(command: string, args?: any, timeout = 30000): Promise<any> {
    const seq = this.seq++;
    const message = { seq, type: 'request', command, arguments: args };
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin!.write(header + content);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(seq);
        reject(new Error(`DAP request ${command} timed out`));
      }, timeout);
      this.pendingRequests.set(seq, { resolve, reject, timer });
    });
  }

  async initialize(): Promise<any> {
    return this.sendRequest('initialize', {
      clientID: 'claude-code',
      adapterID: 'generic',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
  }

  async launch(args: any): Promise<void> { await this.sendRequest('launch', args); }
  async attach(args: any): Promise<void> { await this.sendRequest('attach', args); }
  async setBreakpoints(args: any): Promise<any> { return this.sendRequest('setBreakpoints', args); }
  async configurationDone(): Promise<void> { await this.sendRequest('configurationDone'); }
  async continue(args: any): Promise<any> { return this.sendRequest('continue', args); }
  async next(args: any): Promise<any> { return this.sendRequest('next', args); }
  async stepIn(args: any): Promise<any> { return this.sendRequest('stepIn', args); }
  async stepOut(args: any): Promise<any> { return this.sendRequest('stepOut', args); }
  async pause(args: any): Promise<any> { return this.sendRequest('pause', args); }
  async threads(): Promise<any> { return this.sendRequest('threads'); }
  async stackTrace(args: any): Promise<any> { return this.sendRequest('stackTrace', args); }
  async scopes(args: any): Promise<any> { return this.sendRequest('scopes', args); }
  async variables(args: any): Promise<any> { return this.sendRequest('variables', args); }
  async evaluate(args: any): Promise<any> { return this.sendRequest('evaluate', args); }
  async disconnect(args?: any): Promise<void> { await this.sendRequest('disconnect', args || { terminateDebuggee: true }); }

  stop(): void {
    this.process.kill();
  }
}
