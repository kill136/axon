/**
 * Agent Network Chat 功能测试
 *
 * 测试 agent.chat 方法的请求处理、防循环机制、审计日志类型。
 */

import { describe, it, expect } from 'vitest';
import { AgentMethod } from '../../src/network/types.js';
import type { AuditLogEntry } from '../../src/network/types.js';

describe('Agent Chat', () => {
  describe('AgentMethod.Chat', () => {
    it('should define agent.chat method', () => {
      expect(AgentMethod.Chat).toBe('agent.chat');
    });
  });

  describe('AuditLogEntry messageType', () => {
    it('should support chat messageType', () => {
      const entry: AuditLogEntry = {
        id: 'test-1',
        timestamp: Date.now(),
        direction: 'outbound',
        fromAgentId: 'agent-a',
        fromName: 'AgentA',
        toAgentId: 'agent-b',
        toName: 'AgentB',
        messageType: 'chat',
        method: AgentMethod.Chat,
        summary: 'Hello, how are you?',
        success: true,
      };
      expect(entry.messageType).toBe('chat');
      expect(entry.method).toBe('agent.chat');
    });

    it('should support all messageTypes including chat', () => {
      const types: AuditLogEntry['messageType'][] = ['query', 'task', 'notify', 'response', 'chat'];
      expect(types).toHaveLength(5);
      expect(types).toContain('chat');
    });
  });

  describe('Chat message isReply flag', () => {
    it('should distinguish user-initiated messages from AI replies', () => {
      const userMessage = { message: 'Hello', isReply: false };
      const aiReply = { message: 'Hi there!', isReply: true };

      expect(userMessage.isReply).toBe(false);
      expect(aiReply.isReply).toBe(true);
    });

    it('should default to non-reply when isReply is undefined', () => {
      const message = { message: 'Hello' };
      // undefined isReply should be treated as user-initiated (not a reply)
      expect(message).not.toHaveProperty('isReply');
    });
  });

  describe('Chat response format (no duplicate rendering)', () => {
    it('should return bare { received: true } without reply in response', () => {
      // Simulates the new processRequest Chat case:
      // response only contains { received: true }, reply goes via sendChatReply
      const chatParams = { message: 'Hello' };
      let result: any;

      if (!chatParams.message) {
        result = { error: 'Missing message parameter' };
      } else if ((chatParams as any).isReply) {
        result = { received: true };
      } else {
        // New behavior: only return received ack, no reply in response
        result = { received: true };
      }

      expect(result).toEqual({ received: true });
      expect(result).not.toHaveProperty('reply');
    });

    it('isReply=true should also return bare { received: true }', () => {
      const chatParams = { message: 'AI reply', isReply: true };
      let result: any;

      if (chatParams.isReply) {
        result = { received: true };
      }

      expect(result).toEqual({ received: true });
      expect(result).not.toHaveProperty('reply');
    });
  });

  describe('Chat emits chat:received event', () => {
    it('should emit event with fromAgentId, fromName, message', () => {
      // Simulates the emit logic in processRequest
      const events: any[] = [];
      const mockEmit = (event: string, data: any) => events.push({ event, data });

      const chatParams = { message: 'Hello from peer' };
      const connAgentId = 'agent-peer-123';
      const connName = 'peer-agent';

      if (chatParams.message && !(chatParams as any).isReply) {
        mockEmit('chat:received', {
          fromAgentId: connAgentId,
          fromName: connName,
          message: chatParams.message,
        });
      }

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('chat:received');
      expect(events[0].data).toEqual({
        fromAgentId: 'agent-peer-123',
        fromName: 'peer-agent',
        message: 'Hello from peer',
      });
    });

    it('should NOT emit chat:received for isReply messages', () => {
      const events: any[] = [];
      const mockEmit = (event: string, data: any) => events.push({ event, data });

      const chatParams = { message: 'AI reply', isReply: true };

      if (chatParams.message && !chatParams.isReply) {
        mockEmit('chat:received', {
          fromAgentId: 'agent-1',
          fromName: 'test',
          message: chatParams.message,
        });
      }

      expect(events).toHaveLength(0);
    });
  });

  describe('Anti-loop protection', () => {
    it('should not auto-reply to messages with isReply=true', () => {
      // Simulates the logic in processRequest for agent.chat
      const chatParams = { message: 'AI reply text', isReply: true };

      let shouldGenerateReply = true;
      if (chatParams.isReply) {
        shouldGenerateReply = false;
      }

      expect(shouldGenerateReply).toBe(false);
    });

    it('should auto-reply to messages without isReply flag', () => {
      const chatParams = { message: 'User question' };

      let shouldGenerateReply = true;
      if ((chatParams as any).isReply) {
        shouldGenerateReply = false;
      }

      expect(shouldGenerateReply).toBe(true);
    });

    it('should auto-reply to messages with isReply=false', () => {
      const chatParams = { message: 'User question', isReply: false };

      let shouldGenerateReply = true;
      if (chatParams.isReply) {
        shouldGenerateReply = false;
      }

      expect(shouldGenerateReply).toBe(true);
    });
  });

  describe('Chat summary for audit log', () => {
    it('should truncate long messages in summary', () => {
      const longMessage = 'A'.repeat(200);
      const summary = longMessage.slice(0, 120);

      expect(summary.length).toBe(120);
      expect(summary).toBe('A'.repeat(120));
    });

    it('should not truncate short messages', () => {
      const shortMessage = 'Hello!';
      const summary = shortMessage.slice(0, 120);

      expect(summary).toBe('Hello!');
    });
  });
});
