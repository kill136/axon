/**
 * Agent Chat Callbacks 测试
 *
 * 验证 buildAgentChatCallbacks 函数：
 * - 标准流式回调（thinking/text/tool/complete）正确广播
 * - onComplete 时自动提取 AI 回复并转发给对方 agent
 * - 不上报 task progress（区别于 buildDelegatedTaskCallbacks）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAgentChatCallbacks } from '../../src/web/server/index.js';

// Mock ConversationManager
function createMockCM(history: any[] = []) {
  return {
    persistSession: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockReturnValue(history),
  } as any;
}

// Mock AgentNetwork
function createMockNetwork() {
  return {
    sendChatReply: vi.fn().mockResolvedValue(undefined),
    reportTaskProgress: vi.fn(),
  } as any;
}

describe('buildAgentChatCallbacks', () => {
  let broadcastFn: ReturnType<typeof vi.fn>;
  let cm: ReturnType<typeof createMockCM>;
  let network: ReturnType<typeof createMockNetwork>;
  let chatLog: ReturnType<typeof vi.fn>;
  let chatErr: ReturnType<typeof vi.fn>;

  const sessionId = 'test-session-123';
  const messageId = 'test-msg-456';
  const targetAgentId = 'agent-abc-789';

  beforeEach(() => {
    broadcastFn = vi.fn();
    cm = createMockCM();
    network = createMockNetwork();
    chatLog = vi.fn();
    chatErr = vi.fn();
  });

  function getCallbacks() {
    return buildAgentChatCallbacks(
      broadcastFn, cm, sessionId, messageId,
      network, targetAgentId, chatLog, chatErr,
    );
  }

  describe('streaming callbacks', () => {
    it('should broadcast thinking events', () => {
      const cb = getCallbacks();
      cb.onThinkingStart!();
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'thinking_start',
        payload: { messageId, sessionId },
      });

      cb.onThinkingDelta!('thinking...');
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'thinking_delta',
        payload: { messageId, text: 'thinking...', sessionId },
      });

      cb.onThinkingComplete!();
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'thinking_complete',
        payload: { messageId, sessionId },
      });
    });

    it('should broadcast text delta', () => {
      const cb = getCallbacks();
      cb.onTextDelta!('hello ');
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'text_delta',
        payload: { messageId, text: 'hello ', sessionId },
      });
    });

    it('should broadcast tool use events', () => {
      const cb = getCallbacks();
      cb.onToolUseStart!('tool-1', 'Read', { file_path: '/test' });
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_use_start',
          payload: expect.objectContaining({ toolName: 'Read', sessionId }),
        }),
      );
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          payload: expect.objectContaining({ status: 'tool_executing' }),
        }),
      );
    });

    it('should NOT call reportTaskProgress (unlike delegated task callbacks)', () => {
      const cb = getCallbacks();
      cb.onToolUseStart!('tool-1', 'Read', {});
      expect(network.reportTaskProgress).not.toHaveBeenCalled();
    });

    it('should broadcast tool result', () => {
      const cb = getCallbacks();
      cb.onToolResult!('tool-1', true, 'file content', undefined, undefined);
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          payload: expect.objectContaining({ toolUseId: 'tool-1', success: true, sessionId }),
        }),
      );
    });

    it('should broadcast error', () => {
      const cb = getCallbacks();
      cb.onError!(new Error('test error'));
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'error',
        payload: { error: 'test error', sessionId },
      });
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'status',
        payload: { status: 'idle', sessionId },
      });
    });
  });

  describe('onComplete - auto reply to agent', () => {
    it('should persist session and broadcast complete', async () => {
      const cb = getCallbacks();
      await cb.onComplete!('end_turn', { inputTokens: 100, outputTokens: 50 });

      expect(cm.persistSession).toHaveBeenCalledWith(sessionId);
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message_complete',
          payload: expect.objectContaining({ messageId, sessionId }),
        }),
      );
    });

    it('should extract AI reply and send to agent', async () => {
      cm = createMockCM([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
      ]);

      const cb = buildAgentChatCallbacks(
        broadcastFn, cm, sessionId, messageId,
        network, targetAgentId, chatLog, chatErr,
      );
      await cb.onComplete!('end_turn');

      expect(network.sendChatReply).toHaveBeenCalledWith(targetAgentId, 'Hi there!');
      expect(chatLog).toHaveBeenCalledWith(expect.stringContaining('Sending reply'));
    });

    it('should not send reply if no assistant message', async () => {
      cm = createMockCM([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ]);

      const cb = buildAgentChatCallbacks(
        broadcastFn, cm, sessionId, messageId,
        network, targetAgentId, chatLog, chatErr,
      );
      await cb.onComplete!('end_turn');

      expect(network.sendChatReply).not.toHaveBeenCalled();
    });

    it('should extract last assistant message (skip tool_use blocks)', async () => {
      cm = createMockCM([
        { role: 'user', content: [{ type: 'text', text: 'what time?' }] },
        { role: 'assistant', content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
        ] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '15:30' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'It is 15:30.' }] },
      ]);

      const cb = buildAgentChatCallbacks(
        broadcastFn, cm, sessionId, messageId,
        network, targetAgentId, chatLog, chatErr,
      );
      await cb.onComplete!('end_turn');

      expect(network.sendChatReply).toHaveBeenCalledWith(targetAgentId, 'It is 15:30.');
    });

    it('should log error if sendChatReply fails', async () => {
      const sendError = new Error('connection lost');
      network.sendChatReply = vi.fn().mockRejectedValue(sendError);

      cm = createMockCM([
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
      ]);

      const cb = buildAgentChatCallbacks(
        broadcastFn, cm, sessionId, messageId,
        network, targetAgentId, chatLog, chatErr,
      );
      await cb.onComplete!('end_turn');

      // sendChatReply is called but error is caught in .catch()
      expect(network.sendChatReply).toHaveBeenCalled();
      // Wait for the promise rejection to be handled
      await new Promise(r => setTimeout(r, 10));
      expect(chatErr).toHaveBeenCalledWith('Failed to send reply', sendError);
    });
  });
});
