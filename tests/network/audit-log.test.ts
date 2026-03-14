/**
 * 审计日志 + 离线消息队列测试
 *
 * 注意: AuditLog 使用固定路径 ~/.axon/network/network.db，
 * 多个测试共享同一数据库。使用唯一标识符避免数据污染。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { AuditLog } from '../../src/network/audit-log.js';
import type { AgentMessage } from '../../src/network/types.js';

describe('AuditLog', () => {
  let auditLog: AuditLog;
  // 每个测试使用唯一 ID 前缀避免数据污染
  let testPrefix: string;

  beforeEach(async () => {
    testPrefix = crypto.randomUUID().slice(0, 8);
    auditLog = new AuditLog();
    await auditLog.initialize();
  });

  afterEach(() => {
    auditLog.close();
  });

  describe('log', () => {
    it('should record audit entry and return with id', () => {
      const entry = auditLog.log({
        timestamp: Date.now(),
        direction: 'outbound',
        fromAgentId: `${testPrefix}-agent-a`,
        fromName: 'Bot-A',
        toAgentId: `${testPrefix}-agent-b`,
        toName: 'Bot-B',
        messageType: 'query',
        method: 'agent.ping',
        summary: 'Ping request',
        success: true,
      });

      expect(entry.id).toBeDefined();
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(entry.fromAgentId).toBe(`${testPrefix}-agent-a`);
      expect(entry.method).toBe('agent.ping');
    });

    it('should store error and taskId', () => {
      const entry = auditLog.log({
        timestamp: Date.now(),
        direction: 'inbound',
        fromAgentId: `${testPrefix}-x`,
        fromName: 'X',
        toAgentId: `${testPrefix}-y`,
        toName: 'Y',
        messageType: 'response',
        method: 'agent.callTool',
        summary: 'Call failed',
        success: false,
        error: 'Permission denied',
        taskId: `${testPrefix}-task-123`,
      });

      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Permission denied');
      expect(entry.taskId).toBe(`${testPrefix}-task-123`);
    });
  });

  describe('query', () => {
    it('should return entries filtered by agentId', () => {
      const uniqueAgent = `${testPrefix}-unique-agent`;
      auditLog.log({
        timestamp: Date.now(),
        direction: 'outbound',
        fromAgentId: uniqueAgent,
        fromName: 'A',
        toAgentId: `${testPrefix}-other`,
        toName: 'B',
        messageType: 'query',
        method: 'test.method',
        summary: 'Test',
        success: true,
      });

      const results = auditLog.query({ agentId: uniqueAgent });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.fromAgentId === uniqueAgent || r.toAgentId === uniqueAgent).toBe(true);
      }
    });

    it('should filter by taskId', () => {
      const uniqueTask = `${testPrefix}-task`;
      auditLog.log({
        timestamp: Date.now(),
        direction: 'outbound',
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        toAgentId: `${testPrefix}-b`,
        toName: 'B',
        messageType: 'task',
        method: 'test',
        summary: 'Test',
        success: true,
        taskId: uniqueTask,
      });

      const results = auditLog.query({ taskId: uniqueTask });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].taskId).toBe(uniqueTask);
    });

    it('should respect limit', () => {
      // 插入 5 条
      for (let i = 0; i < 5; i++) {
        auditLog.log({
          timestamp: Date.now() + i,
          direction: 'outbound',
          fromAgentId: `${testPrefix}-paginate`,
          fromName: 'A',
          toAgentId: `${testPrefix}-b`,
          toName: 'B',
          messageType: 'query',
          method: `paginated.${i}`,
          summary: `Item ${i}`,
          success: true,
        });
      }

      const limited = auditLog.query({ agentId: `${testPrefix}-paginate`, limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should order by timestamp descending', () => {
      const baseTime = Date.now();
      for (let i = 0; i < 3; i++) {
        auditLog.log({
          timestamp: baseTime + i * 1000,
          direction: 'outbound',
          fromAgentId: `${testPrefix}-order`,
          fromName: 'A',
          toAgentId: `${testPrefix}-b`,
          toName: 'B',
          messageType: 'query',
          method: `order.${i}`,
          summary: `Order ${i}`,
          success: true,
        });
      }

      const results = auditLog.query({ agentId: `${testPrefix}-order` });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp).toBeGreaterThanOrEqual(results[i].timestamp);
      }
    });
  });

  describe('pending messages (offline queue)', () => {
    it('should enqueue and retrieve pending messages', () => {
      const targetId = `${testPrefix}-target`;
      const testMsg: AgentMessage = {
        jsonrpc: '2.0',
        id: `${testPrefix}-msg-1`,
        method: 'agent.ping',
        _meta: {
          from: `${testPrefix}-sender`,
          to: targetId,
          signature: 'fake-sig',
          timestamp: Date.now(),
        },
      };

      auditLog.enqueueMessage(targetId, testMsg);

      const pending = auditLog.getPendingMessages(targetId);
      expect(pending.length).toBeGreaterThanOrEqual(1);
      const found = pending.find(p => p.message.id === `${testPrefix}-msg-1`);
      expect(found).toBeDefined();
      expect(found!.retryCount).toBe(0);
    });

    it('should remove pending message after send', () => {
      const targetId = `${testPrefix}-remove-target`;
      const testMsg: AgentMessage = {
        jsonrpc: '2.0',
        id: `${testPrefix}-remove-msg`,
        method: 'agent.ping',
        _meta: {
          from: `${testPrefix}-sender`,
          to: targetId,
          signature: 'fake-sig',
          timestamp: Date.now(),
        },
      };

      auditLog.enqueueMessage(targetId, testMsg);
      const pending = auditLog.getPendingMessages(targetId);
      const found = pending.find(p => p.message.id === `${testPrefix}-remove-msg`);
      expect(found).toBeDefined();

      auditLog.removePendingMessage(found!.id);
      const remaining = auditLog.getPendingMessages(targetId);
      const stillExists = remaining.find(p => p.message.id === `${testPrefix}-remove-msg`);
      expect(stillExists).toBeUndefined();
    });

    it('should increment retry count', () => {
      const targetId = `${testPrefix}-retry-target`;
      const testMsg: AgentMessage = {
        jsonrpc: '2.0',
        id: `${testPrefix}-retry-msg`,
        method: 'agent.ping',
        _meta: {
          from: `${testPrefix}-sender`,
          to: targetId,
          signature: 'fake-sig',
          timestamp: Date.now(),
        },
      };

      auditLog.enqueueMessage(targetId, testMsg);
      let pending = auditLog.getPendingMessages(targetId);
      const found = pending.find(p => p.message.id === `${testPrefix}-retry-msg`)!;
      expect(found.retryCount).toBe(0);

      auditLog.incrementRetry(found.id);
      pending = auditLog.getPendingMessages(targetId);
      const updated = pending.find(p => p.id === found.id)!;
      expect(updated.retryCount).toBe(1);

      // cleanup
      auditLog.removePendingMessage(found.id);
    });

    it('should not return messages exceeding max retries', () => {
      const targetId = `${testPrefix}-maxretry-target`;
      const testMsg: AgentMessage = {
        jsonrpc: '2.0',
        id: `${testPrefix}-maxretry-msg`,
        method: 'agent.ping',
        _meta: {
          from: `${testPrefix}-sender`,
          to: targetId,
          signature: 'fake-sig',
          timestamp: Date.now(),
        },
      };

      auditLog.enqueueMessage(targetId, testMsg);
      const pending = auditLog.getPendingMessages(targetId);
      const found = pending.find(p => p.message.id === `${testPrefix}-maxretry-msg`)!;

      // 重试 10 次到上限
      for (let i = 0; i < 10; i++) {
        auditLog.incrementRetry(found.id);
      }

      const result = auditLog.getPendingMessages(targetId);
      const exceeded = result.find(p => p.id === found.id);
      expect(exceeded).toBeUndefined();
    });
  });
});
