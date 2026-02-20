/**
 * SwarmLogDB - SQLite 日志存储模块
 *
 * 功能：
 * 1. 持久化存储 Worker 执行日志和流式内容
 * 2. 支持按任务、Blueprint 查询历史日志
 * 3. 自动清理过期日志（默认 7 天）
 * 4. 支持任务重试时清空旧日志
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ============================================================================
// 类型定义
// ============================================================================

export interface WorkerLog {
  id: string;
  blueprintId: string;
  taskId: string;
  workerId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  type: 'tool' | 'decision' | 'status' | 'output' | 'error';
  message: string;
  details?: any;
}

export interface WorkerStream {
  id: string;
  blueprintId: string;
  taskId: string;
  workerId: string;
  timestamp: string;
  // v4.6: 添加 system_prompt 类型
  streamType: 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'system_prompt';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: string;
  toolError?: string;
}

export interface TaskExecution {
  id: string;
  blueprintId: string;
  taskId: string;
  taskName: string;
  workerId: string;
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  reviewFeedback?: any;
}

export interface LogQueryOptions {
  blueprintId?: string;
  taskId?: string;
  workerId?: string;
  attempt?: number;
  limit?: number;
  offset?: number;
  since?: string;  // ISO timestamp
  until?: string;  // ISO timestamp
}

// ============================================================================
// SwarmLogDB 类
// ============================================================================

export class SwarmLogDB {
  private db!: import('better-sqlite3').Database;
  private static instance: SwarmLogDB | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private retentionDays: number;

  private constructor(retentionDays: number = 7) {
    this.retentionDays = retentionDays;
  }

  /**
   * 获取单例实例
   */
  static async getInstance(dbPath?: string, retentionDays?: number): Promise<SwarmLogDB> {
    if (!SwarmLogDB.instance) {
      SwarmLogDB.instance = await SwarmLogDB._create(dbPath, retentionDays);
    }
    return SwarmLogDB.instance;
  }

  private static async _create(dbPath?: string, retentionDays: number = 7): Promise<SwarmLogDB> {
    const instance = new SwarmLogDB(retentionDays);
    const mod = await import('better-sqlite3').catch(e => {
      throw new Error(
        'better-sqlite3 模块加载失败。请确保已安装编译依赖：\n' +
        '  Ubuntu/Debian: apt-get install python3 make g++\n' +
        '  然后重新运行: npm install better-sqlite3\n' +
        '原始错误: ' + e.message
      );
    });
    const defaultPath = path.join(os.homedir(), '.claude', 'swarm-logs.db');
    const actualPath = dbPath || defaultPath;
    const dir = path.dirname(actualPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    instance.db = new mod.default(actualPath);
    instance.db.pragma('journal_mode = WAL');
    instance.db.pragma('synchronous = NORMAL');
    instance.initTables();
    instance.startCleanupScheduler();
    console.log(`[SwarmLogDB] 数据库初始化完成: ${actualPath}`);
    return instance;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.db.close();
    SwarmLogDB.instance = null;
    console.log('[SwarmLogDB] 数据库已关闭');
  }

  /**
   * 初始化表结构
   */
  private initTables(): void {
    // 任务执行记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        blueprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT,
        review_feedback TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_executions_blueprint ON task_executions(blueprint_id);
      CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id);
      CREATE INDEX IF NOT EXISTS idx_executions_created ON task_executions(created_at);
    `);

    // Worker 日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_logs (
        id TEXT PRIMARY KEY,
        execution_id TEXT,
        blueprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (execution_id) REFERENCES task_executions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_logs_blueprint ON worker_logs(blueprint_id);
      CREATE INDEX IF NOT EXISTS idx_logs_task ON worker_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_execution ON worker_logs(execution_id);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON worker_logs(created_at);
    `);

    // Worker 流式内容表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_streams (
        id TEXT PRIMARY KEY,
        execution_id TEXT,
        blueprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        stream_type TEXT NOT NULL,
        content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_result TEXT,
        tool_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (execution_id) REFERENCES task_executions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_streams_blueprint ON worker_streams(blueprint_id);
      CREATE INDEX IF NOT EXISTS idx_streams_task ON worker_streams(task_id);
      CREATE INDEX IF NOT EXISTS idx_streams_execution ON worker_streams(execution_id);
      CREATE INDEX IF NOT EXISTS idx_streams_created ON worker_streams(created_at);
    `);

    console.log('[SwarmLogDB] 表结构初始化完成');
  }

  // ============================================================================
  // 写入方法
  // ============================================================================

  /**
   * 记录任务执行开始
   */
  recordExecutionStart(data: {
    blueprintId: string;
    taskId: string;
    taskName: string;
    workerId: string;
    attempt: number;
  }): string {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO task_executions (id, blueprint_id, task_id, task_name, worker_id, attempt, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now'))
    `);
    stmt.run(id, data.blueprintId, data.taskId, data.taskName, data.workerId, data.attempt);
    return id;
  }

  /**
   * 更新任务执行结束
   */
  recordExecutionEnd(executionId: string, data: {
    status: 'completed' | 'failed';
    error?: string;
    reviewFeedback?: any;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE task_executions
      SET status = ?, completed_at = datetime('now'), error = ?, review_feedback = ?
      WHERE id = ?
    `);
    stmt.run(
      data.status,
      data.error || null,
      data.reviewFeedback ? JSON.stringify(data.reviewFeedback) : null,
      executionId
    );
  }

  /**
   * 记录 Worker 日志
   */
  insertLog(log: WorkerLog, executionId?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO worker_logs (id, execution_id, blueprint_id, task_id, worker_id, timestamp, level, type, message, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      executionId || null,
      log.blueprintId,
      log.taskId,
      log.workerId,
      log.timestamp,
      log.level,
      log.type,
      log.message,
      log.details ? JSON.stringify(log.details) : null
    );
  }

  /**
   * 记录 Worker 流式内容
   */
  insertStream(stream: WorkerStream, executionId?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO worker_streams (id, execution_id, blueprint_id, task_id, worker_id, timestamp, stream_type, content, tool_name, tool_input, tool_result, tool_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      stream.id,
      executionId || null,
      stream.blueprintId,
      stream.taskId,
      stream.workerId,
      stream.timestamp,
      stream.streamType,
      stream.content || null,
      stream.toolName || null,
      stream.toolInput ? JSON.stringify(stream.toolInput) : null,
      stream.toolResult || null,
      stream.toolError || null
    );
  }

  /**
   * 批量插入日志（性能优化）
   */
  insertLogsBatch(logs: WorkerLog[], executionId?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO worker_logs (id, execution_id, blueprint_id, task_id, worker_id, timestamp, level, type, message, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((logs: WorkerLog[]) => {
      for (const log of logs) {
        stmt.run(
          log.id,
          executionId || null,
          log.blueprintId,
          log.taskId,
          log.workerId,
          log.timestamp,
          log.level,
          log.type,
          log.message,
          log.details ? JSON.stringify(log.details) : null
        );
      }
    });

    insertMany(logs);
  }

  // ============================================================================
  // 查询方法
  // ============================================================================

  /**
   * 查询任务执行记录
   */
  getExecutions(options: LogQueryOptions = {}): TaskExecution[] {
    let sql = 'SELECT * FROM task_executions WHERE 1=1';
    const params: any[] = [];

    if (options.blueprintId) {
      sql += ' AND blueprint_id = ?';
      params.push(options.blueprintId);
    }
    if (options.taskId) {
      sql += ' AND task_id = ?';
      params.push(options.taskId);
    }
    if (options.workerId) {
      sql += ' AND worker_id = ?';
      params.push(options.workerId);
    }
    if (options.attempt !== undefined) {
      sql += ' AND attempt = ?';
      params.push(options.attempt);
    }

    sql += ' ORDER BY started_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      blueprintId: row.blueprint_id,
      taskId: row.task_id,
      taskName: row.task_name,
      workerId: row.worker_id,
      attempt: row.attempt,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      reviewFeedback: row.review_feedback ? JSON.parse(row.review_feedback) : undefined,
    }));
  }

  /**
   * 查询 Worker 日志
   */
  getLogs(options: LogQueryOptions = {}): WorkerLog[] {
    let sql = 'SELECT * FROM worker_logs WHERE 1=1';
    const params: any[] = [];

    if (options.blueprintId) {
      sql += ' AND blueprint_id = ?';
      params.push(options.blueprintId);
    }
    if (options.taskId) {
      sql += ' AND task_id = ?';
      params.push(options.taskId);
    }
    if (options.workerId) {
      sql += ' AND worker_id = ?';
      params.push(options.workerId);
    }
    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }
    if (options.until) {
      sql += ' AND timestamp <= ?';
      params.push(options.until);
    }

    sql += ' ORDER BY timestamp ASC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      blueprintId: row.blueprint_id,
      taskId: row.task_id,
      workerId: row.worker_id,
      timestamp: row.timestamp,
      level: row.level,
      type: row.type,
      message: row.message,
      details: row.details ? JSON.parse(row.details) : undefined,
    }));
  }

  /**
   * 查询 Worker 流式内容
   */
  getStreams(options: LogQueryOptions = {}): WorkerStream[] {
    let sql = 'SELECT * FROM worker_streams WHERE 1=1';
    const params: any[] = [];

    if (options.blueprintId) {
      sql += ' AND blueprint_id = ?';
      params.push(options.blueprintId);
    }
    if (options.taskId) {
      sql += ' AND task_id = ?';
      params.push(options.taskId);
    }
    if (options.workerId) {
      sql += ' AND worker_id = ?';
      params.push(options.workerId);
    }
    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }
    if (options.until) {
      sql += ' AND timestamp <= ?';
      params.push(options.until);
    }

    sql += ' ORDER BY timestamp ASC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      blueprintId: row.blueprint_id,
      taskId: row.task_id,
      workerId: row.worker_id,
      timestamp: row.timestamp,
      streamType: row.stream_type,
      content: row.content,
      toolName: row.tool_name,
      toolInput: row.tool_input ? JSON.parse(row.tool_input) : undefined,
      toolResult: row.tool_result,
      toolError: row.tool_error,
    }));
  }

  /**
   * 获取任务的完整执行历史（所有尝试）
   */
  getTaskHistory(taskId: string): {
    executions: TaskExecution[];
    totalLogs: number;
    totalStreams: number;
  } {
    const executions = this.getExecutions({ taskId });

    const logCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM worker_logs WHERE task_id = ?'
    ).get(taskId) as { count: number };

    const streamCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM worker_streams WHERE task_id = ?'
    ).get(taskId) as { count: number };

    return {
      executions,
      totalLogs: logCount.count,
      totalStreams: streamCount.count,
    };
  }

  // ============================================================================
  // 清理方法
  // ============================================================================

  /**
   * 清空特定任务的日志（用于重试前）
   */
  clearTaskLogs(taskId: string, keepLatestAttempt: boolean = false): number {
    let deletedCount = 0;

    if (keepLatestAttempt) {
      // 保留最新一次尝试的日志
      const latestExecution = this.db.prepare(`
        SELECT id FROM task_executions WHERE task_id = ? ORDER BY attempt DESC LIMIT 1
      `).get(taskId) as { id: string } | undefined;

      if (latestExecution) {
        const logsDeleted = this.db.prepare(`
          DELETE FROM worker_logs WHERE task_id = ? AND (execution_id IS NULL OR execution_id != ?)
        `).run(taskId, latestExecution.id);

        const streamsDeleted = this.db.prepare(`
          DELETE FROM worker_streams WHERE task_id = ? AND (execution_id IS NULL OR execution_id != ?)
        `).run(taskId, latestExecution.id);

        deletedCount = logsDeleted.changes + streamsDeleted.changes;
      }
    } else {
      // 清空所有日志
      const logsDeleted = this.db.prepare('DELETE FROM worker_logs WHERE task_id = ?').run(taskId);
      const streamsDeleted = this.db.prepare('DELETE FROM worker_streams WHERE task_id = ?').run(taskId);
      deletedCount = logsDeleted.changes + streamsDeleted.changes;
    }

    console.log(`[SwarmLogDB] 清空任务 ${taskId} 的日志，删除 ${deletedCount} 条记录`);
    return deletedCount;
  }

  /**
   * 清理过期日志
   */
  cleanupOldLogs(): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffStr = cutoffDate.toISOString();

    // 先删除日志和流
    const logsDeleted = this.db.prepare(
      'DELETE FROM worker_logs WHERE created_at < ?'
    ).run(cutoffStr);

    const streamsDeleted = this.db.prepare(
      'DELETE FROM worker_streams WHERE created_at < ?'
    ).run(cutoffStr);

    // 再删除执行记录
    const execsDeleted = this.db.prepare(
      'DELETE FROM task_executions WHERE created_at < ?'
    ).run(cutoffStr);

    const totalDeleted = logsDeleted.changes + streamsDeleted.changes + execsDeleted.changes;

    if (totalDeleted > 0) {
      console.log(`[SwarmLogDB] 清理过期日志: ${totalDeleted} 条 (${this.retentionDays} 天前)`);
      // 执行 VACUUM 压缩数据库
      this.db.exec('VACUUM');
    }

    return totalDeleted;
  }

  /**
   * 启动定期清理
   */
  private startCleanupScheduler(): void {
    // 启动时执行一次清理
    this.cleanupOldLogs();

    // 每小时检查一次
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldLogs();
    }, 60 * 60 * 1000);
  }

  // ============================================================================
  // 统计方法
  // ============================================================================

  /**
   * 获取数据库统计信息
   */
  getStats(): {
    totalExecutions: number;
    totalLogs: number;
    totalStreams: number;
    dbSizeBytes: number;
  } {
    const execCount = this.db.prepare('SELECT COUNT(*) as count FROM task_executions').get() as { count: number };
    const logCount = this.db.prepare('SELECT COUNT(*) as count FROM worker_logs').get() as { count: number };
    const streamCount = this.db.prepare('SELECT COUNT(*) as count FROM worker_streams').get() as { count: number };

    // 获取数据库文件大小
    const dbPath = this.db.name;
    let dbSize = 0;
    try {
      const stats = fs.statSync(dbPath);
      dbSize = stats.size;
    } catch {
      // 忽略
    }

    return {
      totalExecutions: execCount.count,
      totalLogs: logCount.count,
      totalStreams: streamCount.count,
      dbSizeBytes: dbSize,
    };
  }
}

// 导出单例获取函数
export async function getSwarmLogDB(): Promise<SwarmLogDB> {
  return SwarmLogDB.getInstance();
}

export default SwarmLogDB;
