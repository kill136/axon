/**
 * 统一运行时日志系统
 *
 * 拦截三层输出并持久化到文件：
 *   1. console.error / console.warn / console.log
 *   2. process.stderr.write（过滤掉终端控制码和纯 UI 输出）
 *   3. 程序化 API：logger.error/warn/info/debug
 *
 * 日志文件：~/.claude/runtime.log（JSONL，自动轮转）
 * 轮转策略：单文件 2MB，保留 5 个历史文件，总上限 ~12MB
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// 类型定义
// ============================================================================

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  stack?: string;
  data?: unknown;
}

export interface LoggerConfig {
  /** 日志文件路径，默认 ~/.claude/runtime.log */
  logFile?: string;
  /** 单文件最大字节数，默认 2MB */
  maxFileSize?: number;
  /** 保留的轮转文件数量，默认 5 */
  maxFiles?: number;
  /** 是否拦截 console 输出，默认 true */
  interceptConsole?: boolean;
  /** 最低日志级别，默认 info */
  minLevel?: LogLevel;
}

// ============================================================================
// Logger 核心
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const DEFAULT_LOG_FILE = path.join(CLAUDE_DIR, 'runtime.log');
const DEFAULT_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const DEFAULT_MAX_FILES = 5;

// 模块名提取正则：匹配 [ModuleName] 前缀
const MODULE_PATTERN = /^\[([^\]]+)\]\s*/;

// stderr 过滤：跳过终端控制码、纯 ANSI 颜色序列、空行、进度指示符
const STDERR_SKIP_PATTERNS = [
  /^\x1b\[/,                   // ANSI escape 开头（光标移动、颜色等）
  /^\x07$/,                    // Bell（通知）
  /^\.+$/,                     // 纯进度点 "..."
  /^\s*$/,                     // 空白行
  /^> $/,                      // 交互提示符
  /^Resume this session with/, // 退出提示（不是错误）
];

class RuntimeLogger {
  private logFile: string;
  private maxFileSize: number;
  private maxFiles: number;
  private minLevel: number;
  private stream: fs.WriteStream | null = null;
  private currentSize: number = 0;
  private initialized: boolean = false;
  private intercepted: boolean = false;
  private statsCache: { ts: number; hours: number; result: ReturnType<RuntimeLogger['getStats']> } | null = null;
  private static STATS_CACHE_TTL = 30_000; // 30 秒缓存

  // ErrorWatcher hook（仅在 evolve 模式下设置）
  private errorWatcherCallback: ((entry: LogEntry) => void) | null = null;

  // 保存原始方法
  private originalConsoleError: typeof console.error = console.error;
  private originalConsoleWarn: typeof console.warn = console.warn;
  private originalConsoleLog: typeof console.log = console.log;
  private originalStderrWrite: typeof process.stderr.write = process.stderr.write.bind(process.stderr);

  constructor() {
    this.logFile = DEFAULT_LOG_FILE;
    this.maxFileSize = DEFAULT_MAX_SIZE;
    this.maxFiles = DEFAULT_MAX_FILES;
    this.minLevel = LOG_LEVELS.info;
  }

  /**
   * 初始化日志系统
   */
  init(config: LoggerConfig = {}): void {
    if (this.initialized) return;

    this.logFile = config.logFile || DEFAULT_LOG_FILE;
    this.maxFileSize = config.maxFileSize || DEFAULT_MAX_SIZE;
    this.maxFiles = config.maxFiles || DEFAULT_MAX_FILES;
    this.minLevel = LOG_LEVELS[config.minLevel || 'info'];

    // 确保目录存在
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 获取现有文件大小
    try {
      const stat = fs.statSync(this.logFile);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }

    // 打开写入流
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });

    this.initialized = true;

    // 写入启动标记
    this.writeEntry({
      ts: new Date().toISOString(),
      level: 'info',
      module: 'Logger',
      msg: `=== Process started (PID: ${process.pid}) ===`,
    });

    // 拦截 console + stderr
    if (config.interceptConsole !== false) {
      this.interceptAll();
    }

    // 进程退出时 flush
    process.on('exit', () => this.flush());
  }

  /**
   * 拦截 console.error/warn/log + process.stderr.write
   */
  private interceptAll(): void {
    if (this.intercepted) return;
    this.intercepted = true;

    // 标志位：console.error/warn 内部会调 stderr.write，用此标志跳过避免双重记录
    let insideConsole = false;

    // 拦截 console.log：只记录带 [ModuleName] 前缀的结构化日志，
    // 跳过纯 UI 文本输出（Ink 渲染、进度条等）
    const origConsoleLog = this.originalConsoleLog;
    console.log = (...args: any[]) => {
      origConsoleLog.apply(console, args);
      // 只在第一个参数是字符串且带 [Module] 前缀时才记录
      if (args.length > 0 && typeof args[0] === 'string' && MODULE_PATTERN.test(args[0])) {
        this.captureConsole('info', args);
      }
    };

    const origConsoleError = this.originalConsoleError;
    console.error = (...args: any[]) => {
      insideConsole = true;
      origConsoleError.apply(console, args);
      insideConsole = false;
      this.captureConsole('error', args);
    };

    const origConsoleWarn = this.originalConsoleWarn;
    console.warn = (...args: any[]) => {
      insideConsole = true;
      origConsoleWarn.apply(console, args);
      insideConsole = false;
      this.captureConsole('warn', args);
    };

    const self = this;
    const origStderrWrite = this.originalStderrWrite;

    process.stderr.write = function (
      chunk: any,
      encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
      callback?: (err?: Error) => void
    ): boolean {
      // 先正常写出到 stderr
      const result = origStderrWrite.call(
        process.stderr,
        chunk,
        encodingOrCallback as BufferEncoding,
        callback
      );

      // 如果是 console.error/warn 触发的，已经在上面捕获了，跳过
      if (insideConsole) return result;

      // 解析内容
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      // 剥离 ANSI 颜色码后判断是否有价值
      const stripped = text.replace(/\x1b\[[0-9;]*m/g, '').trim();

      if (!stripped) return result;

      // 过滤掉无诊断价值的输出
      const shouldSkip = STDERR_SKIP_PATTERNS.some((p) => p.test(stripped));
      if (shouldSkip) return result;

      // 有价值的 stderr 输出记录为 warn（不确定是否是 error，保守处理）
      self.captureStderr(stripped);

      return result;
    } as typeof process.stderr.write;
  }

  /**
   * 捕获 stderr 直写内容
   */
  private captureStderr(text: string): void {
    let module = 'Stderr';
    let msg = text;

    const moduleMatch = text.match(MODULE_PATTERN);
    if (moduleMatch) {
      module = moduleMatch[1];
      msg = text.slice(moduleMatch[0].length);
    }

    this.writeEntry({
      ts: new Date().toISOString(),
      level: 'warn',
      module,
      msg: msg.trim(),
    });
  }

  /**
   * 解析 console 输出并写入日志
   */
  private captureConsole(level: LogLevel, args: any[]): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const message = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

    // 跳过空消息
    if (!message.trim()) return;

    // 提取模块名
    let module = 'System';
    let msg = message;
    const moduleMatch = message.match(MODULE_PATTERN);
    if (moduleMatch) {
      module = moduleMatch[1];
      msg = message.slice(moduleMatch[0].length);
    }

    // 提取 stack trace（如果参数中有 Error 对象）
    let stack: string | undefined;
    for (const arg of args) {
      if (arg instanceof Error && arg.stack) {
        stack = arg.stack;
        break;
      }
    }

    this.writeEntry({
      ts: new Date().toISOString(),
      level,
      module,
      msg: msg.trim(),
      stack,
    });
  }

  /**
   * 写入一条日志
   */
  private writeEntry(entry: LogEntry): void {
    if (!this.stream) return;

    try {
      const line = JSON.stringify(entry) + '\n';
      const bytes = Buffer.byteLength(line);

      // 检查是否需要轮转
      if (this.currentSize + bytes > this.maxFileSize) {
        this.rotate();
      }

      this.stream.write(line);
      this.currentSize += bytes;
    } catch {
      // 日志系统自身的错误不能再用 console.error，避免无限递归
    }

    // 通知 ErrorWatcher（error 级别）
    if (entry.level === 'error' && this.errorWatcherCallback) {
      try { this.errorWatcherCallback(entry); } catch { /* ErrorWatcher 错误不能影响日志系统 */ }
    }
  }

  /**
   * 日志文件轮转
   * runtime.log -> runtime.log.1 -> runtime.log.2 -> ... -> runtime.log.N (删除)
   */
  private rotate(): void {
    // 关闭当前流
    this.stream?.end();
    this.stream = null;

    // 轮转文件：从最老的开始腾位
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.logFile : `${this.logFile}.${i - 1}`;
      const to = `${this.logFile}.${i}`;
      try {
        if (fs.existsSync(from)) {
          if (fs.existsSync(to)) fs.unlinkSync(to);
          fs.renameSync(from, to);
        }
      } catch {
        // 忽略轮转错误
      }
    }

    // 重新打开流
    this.currentSize = 0;
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }

  /**
   * 刷新并关闭
   */
  flush(): void {
    if (this.stream) {
      this.writeEntry({
        ts: new Date().toISOString(),
        level: 'info',
        module: 'Logger',
        msg: `=== Process exiting (PID: ${process.pid}) ===`,
      });
      this.stream.end();
      this.stream = null;
    }
  }

  // ============================================================================
  // 公共 API：供代码中直接调用（比 console.error 更结构化）
  // ============================================================================

  error(module: string, msg: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: 'error',
      module,
      msg,
    };
    if (data instanceof Error) {
      entry.stack = data.stack;
      entry.data = { message: data.message, code: (data as any).code };
    } else if (data !== undefined) {
      entry.data = data;
    }
    this.writeEntry(entry);
  }

  warn(module: string, msg: string, data?: unknown): void {
    this.writeEntry({
      ts: new Date().toISOString(),
      level: 'warn',
      module,
      msg,
      data: data !== undefined ? data : undefined,
    });
  }

  info(module: string, msg: string, data?: unknown): void {
    this.writeEntry({
      ts: new Date().toISOString(),
      level: 'info',
      module,
      msg,
      data: data !== undefined ? data : undefined,
    });
  }

  debug(module: string, msg: string, data?: unknown): void {
    this.writeEntry({
      ts: new Date().toISOString(),
      level: 'debug',
      module,
      msg,
      data: data !== undefined ? data : undefined,
    });
  }

  /**
   * 设置 ErrorWatcher 回调（由 ErrorWatcher 模块在 evolve 模式下注入）
   */
  setErrorWatcher(callback: (entry: LogEntry) => void): void {
    this.errorWatcherCallback = callback;
  }

  /**
   * 获取日志文件路径
   */
  getLogFile(): string {
    return this.logFile;
  }

  /**
   * 读取最近的日志条目（从文件尾部高效读取）
   */
  readRecent(count: number = 100): LogEntry[] {
    return this.readRecentFromFile(this.logFile, count);
  }

  /**
   * 从指定日志文件尾部读取条目
   */
  private readRecentFromFile(file: string, count: number): LogEntry[] {
    try {
      if (!fs.existsSync(file)) return [];

      const stat = fs.statSync(file);
      if (stat.size === 0) return [];

      // 从尾部读取足够的字节（平均每行 ~300 字节，多读 50% 余量）
      const readSize = Math.min(stat.size, count * 450);
      const fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
      fs.closeSync(fd);

      let content = buffer.toString('utf-8');

      // 如果从文件中间开始读取，切割点可能落在 UTF-8 多字节字符中间
      // 找到第一个换行符，从下一完整行开始，确保 JSON 不会被截断
      if (readSize < stat.size) {
        const firstNewline = content.indexOf('\n');
        if (firstNewline >= 0) {
          content = content.slice(firstNewline + 1);
        }
      }

      const lines = content.split('\n').filter(Boolean);
      const recent = lines.slice(-count);

      return recent.map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return { ts: '', level: 'info' as LogLevel, module: 'Unknown', msg: line };
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * 按级别统计最近日志
   */
  getStats(hours: number = 24): { total: number; errors: number; warns: number; topModules: Record<string, number> } {
    // 30 秒缓存：避免高频构建系统提示词时反复读文件
    const now = Date.now();
    if (this.statsCache && this.statsCache.hours === hours && (now - this.statsCache.ts) < RuntimeLogger.STATS_CACHE_TTL) {
      return this.statsCache.result;
    }

    const cutoff = new Date(now - hours * 60 * 60 * 1000).toISOString();

    // 读当前文件
    let entries = this.readRecentFromFile(this.logFile, 10000).filter((e) => e.ts >= cutoff);

    // 同时读最近一个轮转文件，避免轮转后统计短暂失真
    const rotatedFile = `${this.logFile}.1`;
    try {
      const rotatedEntries = this.readRecentFromFile(rotatedFile, 5000).filter((e) => e.ts >= cutoff);
      if (rotatedEntries.length > 0) {
        entries = [...rotatedEntries, ...entries];
      }
    } catch {
      // 轮转文件不存在或读取失败，忽略
    }

    const topModules: Record<string, number> = {};
    let errors = 0;
    let warns = 0;

    for (const entry of entries) {
      if (entry.level === 'error') errors++;
      if (entry.level === 'warn') warns++;
      topModules[entry.module] = (topModules[entry.module] || 0) + 1;
    }

    // 按频率排序，保留前 10
    const sorted = Object.entries(topModules)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const result = {
      total: entries.length,
      errors,
      warns,
      topModules: Object.fromEntries(sorted),
    };

    this.statsCache = { ts: now, hours, result };
    return result;
  }

  /**
   * 获取最近的 error 级别日志（用于实时注入系统提示词）
   * @param maxAgeMs 最大时间范围（毫秒），默认 5 分钟
   * @param limit 最多返回条数，默认 5
   */
  getRecentErrors(maxAgeMs: number = 5 * 60 * 1000, limit: number = 5): LogEntry[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const entries = this.readRecent(500);
    return entries
      .filter(e => e.level === 'error' && e.ts >= cutoff)
      .slice(-limit);
  }
}

// 单例导出
export const logger = new RuntimeLogger();
