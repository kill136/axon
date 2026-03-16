/**
 * chat_messages 表测试
 *
 * 测试 AuditLog 新增的聊天消息存储功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { AuditLog } from '../../src/network/audit-log.js';

describe('AuditLog - ChatMessages', () => {
  let auditLog: AuditLog;
  let testPrefix: string;

  beforeEach(async () => {
    testPrefix = crypto.randomUUID().slice(0, 8);
    auditLog = new AuditLog();
    await auditLog.initialize();
  });

  afterEach(() => {
    auditLog.close();
  });

  describe('saveMessage', () => {
    it('should save a chat message and return it with generated id', () => {
      const msg = auditLog.saveMessage({
        conversationId: `dm:${testPrefix}-agent-a`,
        fromAgentId: `${testPrefix}-agent-b`,
        fromName: 'Bot-B',
        text: 'Hello from Bot-B',
        timestamp: Date.now(),
        status: 'delivered',
      });

      expect(msg.id).toBeDefined();
      expect(msg.id).toMatch(/^[0-9a-f]{8}-/);
      expect(msg.conversationId).toBe(`dm:${testPrefix}-agent-a`);
      expect(msg.fromName).toBe('Bot-B');
      expect(msg.text).toBe('Hello from Bot-B');
      expect(msg.status).toBe('delivered');
    });

    it('should save message with replyTo', () => {
      const msg = auditLog.saveMessage({
        conversationId: `dm:${testPrefix}-agent-a`,
        fromAgentId: `${testPrefix}-agent-b`,
        fromName: 'Bot-B',
        text: 'This is a reply',
        replyTo: { id: 'original-msg-id', text: 'Original message' },
        timestamp: Date.now(),
        status: 'sent',
      });

      expect(msg.replyTo).toEqual({ id: 'original-msg-id', text: 'Original message' });
    });
  });

  describe('getMessages', () => {
    it('should return messages for a conversation in ascending order', () => {
      const convId = `dm:${testPrefix}-conv1`;
      const now = Date.now();

      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'Message 1',
        timestamp: now - 2000,
        status: 'delivered',
      });

      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: `${testPrefix}-b`,
        fromName: 'B',
        text: 'Message 2',
        timestamp: now - 1000,
        status: 'delivered',
      });

      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'Message 3',
        timestamp: now,
        status: 'sent',
      });

      const msgs = auditLog.getMessages(convId);
      expect(msgs).toHaveLength(3);
      expect(msgs[0].text).toBe('Message 1');
      expect(msgs[1].text).toBe('Message 2');
      expect(msgs[2].text).toBe('Message 3');
    });

    it('should not return messages from other conversations', () => {
      const convA = `dm:${testPrefix}-convA`;
      const convB = `dm:${testPrefix}-convB`;

      auditLog.saveMessage({
        conversationId: convA,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'In conv A',
        timestamp: Date.now(),
        status: 'sent',
      });

      auditLog.saveMessage({
        conversationId: convB,
        fromAgentId: `${testPrefix}-b`,
        fromName: 'B',
        text: 'In conv B',
        timestamp: Date.now(),
        status: 'sent',
      });

      const msgsA = auditLog.getMessages(convA);
      expect(msgsA).toHaveLength(1);
      expect(msgsA[0].text).toBe('In conv A');

      const msgsB = auditLog.getMessages(convB);
      expect(msgsB).toHaveLength(1);
      expect(msgsB[0].text).toBe('In conv B');
    });

    it('should respect limit parameter', () => {
      const convId = `dm:${testPrefix}-limit`;
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        auditLog.saveMessage({
          conversationId: convId,
          fromAgentId: `${testPrefix}-a`,
          fromName: 'A',
          text: `Message ${i}`,
          timestamp: now + i * 100,
          status: 'sent',
        });
      }

      const msgs = auditLog.getMessages(convId, 3);
      expect(msgs).toHaveLength(3);
      // Should return the latest 3 messages
      expect(msgs[0].text).toBe('Message 7');
      expect(msgs[1].text).toBe('Message 8');
      expect(msgs[2].text).toBe('Message 9');
    });

    it('should support before parameter for pagination', () => {
      const convId = `dm:${testPrefix}-paging`;
      const baseTime = 1700000000000;

      for (let i = 0; i < 5; i++) {
        auditLog.saveMessage({
          conversationId: convId,
          fromAgentId: `${testPrefix}-a`,
          fromName: 'A',
          text: `Msg ${i}`,
          timestamp: baseTime + i * 1000,
          status: 'sent',
        });
      }

      // Get messages before the 3rd message's timestamp
      const msgs = auditLog.getMessages(convId, 100, baseTime + 3000);
      expect(msgs).toHaveLength(3); // Msg 0, 1, 2
      expect(msgs[0].text).toBe('Msg 0');
      expect(msgs[2].text).toBe('Msg 2');
    });
  });

  describe('getConversations', () => {
    it('should return conversation summaries with last message', () => {
      const convA = `dm:${testPrefix}-sumA`;
      const convB = `group:${testPrefix}-sumB`;
      const now = Date.now();

      auditLog.saveMessage({
        conversationId: convA,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'Old message',
        timestamp: now - 2000,
        status: 'sent',
      });

      auditLog.saveMessage({
        conversationId: convA,
        fromAgentId: `${testPrefix}-b`,
        fromName: 'B',
        text: 'Latest in A',
        timestamp: now - 1000,
        status: 'delivered',
      });

      auditLog.saveMessage({
        conversationId: convB,
        fromAgentId: `${testPrefix}-c`,
        fromName: 'C',
        text: 'Latest in B',
        timestamp: now,
        status: 'delivered',
      });

      const convs = auditLog.getConversations();
      // Filter to our test conversations
      const testConvs = convs.filter(c => c.id.includes(testPrefix));

      expect(testConvs.length).toBe(2);
      // Most recent first
      expect(testConvs[0].id).toBe(convB);
      expect(testConvs[0].lastMessage?.text).toBe('Latest in B');
      expect(testConvs[1].id).toBe(convA);
      expect(testConvs[1].lastMessage?.text).toBe('Latest in A');
    });
  });

  describe('clearConversation', () => {
    it('should delete all messages in a conversation', () => {
      const convId = `dm:${testPrefix}-clear`;

      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'Will be cleared',
        timestamp: Date.now(),
        status: 'sent',
      });

      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: `${testPrefix}-b`,
        fromName: 'B',
        text: 'Also cleared',
        timestamp: Date.now(),
        status: 'delivered',
      });

      expect(auditLog.getMessages(convId)).toHaveLength(2);

      const deleted = auditLog.clearConversation(convId);
      expect(deleted).toBe(2);
      expect(auditLog.getMessages(convId)).toHaveLength(0);
    });

    it('should not affect other conversations', () => {
      const conv1 = `dm:${testPrefix}-keep`;
      const conv2 = `dm:${testPrefix}-delete`;

      auditLog.saveMessage({
        conversationId: conv1,
        fromAgentId: `${testPrefix}-a`,
        fromName: 'A',
        text: 'Keep this',
        timestamp: Date.now(),
        status: 'sent',
      });

      auditLog.saveMessage({
        conversationId: conv2,
        fromAgentId: `${testPrefix}-b`,
        fromName: 'B',
        text: 'Delete this',
        timestamp: Date.now(),
        status: 'sent',
      });

      auditLog.clearConversation(conv2);

      expect(auditLog.getMessages(conv1)).toHaveLength(1);
      expect(auditLog.getMessages(conv2)).toHaveLength(0);
    });
  });

  describe('group chat messages', () => {
    it('should store and retrieve group messages correctly', () => {
      const groupConvId = `group:${testPrefix}-group1`;
      const now = Date.now();

      // 多个不同 agent 发到同一个群
      auditLog.saveMessage({
        conversationId: groupConvId,
        fromAgentId: `${testPrefix}-agent-a`,
        fromName: 'Agent A',
        text: 'Hello everyone!',
        timestamp: now - 2000,
        status: 'delivered',
      });

      auditLog.saveMessage({
        conversationId: groupConvId,
        fromAgentId: `${testPrefix}-agent-b`,
        fromName: 'Agent B',
        text: 'Hi A!',
        timestamp: now - 1000,
        status: 'delivered',
      });

      auditLog.saveMessage({
        conversationId: groupConvId,
        fromAgentId: `${testPrefix}-agent-c`,
        fromName: 'Agent C',
        text: 'Good morning!',
        timestamp: now,
        status: 'delivered',
      });

      const msgs = auditLog.getMessages(groupConvId);
      expect(msgs).toHaveLength(3);
      // All messages from different agents in same conversation
      expect(msgs[0].fromName).toBe('Agent A');
      expect(msgs[1].fromName).toBe('Agent B');
      expect(msgs[2].fromName).toBe('Agent C');
      // All have same conversationId
      expect(msgs.every(m => m.conversationId === groupConvId)).toBe(true);
    });
  });

  describe('clearByAgent', () => {
    it('should clear both audit logs and chat messages for an agent', () => {
      const agentId = `${testPrefix}-target`;
      const convId = `dm:${agentId}`;

      // Add audit log entry
      auditLog.log({
        timestamp: Date.now(),
        direction: 'outbound',
        fromAgentId: `${testPrefix}-self`,
        fromName: 'Self',
        toAgentId: agentId,
        toName: 'Target',
        messageType: 'chat',
        method: 'agent.chat',
        summary: 'Hello',
        success: true,
      });

      // Add chat message
      auditLog.saveMessage({
        conversationId: convId,
        fromAgentId: agentId,
        fromName: 'Target',
        text: 'Hello back',
        timestamp: Date.now(),
        status: 'delivered',
      });

      const deleted = auditLog.clearByAgent(agentId);
      expect(deleted).toBeGreaterThan(0);
      expect(auditLog.getMessages(convId)).toHaveLength(0);
    });
  });
});
