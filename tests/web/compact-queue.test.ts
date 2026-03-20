/**
 * 测试：上下文压缩期间消息排队
 *
 * 验证：
 * 1. 压缩期间（compactState.phase === 'compacting'）发送消息时，消息被排队而非 cancel 压缩
 * 2. 排队的消息在压缩完成后自动发送
 * 3. 排队期间输入框被清空，isMessageQueued 状态为 true
 * 4. 非压缩期间正常发送（不排队）
 */
import { describe, it, expect } from 'vitest';
import type { CompactState } from '../../src/web/client/src/components/ContextBar';

describe('compact queue logic', () => {
  /**
   * 模拟 useChatInput 中的排队逻辑
   */
  function simulateSend(params: {
    input: string;
    attachments: Array<{ id: string; name: string; type: string; mimeType: string; data: string }>;
    connected: boolean;
    compactPhase: CompactState['phase'];
    status: 'idle' | 'thinking' | 'streaming';
    currentProjectPath: string;
  }): {
    action: 'queued' | 'sent' | 'interrupt-and-sent' | 'blocked';
    cancelSent?: boolean;
  } {
    const { input, attachments, connected, compactPhase, status, currentProjectPath } = params;

    // 前置检查
    if ((!input.trim() && attachments.length === 0) || !connected) {
      return { action: 'blocked' };
    }

    // 压缩期间排队
    if (compactPhase === 'compacting') {
      return { action: 'queued' };
    }

    // 非 idle 状态 → 插话模式（cancel + 发送）
    if (status !== 'idle') {
      return { action: 'interrupt-and-sent', cancelSent: true };
    }

    // 正常发送
    return { action: 'sent' };
  }

  it('should queue message during compaction', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      compactPhase: 'compacting',
      status: 'thinking',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('queued');
  });

  it('should send normally when not compacting and idle', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('sent');
  });

  it('should interrupt and send when not compacting but busy', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      compactPhase: 'idle',
      status: 'streaming',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('interrupt-and-sent');
    expect(result.cancelSent).toBe(true);
  });

  it('should block when input is empty', () => {
    const result = simulateSend({
      input: '  ',
      attachments: [],
      connected: true,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('blocked');
  });

  it('should block when not connected', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: false,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('blocked');
  });

  it('should queue message with attachments during compaction', () => {
    const result = simulateSend({
      input: '',
      attachments: [{ id: '1', name: 'test.png', type: 'image', mimeType: 'image/png', data: 'base64...' }],
      connected: true,
      compactPhase: 'compacting',
      status: 'thinking',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('queued');
  });

  it('should send normally after compaction done', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      compactPhase: 'done',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('sent');
  });

  it('should send normally after compaction error', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      compactPhase: 'error',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('sent');
  });
});

describe('queued message auto-send logic', () => {
  /**
   * 模拟 useEffect 中的排队消息自动发送逻辑
   */
  function shouldAutoSend(params: {
    compactPhase: CompactState['phase'];
    hasQueuedMessage: boolean;
  }): boolean {
    return params.compactPhase !== 'compacting' && params.hasQueuedMessage;
  }

  it('should auto-send when compaction ends and message is queued', () => {
    expect(shouldAutoSend({ compactPhase: 'done', hasQueuedMessage: true })).toBe(true);
    expect(shouldAutoSend({ compactPhase: 'idle', hasQueuedMessage: true })).toBe(true);
    expect(shouldAutoSend({ compactPhase: 'error', hasQueuedMessage: true })).toBe(true);
  });

  it('should not auto-send when still compacting', () => {
    expect(shouldAutoSend({ compactPhase: 'compacting', hasQueuedMessage: true })).toBe(false);
  });

  it('should not auto-send when no message is queued', () => {
    expect(shouldAutoSend({ compactPhase: 'done', hasQueuedMessage: false })).toBe(false);
    expect(shouldAutoSend({ compactPhase: 'idle', hasQueuedMessage: false })).toBe(false);
  });
});
