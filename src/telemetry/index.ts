/**
 * 遥测系统
 * 跟踪使用统计和事件（本地存储，支持批量上报）
 *
 * 特性:
 * - 匿名使用统计
 * - 错误报告 (opt-in)
 * - 性能指标收集
 * - 功能使用追踪
 * - 隐私保护 (不收集敏感信息)
 * - 本地存储 (离线模式)
 * - 批量上报
 * - 禁用选项 (AXON_DISABLE_TELEMETRY)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomBytes } from 'crypto';

export interface TelemetryEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  anonymousId: string;
  data: Record<string, unknown>;
  version?: string;
  platform?: string;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  messageCount: number;
  toolCalls: Record<string, number>;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  estimatedCost: number;
  model: string;
  errors: number;
}

export interface AggregateMetrics {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  toolUsage: Record<string, number>;
  commandUsage: Record<string, number>;
  modelUsage: Record<string, number>;
  averageSessionDuration: number;
  totalErrors: number;
  errorTypes: Record<string, number>;
  lastUpdated: number;
}

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface ErrorReport {
  errorType: string;
  errorMessage: string;
  stack?: string;
  context: Record<string, unknown>;
  timestamp: number;
  sessionId: string;
  anonymousId: string;
}

export interface TelemetryConfig {
  enabled: boolean;
  errorReporting: boolean;
  performanceTracking: boolean;
  batchUpload: boolean;
  uploadInterval: number; // milliseconds
  maxBatchSize: number;
  endpoint?: string;
}

// 遥测配置
const TELEMETRY_DIR = path.join(os.homedir(), '.axon', 'telemetry');
const METRICS_FILE = path.join(TELEMETRY_DIR, 'metrics.json');
const EVENTS_FILE = path.join(TELEMETRY_DIR, 'events.jsonl');
const ERRORS_FILE = path.join(TELEMETRY_DIR, 'errors.jsonl');
const PERFORMANCE_FILE = path.join(TELEMETRY_DIR, 'performance.jsonl');
const QUEUE_FILE = path.join(TELEMETRY_DIR, 'queue.jsonl');
const ANONYMOUS_ID_FILE = path.join(TELEMETRY_DIR, 'anonymous_id');
const CONFIG_FILE = path.join(TELEMETRY_DIR, 'config.json');
const MAX_EVENTS = 10000;
const MAX_QUEUE_SIZE = 1000;
const DEFAULT_UPLOAD_INTERVAL = 3600000; // 1 hour
const DEFAULT_BATCH_SIZE = 100;

// 检查环境变量
const TELEMETRY_DISABLED =
  process.env.AXON_DISABLE_TELEMETRY === '1' ||
  process.env.AXON_DISABLE_TELEMETRY === 'true' ||
  process.env.DISABLE_TELEMETRY === '1' ||
  process.env.DISABLE_TELEMETRY === 'true';

// 敏感数据正则模式
const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, // IP address
  /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, // IPv6
  /\bsk-[a-zA-Z0-9]{32,}\b/g, // API keys (Anthropic style)
  /\b[A-Za-z0-9_-]{20,}\b/g, // Generic tokens
  /\/home\/[a-zA-Z0-9_-]+/g, // Home paths
  /\/Users\/[a-zA-Z0-9_-]+/g, // Mac paths
  /C:\\Users\\[a-zA-Z0-9_-]+/g, // Windows paths
];

// 全局状态
let telemetryConfig: TelemetryConfig = {
  enabled: !TELEMETRY_DISABLED,
  errorReporting: false, // Opt-in
  performanceTracking: true,
  batchUpload: false,
  uploadInterval: DEFAULT_UPLOAD_INTERVAL,
  maxBatchSize: DEFAULT_BATCH_SIZE,
};

let anonymousId: string = '';
let currentSession: SessionMetrics | null = null;
let uploadTimer: NodeJS.Timeout | null = null;
let eventQueue: TelemetryEvent[] = [];

/**
 * 隐私保护：清洗敏感数据
 */
function sanitizeData(data: unknown): unknown {
  if (typeof data === 'string') {
    let sanitized = data;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  if (data && typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // 跳过敏感字段
      if (
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('auth')
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeData(value);
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * 获取或创建匿名 ID
 */
function getAnonymousId(): string {
  try {
    if (fs.existsSync(ANONYMOUS_ID_FILE)) {
      return fs.readFileSync(ANONYMOUS_ID_FILE, 'utf-8').trim();
    }

    // 生成新的匿名 ID（基于机器信息的哈希）
    const machineInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.homedir(),
    ].join('|');

    const hash = createHash('sha256').update(machineInfo).digest('hex');
    const id = `anon_${hash.substring(0, 32)}`;

    fs.writeFileSync(ANONYMOUS_ID_FILE, id);
    return id;
  } catch (err) {
    // 如果无法创建持久 ID，使用随机 ID
    return `temp_${randomBytes(16).toString('hex')}`;
  }
}

/**
 * 加载配置
 */
function loadConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      telemetryConfig = { ...telemetryConfig, ...config };
    }
  } catch (err) {
    // 使用默认配置
  }
}

/**
 * 保存配置
 */
function saveConfig(): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(telemetryConfig, null, 2));
  } catch (err) {
    // 静默失败
  }
}

/**
 * 初始化遥测系统
 */
export function initTelemetry(enabled?: boolean): void {
  // 创建目录
  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  }

  // 加载配置
  loadConfig();

  // 覆盖启用状态
  if (enabled !== undefined) {
    telemetryConfig.enabled = enabled && !TELEMETRY_DISABLED;
  }

  if (!telemetryConfig.enabled) return;

  // 获取匿名 ID
  anonymousId = getAnonymousId();

  // 初始化指标文件
  if (!fs.existsSync(METRICS_FILE)) {
    const initialMetrics: AggregateMetrics = {
      totalSessions: 0,
      totalMessages: 0,
      totalTokens: 0,
      totalCost: 0,
      toolUsage: {},
      commandUsage: {},
      modelUsage: {},
      averageSessionDuration: 0,
      totalErrors: 0,
      errorTypes: {},
      lastUpdated: Date.now(),
    };
    fs.writeFileSync(METRICS_FILE, JSON.stringify(initialMetrics, null, 2));
  }

  // 恢复队列
  loadQueue();

  // 启动批量上报定时器
  if (telemetryConfig.batchUpload && telemetryConfig.endpoint) {
    startUploadTimer();
  }
}

/**
 * 加载队列
 */
function loadQueue(): void {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      eventQueue = lines.map((line) => JSON.parse(line));
    }
  } catch (err) {
    eventQueue = [];
  }
}

/**
 * 保存队列
 */
function saveQueue(): void {
  try {
    const content = eventQueue.map((event) => JSON.stringify(event)).join('\n') + '\n';
    fs.writeFileSync(QUEUE_FILE, content);
  } catch (err) {
    // 静默失败
  }
}

/**
 * 启动批量上报定时器
 */
function startUploadTimer(): void {
  if (uploadTimer) {
    clearInterval(uploadTimer);
  }

  uploadTimer = setInterval(() => {
    uploadBatch();
  }, telemetryConfig.uploadInterval);
}

/**
 * 批量上报
 */
async function uploadBatch(): Promise<void> {
  if (!telemetryConfig.endpoint || eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, telemetryConfig.maxBatchSize);

  try {
    // 这里应该实现实际的上报逻辑
    // 例如使用 fetch 或 axios 发送到服务器
    // const response = await fetch(telemetryConfig.endpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(batch),
    // });

    // 如果上报成功，保存队列
    saveQueue();
  } catch (err) {
    // 上报失败，将事件放回队列
    eventQueue.unshift(...batch);

    // 限制队列大小
    if (eventQueue.length > MAX_QUEUE_SIZE) {
      eventQueue = eventQueue.slice(-MAX_QUEUE_SIZE);
    }
  }
}

/**
 * 获取版本信息
 */
function getVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')
    );
    return packageJson.version || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * 开始新会话
 */
export function startSession(sessionId: string, model: string): void {
  if (!telemetryConfig.enabled) return;

  currentSession = {
    sessionId,
    startTime: Date.now(),
    messageCount: 0,
    toolCalls: {},
    tokenUsage: { input: 0, output: 0, total: 0 },
    estimatedCost: 0,
    model,
    errors: 0,
  };

  trackEvent('session_start', { model });
}

/**
 * 结束会话
 */
export function endSession(): void {
  if (!telemetryConfig.enabled || !currentSession) return;

  currentSession.endTime = Date.now();

  trackEvent('session_end', {
    duration: currentSession.endTime - currentSession.startTime,
    messageCount: currentSession.messageCount,
    tokenUsage: currentSession.tokenUsage,
    estimatedCost: currentSession.estimatedCost,
  });

  // 更新聚合指标
  updateAggregateMetrics();

  // 立即上报（如果启用）
  if (telemetryConfig.batchUpload) {
    uploadBatch().catch(() => {
      // 忽略错误
    });
  }

  currentSession = null;
}

/**
 * 跟踪事件
 */
export function trackEvent(type: string, data: Record<string, unknown> = {}): void {
  if (!telemetryConfig.enabled) return;

  // 清洗敏感数据
  const sanitizedData = sanitizeData(data) as Record<string, unknown>;

  const event: TelemetryEvent = {
    type,
    timestamp: Date.now(),
    sessionId: currentSession?.sessionId || 'unknown',
    anonymousId,
    data: sanitizedData,
    version: getVersion(),
    platform: os.platform(),
  };

  // 追加到事件文件
  try {
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // 限制事件文件大小
    trimEventsFile();
  } catch (err) {
    // 静默失败
  }

  // 添加到队列（用于批量上报）
  if (telemetryConfig.batchUpload) {
    eventQueue.push(event);

    // 限制队列大小
    if (eventQueue.length > MAX_QUEUE_SIZE) {
      eventQueue.shift();
    }

    // 保存队列
    saveQueue();
  }
}

/**
 * 跟踪消息
 */
export function trackMessage(role: 'user' | 'assistant'): void {
  if (!telemetryConfig.enabled || !currentSession) return;

  currentSession.messageCount++;
  trackEvent('message', { role });
}

/**
 * 跟踪工具调用
 */
export function trackToolCall(
  toolName: string,
  success: boolean,
  duration: number
): void {
  if (!telemetryConfig.enabled || !currentSession) return;

  currentSession.toolCalls[toolName] = (currentSession.toolCalls[toolName] || 0) + 1;

  if (!success) {
    currentSession.errors++;
  }

  trackEvent('tool_call', { toolName, success, duration });

  // 记录性能指标
  if (telemetryConfig.performanceTracking) {
    trackPerformance(toolName, duration, success);
  }
}

/**
 * 跟踪 Harness 工具过滤效率
 * 记录 progressive disclosure 的实际效果
 */
export function trackToolFiltering(data: {
  totalTools: number;
  filteredTools: number;
  deferredTotal: number;
  deferredLoaded: number;
  discoveredCount: number;
}): void {
  if (!telemetryConfig.enabled) return;
  trackEvent('harness_tool_filtering', data);
}

/**
 * 跟踪命令使用
 */
export function trackCommand(commandName: string, success: boolean, duration: number): void {
  if (!telemetryConfig.enabled) return;

  trackEvent('command_use', { commandName, success, duration });

  // 记录性能指标
  if (telemetryConfig.performanceTracking) {
    trackPerformance(`command:${commandName}`, duration, success);
  }
}

/**
 * 跟踪 token 使用
 */
export function trackTokenUsage(input: number, output: number, cost: number): void {
  if (!telemetryConfig.enabled || !currentSession) return;

  currentSession.tokenUsage.input += input;
  currentSession.tokenUsage.output += output;
  currentSession.tokenUsage.total += input + output;
  currentSession.estimatedCost += cost;

  trackEvent('token_usage', { input, output, cost });
}

/**
 * 跟踪错误
 */
export function trackError(error: string, context?: Record<string, unknown>): void {
  if (!telemetryConfig.enabled) return;

  if (currentSession) {
    currentSession.errors++;
  }

  trackEvent('error', { error, ...context });
}

/**
 * 跟踪详细错误报告 (opt-in)
 */
export function trackErrorReport(
  error: Error,
  context: Record<string, unknown> = {}
): void {
  if (!telemetryConfig.enabled || !telemetryConfig.errorReporting) return;

  const sanitizedContext = sanitizeData(context) as Record<string, unknown>;

  const report: ErrorReport = {
    errorType: error.name,
    errorMessage: error.message,
    stack: error.stack,
    context: sanitizedContext,
    timestamp: Date.now(),
    sessionId: currentSession?.sessionId || 'unknown',
    anonymousId,
  };

  // 保存到错误文件
  try {
    fs.appendFileSync(ERRORS_FILE, JSON.stringify(report) + '\n');
    trimFile(ERRORS_FILE, MAX_EVENTS);
  } catch (err) {
    // 静默失败
  }

  // 跟踪错误事件
  trackError(error.name, { message: error.message });
}

/**
 * 跟踪性能指标
 */
export function trackPerformance(
  operation: string,
  duration: number,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  if (!telemetryConfig.enabled || !telemetryConfig.performanceTracking) return;

  const sanitizedMetadata = metadata
    ? (sanitizeData(metadata) as Record<string, unknown>)
    : undefined;

  const metric: PerformanceMetric = {
    operation,
    duration,
    timestamp: Date.now(),
    success,
    metadata: sanitizedMetadata,
  };

  // 保存到性能文件
  try {
    fs.appendFileSync(PERFORMANCE_FILE, JSON.stringify(metric) + '\n');
    trimFile(PERFORMANCE_FILE, MAX_EVENTS);
  } catch (err) {
    // 静默失败
  }
}

/**
 * 更新聚合指标
 */
function updateAggregateMetrics(): void {
  if (!currentSession) return;

  try {
    let metrics: AggregateMetrics;

    if (fs.existsSync(METRICS_FILE)) {
      metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
    } else {
      metrics = {
        totalSessions: 0,
        totalMessages: 0,
        totalTokens: 0,
        totalCost: 0,
        toolUsage: {},
        commandUsage: {},
        modelUsage: {},
        averageSessionDuration: 0,
        totalErrors: 0,
        errorTypes: {},
        lastUpdated: Date.now(),
      };
    }

    // 更新指标
    metrics.totalSessions++;
    metrics.totalMessages += currentSession.messageCount;
    metrics.totalTokens += currentSession.tokenUsage.total;
    metrics.totalCost += currentSession.estimatedCost;
    metrics.totalErrors += currentSession.errors;

    // 工具使用
    for (const [tool, count] of Object.entries(currentSession.toolCalls)) {
      metrics.toolUsage[tool] = (metrics.toolUsage[tool] || 0) + count;
    }

    // 模型使用
    metrics.modelUsage[currentSession.model] =
      (metrics.modelUsage[currentSession.model] || 0) + 1;

    // 平均会话时长
    const sessionDuration =
      (currentSession.endTime || Date.now()) - currentSession.startTime;
    metrics.averageSessionDuration =
      (metrics.averageSessionDuration * (metrics.totalSessions - 1) + sessionDuration) /
      metrics.totalSessions;

    metrics.lastUpdated = Date.now();

    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  } catch (err) {
    // 静默失败
  }
}

/**
 * 限制文件大小（通用函数）
 */
function trimFile(filePath: string, maxLines: number): void {
  try {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length > maxLines) {
      const trimmed = lines.slice(-maxLines).join('\n') + '\n';
      fs.writeFileSync(filePath, trimmed);
    }
  } catch (err) {
    // 静默失败
  }
}

/**
 * 限制事件文件大小
 */
function trimEventsFile(): void {
  trimFile(EVENTS_FILE, MAX_EVENTS);
}

/**
 * 获取聚合指标
 */
export function getMetrics(): AggregateMetrics | null {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
    }
  } catch (err) {
    // 静默失败
  }
  return null;
}

/**
 * 获取当前会话指标
 */
export function getCurrentSessionMetrics(): SessionMetrics | null {
  return currentSession;
}

/**
 * 获取性能统计
 */
export function getPerformanceStats(): {
  byOperation: Record<string, { count: number; avgDuration: number; successRate: number }>;
  overall: { totalOperations: number; avgDuration: number; successRate: number };
} | null {
  try {
    if (!fs.existsSync(PERFORMANCE_FILE)) return null;

    const content = fs.readFileSync(PERFORMANCE_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const metrics: PerformanceMetric[] = lines.map((line) => JSON.parse(line));

    const byOperation: Record<
      string,
      { count: number; totalDuration: number; successes: number }
    > = {};
    let totalOperations = 0;
    let totalDuration = 0;
    let totalSuccesses = 0;

    for (const metric of metrics) {
      if (!byOperation[metric.operation]) {
        byOperation[metric.operation] = { count: 0, totalDuration: 0, successes: 0 };
      }

      byOperation[metric.operation].count++;
      byOperation[metric.operation].totalDuration += metric.duration;
      if (metric.success) {
        byOperation[metric.operation].successes++;
      }

      totalOperations++;
      totalDuration += metric.duration;
      if (metric.success) totalSuccesses++;
    }

    const result: Record<
      string,
      { count: number; avgDuration: number; successRate: number }
    > = {};
    for (const [op, stats] of Object.entries(byOperation)) {
      result[op] = {
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
        successRate: (stats.successes / stats.count) * 100,
      };
    }

    return {
      byOperation: result,
      overall: {
        totalOperations,
        avgDuration: totalDuration / totalOperations,
        successRate: (totalSuccesses / totalOperations) * 100,
      },
    };
  } catch (err) {
    return null;
  }
}

/**
 * 获取错误统计
 */
export function getErrorStats(): {
  byType: Record<string, number>;
  total: number;
  recent: ErrorReport[];
} | null {
  try {
    if (!fs.existsSync(ERRORS_FILE)) return null;

    const content = fs.readFileSync(ERRORS_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const errors: ErrorReport[] = lines.map((line) => JSON.parse(line));

    const byType: Record<string, number> = {};
    for (const error of errors) {
      byType[error.errorType] = (byType[error.errorType] || 0) + 1;
    }

    return {
      byType,
      total: errors.length,
      recent: errors.slice(-10), // 最近 10 个错误
    };
  } catch (err) {
    return null;
  }
}

/**
 * 清除所有遥测数据
 */
export function clearTelemetryData(): void {
  try {
    const files = [
      METRICS_FILE,
      EVENTS_FILE,
      ERRORS_FILE,
      PERFORMANCE_FILE,
      QUEUE_FILE,
    ];

    for (const file of files) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  } catch (err) {
    // 静默失败
  }
}

/**
 * 禁用遥测
 */
export function disableTelemetry(): void {
  telemetryConfig.enabled = false;
  saveConfig();

  // 停止上报定时器
  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }
}

/**
 * 启用遥测
 */
export function enableTelemetry(): void {
  if (TELEMETRY_DISABLED) {
    console.warn(
      'Telemetry is disabled via environment variable AXON_DISABLE_TELEMETRY'
    );
    return;
  }

  telemetryConfig.enabled = true;
  saveConfig();
  initTelemetry();
}

/**
 * 检查遥测是否启用
 */
export function isTelemetryEnabled(): boolean {
  return telemetryConfig.enabled;
}

/**
 * 启用错误报告
 */
export function enableErrorReporting(): void {
  telemetryConfig.errorReporting = true;
  saveConfig();
}

/**
 * 禁用错误报告
 */
export function disableErrorReporting(): void {
  telemetryConfig.errorReporting = false;
  saveConfig();
}

/**
 * 启用性能追踪
 */
export function enablePerformanceTracking(): void {
  telemetryConfig.performanceTracking = true;
  saveConfig();
}

/**
 * 禁用性能追踪
 */
export function disablePerformanceTracking(): void {
  telemetryConfig.performanceTracking = false;
  saveConfig();
}

/**
 * 配置批量上报
 */
export function configureBatchUpload(
  enabled: boolean,
  endpoint?: string,
  interval?: number,
  batchSize?: number
): void {
  telemetryConfig.batchUpload = enabled;

  if (endpoint !== undefined) {
    telemetryConfig.endpoint = endpoint;
  }

  if (interval !== undefined) {
    telemetryConfig.uploadInterval = interval;
  }

  if (batchSize !== undefined) {
    telemetryConfig.maxBatchSize = batchSize;
  }

  saveConfig();

  // 重启上报定时器
  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }

  if (enabled && telemetryConfig.endpoint) {
    startUploadTimer();
  }
}

/**
 * 获取遥测配置
 */
export function getTelemetryConfig(): Readonly<TelemetryConfig> {
  return { ...telemetryConfig };
}

/**
 * 获取匿名 ID
 */
export function getAnonymousUserId(): string {
  return anonymousId;
}

/**
 * 手动触发批量上报
 */
export async function flushTelemetry(): Promise<void> {
  if (telemetryConfig.batchUpload && telemetryConfig.endpoint) {
    await uploadBatch();
  }
}

/**
 * 清理：在进程退出时调用
 */
export function cleanup(): void {
  // 结束当前会话
  if (currentSession) {
    endSession();
  }

  // 停止定时器
  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }

  // 保存队列
  if (eventQueue.length > 0) {
    saveQueue();
  }
}

// 注册进程退出时的清理
process.on('beforeExit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
