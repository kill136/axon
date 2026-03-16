/**
 * Agent 通信审计日志
 *
 * 复用 memory 系统的 SQLite (better-sqlite3)，新增 network_audit 表。
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { AuditLogEntry, PendingMessage, AgentMessage, AgentGroup, ChatMessage, ConversationSummary } from './types.js';

const DB_DIR = path.join(os.homedir(), '.axon', 'network');
const DB_PATH = path.join(DB_DIR, 'network.db');

export class AuditLog {
  private db!: import('better-sqlite3').Database;

  async initialize(): Promise<void> {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    const mod = await import('better-sqlite3');
    this.db = new mod.default(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS network_audit (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        direction TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        from_name TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        to_name TEXT NOT NULL,
        message_type TEXT NOT NULL,
        method TEXT NOT NULL,
        summary TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        task_id TEXT,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON network_audit(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_from ON network_audit(from_agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_to ON network_audit(to_agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_task ON network_audit(task_id);

      CREATE TABLE IF NOT EXISTS pending_messages (
        id TEXT PRIMARY KEY,
        target_agent_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 10
      );

      CREATE INDEX IF NOT EXISTS idx_pending_target ON pending_messages(target_agent_id);

      CREATE TABLE IF NOT EXISTS agent_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_seed TEXT,
        members TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        from_name TEXT NOT NULL,
        text TEXT NOT NULL,
        reply_to TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent'
      );

      CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_chat_from ON chat_messages(from_agent_id);
    `);
  }

  /**
   * 记录审计日志
   */
  log(entry: Omit<AuditLogEntry, 'id'>): AuditLogEntry {
    const id = crypto.randomUUID();
    const full: AuditLogEntry = { id, ...entry };

    this.db.prepare(`
      INSERT INTO network_audit (id, timestamp, direction, from_agent_id, from_name, to_agent_id, to_name, message_type, method, summary, success, error, task_id, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.timestamp,
      full.direction,
      full.fromAgentId,
      full.fromName,
      full.toAgentId,
      full.toName,
      full.messageType,
      full.method,
      full.summary,
      full.success ? 1 : 0,
      full.error || null,
      full.taskId || null,
      full.payload || null,
    );

    return full;
  }

  /**
   * 查询审计日志
   */
  query(filter: {
    agentId?: string;
    taskId?: string;
    limit?: number;
    offset?: number;
  } = {}): AuditLogEntry[] {
    const { agentId, taskId, limit = 100, offset = 0 } = filter;

    let sql = 'SELECT * FROM network_audit WHERE 1=1';
    const params: unknown[] = [];

    if (agentId) {
      sql += ' AND (from_agent_id = ? OR to_agent_id = ?)';
      params.push(agentId, agentId);
    }

    if (taskId) {
      sql += ' AND task_id = ?';
      params.push(taskId);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: row.id as string,
      timestamp: row.timestamp as number,
      direction: row.direction as 'inbound' | 'outbound',
      fromAgentId: row.from_agent_id as string,
      fromName: row.from_name as string,
      toAgentId: row.to_agent_id as string,
      toName: row.to_name as string,
      messageType: row.message_type as AuditLogEntry['messageType'],
      method: row.method as string,
      summary: row.summary as string,
      success: (row.success as number) === 1,
      error: row.error as string | undefined,
      taskId: row.task_id as string | undefined,
      payload: row.payload as string | undefined,
    }));
  }

  // ===== 离线消息队列 =====

  /**
   * 将发送失败的消息加入队列
   */
  enqueueMessage(targetAgentId: string, message: AgentMessage): void {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO pending_messages (id, target_agent_id, message, created_at, retry_count, max_retries)
      VALUES (?, ?, ?, ?, 0, 10)
    `).run(id, targetAgentId, JSON.stringify(message), Date.now());
  }

  /**
   * 获取待发送的消息
   */
  getPendingMessages(targetAgentId: string): PendingMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM pending_messages WHERE target_agent_id = ? AND retry_count < max_retries ORDER BY created_at ASC'
    ).all(targetAgentId) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as string,
      targetAgentId: row.target_agent_id as string,
      message: JSON.parse(row.message as string),
      createdAt: row.created_at as number,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
    }));
  }

  /**
   * 标记消息已发送（删除）
   */
  removePendingMessage(id: string): void {
    this.db.prepare('DELETE FROM pending_messages WHERE id = ?').run(id);
  }

  /**
   * 增加重试计数
   */
  incrementRetry(id: string): void {
    this.db.prepare('UPDATE pending_messages SET retry_count = retry_count + 1 WHERE id = ?').run(id);
  }

  /**
   * 清理过期的待发消息（超过 24 小时）
   */
  cleanupExpired(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM pending_messages WHERE created_at < ?').run(cutoff);
  }

  // ===== 聊天记录清除 =====

  /**
   * 清除与指定 Agent 的所有聊天记录（审计日志 + 聊天消息）
   */
  clearByAgent(agentId: string): number {
    const r1 = this.db.prepare(
      'DELETE FROM network_audit WHERE from_agent_id = ? OR to_agent_id = ?'
    ).run(agentId, agentId);
    // 同时清除 chat_messages 中该 agent 的私聊记录
    const convId = `dm:${agentId}`;
    const r2 = this.db.prepare(
      'DELETE FROM chat_messages WHERE conversation_id = ? OR from_agent_id = ?'
    ).run(convId, agentId);
    return r1.changes + r2.changes;
  }

  /**
   * 清除所有聊天记录（审计日志 + 聊天消息）
   */
  clearAll(): number {
    const r1 = this.db.prepare('DELETE FROM network_audit').run();
    const r2 = this.db.prepare('DELETE FROM chat_messages').run();
    return r1.changes + r2.changes;
  }

  // ===== 聊天消息（chat_messages 表） =====

  /**
   * 保存聊天消息
   */
  saveMessage(msg: Omit<ChatMessage, 'id'>): ChatMessage {
    const id = crypto.randomUUID();
    const full: ChatMessage = { id, ...msg };
    this.db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, from_agent_id, from_name, text, reply_to, timestamp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.conversationId,
      full.fromAgentId,
      full.fromName,
      full.text,
      full.replyTo ? JSON.stringify(full.replyTo) : null,
      full.timestamp,
      full.status,
    );
    return full;
  }

  /**
   * 查询某个会话的消息（按时间升序，支持分页）
   */
  getMessages(conversationId: string, limit = 100, before?: number): ChatMessage[] {
    let sql = 'SELECT * FROM chat_messages WHERE conversation_id = ?';
    const params: unknown[] = [conversationId];

    if (before) {
      sql += ' AND timestamp < ?';
      params.push(before);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    // 返回时按时间升序
    return rows.map(row => this.rowToChatMessage(row)).reverse();
  }

  /**
   * 获取所有会话摘要（用于左侧列表）
   */
  getConversations(): ConversationSummary[] {
    // 每个 conversation_id 的最后一条消息
    const rows = this.db.prepare(`
      SELECT cm.* FROM chat_messages cm
      INNER JOIN (
        SELECT conversation_id, MAX(timestamp) as max_ts
        FROM chat_messages
        GROUP BY conversation_id
      ) latest ON cm.conversation_id = latest.conversation_id AND cm.timestamp = latest.max_ts
      ORDER BY cm.timestamp DESC
    `).all() as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.conversation_id as string,
      lastMessage: this.rowToChatMessage(row),
      unreadCount: 0, // 未读计数由前端管理
    }));
  }

  /**
   * 清除某个会话的聊天消息
   */
  clearConversation(conversationId: string): number {
    const result = this.db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(conversationId);
    return result.changes;
  }

  private rowToChatMessage(row: Record<string, unknown>): ChatMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromAgentId: row.from_agent_id as string,
      fromName: row.from_name as string,
      text: row.text as string,
      replyTo: row.reply_to ? JSON.parse(row.reply_to as string) : undefined,
      timestamp: row.timestamp as number,
      status: row.status as ChatMessage['status'],
    };
  }

  // ===== 群组管理 =====

  /**
   * 创建群组
   */
  createGroup(name: string, members: string[]): AgentGroup {
    const group: AgentGroup = {
      id: crypto.randomUUID(),
      name,
      members,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.db.prepare(`
      INSERT INTO agent_groups (id, name, avatar_seed, members, created_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(group.id, group.name, group.avatarSeed || null, JSON.stringify(group.members), group.createdAt, group.lastActivity);
    return group;
  }

  /**
   * 获取所有群组
   */
  getGroups(): AgentGroup[] {
    const rows = this.db.prepare('SELECT * FROM agent_groups ORDER BY last_activity DESC').all() as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      avatarSeed: row.avatar_seed as string | undefined,
      members: JSON.parse(row.members as string),
      createdAt: row.created_at as number,
      lastActivity: row.last_activity as number,
    }));
  }

  /**
   * 更新群组
   */
  updateGroup(id: string, updates: { name?: string; members?: string[] }): void {
    if (updates.name !== undefined) {
      this.db.prepare('UPDATE agent_groups SET name = ? WHERE id = ?').run(updates.name, id);
    }
    if (updates.members !== undefined) {
      this.db.prepare('UPDATE agent_groups SET members = ? WHERE id = ?').run(JSON.stringify(updates.members), id);
    }
    this.db.prepare('UPDATE agent_groups SET last_activity = ? WHERE id = ?').run(Date.now(), id);
  }

  /**
   * 删除群组
   */
  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM agent_groups WHERE id = ?').run(id);
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
