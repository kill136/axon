export interface REPLInput {
  action: 'start' | 'execute' | 'stop' | 'list' | 'reset';
  session?: string;  // 会话名称
  runtime?: 'node' | 'python';  // 运行时
  code?: string;  // 要执行的代码
  timeout?: number;  // 执行超时毫秒，默认 30000
  cwd?: string;  // 工作目录
  env?: Record<string, string>;  // 环境变量
}

export interface ExecutionResult {
  output: string;  // stdout 输出
  result?: string;  // 表达式值（格式化后）
  resultType?: string;  // 结果类型（string/number/object/array/etc）
  error?: string;  // 错误信息
  duration: number;  // 执行时间毫秒
}

export interface SessionInfo {
  name: string;
  runtime: 'node' | 'python';
  pid: number;
  createdAt: Date;
  lastUsed: Date;
  execCount: number;
}

export interface RuntimeConfig {
  runtime: 'node' | 'python';
  cwd: string;
  env: Record<string, string>;
  timeout: number;
}
