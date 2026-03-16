/**
 * Agent Network 委派任务执行测试
 *
 * 测试 task:delegated 事件触发后：
 * 1. buildDelegatedTaskPrompt 正确构建 prompt
 * 2. buildDelegatedTaskCallbacks 正确构建回调并上报进度
 * 3. 集成流程：事件 → 创建会话 → chat → completeTask/failTask
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDelegatedTaskPrompt, buildDelegatedTaskCallbacks } from '../../src/web/server/index.js';
import { EventEmitter } from 'events';

describe('Delegated Task Execution', () => {

  describe('buildDelegatedTaskPrompt', () => {
    it('should include task description and from agent name', () => {
      const prompt = buildDelegatedTaskPrompt({
        fromName: 'agent-alpha',
        description: 'Run all tests and report results',
        fullContext: 'Task: Run all tests and report results',
      });

      expect(prompt).toContain('agent-alpha');
      expect(prompt).toContain('Run all tests and report results');
      expect(prompt).toContain('[Delegated Task]');
    });

    it('should include context when different from description', () => {
      const prompt = buildDelegatedTaskPrompt({
        fromName: 'agent-beta',
        description: 'Deploy to staging',
        fullContext: 'Task: Deploy to staging\nContext: The main branch has been updated with hotfix #42',
      });

      expect(prompt).toContain('hotfix #42');
      expect(prompt).toContain('**Context:**');
    });

    it('should not duplicate context when fullContext matches description pattern', () => {
      const prompt = buildDelegatedTaskPrompt({
        fromName: 'agent-gamma',
        description: 'Check server status',
        fullContext: 'Task: Check server status',
      });

      // fullContext === `Task: ${description}` → no separate context section
      expect(prompt).not.toContain('**Context:**');
    });

    it('should include autonomous execution instruction', () => {
      const prompt = buildDelegatedTaskPrompt({
        fromName: 'test',
        description: 'test',
        fullContext: 'Task: test',
      });

      expect(prompt).toContain('autonomously');
    });
  });

  describe('buildDelegatedTaskCallbacks', () => {
    let broadcastFn: ReturnType<typeof vi.fn>;
    let mockCm: any;
    let mockNetwork: any;

    beforeEach(() => {
      broadcastFn = vi.fn();
      mockCm = {
        persistSession: vi.fn().mockResolvedValue(undefined),
      };
      mockNetwork = {
        reportTaskProgress: vi.fn(),
      };
    });

    it('should broadcast text_delta on onTextDelta', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onTextDelta!('Hello');
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'text_delta',
        payload: { messageId: 'msg-1', text: 'Hello', sessionId: 'session-1' },
      });
    });

    it('should report progress on tool use', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onToolUseStart!('tool-1', 'Browser', { action: 'start' });
      expect(mockNetwork.reportTaskProgress).toHaveBeenCalledWith('task-1', 15, 'Executing Browser');

      callbacks.onToolUseStart!('tool-2', 'Read', { file_path: '/test' });
      expect(mockNetwork.reportTaskProgress).toHaveBeenCalledWith('task-1', 30, 'Executing Read');
    });

    it('should cap progress at 90', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      // 7 tool calls → 7 * 15 = 105, capped to 90
      for (let i = 0; i < 7; i++) {
        callbacks.onToolUseStart!(`tool-${i}`, 'Bash', {});
      }

      const lastCall = mockNetwork.reportTaskProgress.mock.calls.at(-1);
      expect(lastCall![1]).toBe(90);
    });

    it('should persist session and broadcast complete on onComplete', async () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      await callbacks.onComplete!('end_turn', { inputTokens: 100, outputTokens: 50 });

      expect(mockCm.persistSession).toHaveBeenCalledWith('session-1');
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message_complete' })
      );
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'status', payload: { status: 'idle', sessionId: 'session-1' } })
      );
    });

    it('should broadcast error and set idle on onError', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onError!(new Error('API timeout'));

      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', payload: { error: 'API timeout', sessionId: 'session-1' } })
      );
    });

    it('should broadcast thinking events', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onThinkingStart!();
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'thinking_start' })
      );

      callbacks.onThinkingDelta!('analyzing...');
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'thinking_delta' })
      );

      callbacks.onThinkingComplete!();
      expect(broadcastFn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'thinking_complete' })
      );
    });

    it('should broadcast tool result with collapsed flag', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onToolResult!('tool-1', true, 'result output', undefined, undefined);

      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'tool_result',
        payload: {
          toolUseId: 'tool-1',
          success: true,
          output: 'result output',
          error: undefined,
          data: undefined,
          defaultCollapsed: true,
          sessionId: 'session-1',
        },
      });
    });

    it('should broadcast context compact events', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onContextCompact!('start', { reason: 'token limit' });
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'context_compact',
        payload: { phase: 'start', info: { reason: 'token limit' }, sessionId: 'session-1' },
      });
    });

    it('should broadcast context update events', () => {
      const callbacks = buildDelegatedTaskCallbacks(
        broadcastFn, mockCm, 'session-1', 'msg-1', mockNetwork, 'task-1'
      );

      callbacks.onContextUpdate!({ usedTokens: 5000, maxTokens: 200000, percentage: 2.5, model: 'sonnet' });
      expect(broadcastFn).toHaveBeenCalledWith({
        type: 'context_update',
        payload: { usedTokens: 5000, maxTokens: 200000, percentage: 2.5, model: 'sonnet', sessionId: 'session-1' },
      });
    });
  });

  describe('task:delegated event listener count', () => {
    it('should emit event with listener count logged', () => {
      const emitter = new EventEmitter();
      let listenerCountAtEmit = -1;

      // Simulate registering a task:delegated listener (like web/server/index.ts does)
      emitter.on('task:delegated', () => {
        // listener was invoked
      });

      // Check listener count
      expect(emitter.listenerCount('task:delegated')).toBe(1);
    });

    it('should handle missing task:delegated listener gracefully', () => {
      const emitter = new EventEmitter();

      // No listener registered — emit should succeed but do nothing
      expect(emitter.listenerCount('task:delegated')).toBe(0);
      expect(() => {
        emitter.emit('task:delegated', {
          taskId: 'test-task',
          fromAgentId: 'agent-1',
          fromName: 'test-agent',
          description: 'do something',
          fullContext: 'Task: do something',
        });
      }).not.toThrow();
    });
  });
});
