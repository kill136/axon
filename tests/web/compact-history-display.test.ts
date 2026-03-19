/**
 * 压缩后历史消息显示逻辑测试
 * 验证 compact boundary 后旧消息和新消息的分离逻辑
 */

import { describe, it, expect } from 'vitest';

interface ChatMessage {
  id: string;
  role: string;
  timestamp: number;
  content: Array<{ type: string; text?: string }>;
  isCompactBoundary?: boolean;
  isCompactSummary?: boolean;
  isVisibleInTranscriptOnly?: boolean;
}

/**
 * 从 App.tsx 提取的核心逻辑：
 * 计算压缩边界，分离旧消息和当前消息
 */
function computeCompactSplit(messages: ChatMessage[]) {
  let boundaryIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isCompactBoundary) {
      boundaryIdx = i;
      break;
    }
  }
  if (boundaryIdx === -1) {
    return { compactedMessages: [] as ChatMessage[], activeMessages: messages, lastBoundaryIndex: -1 };
  }
  // 旧消息：boundary 之前的所有消息（排除 summary 等仅 transcript 可见的消息）
  const old = messages.slice(0, boundaryIdx).filter(msg => !msg.isCompactSummary && !msg.isCompactBoundary);
  // 当前消息：从 boundary 开始（包含 boundary 本身），排除 transcript-only 消息
  const active = messages.slice(boundaryIdx).filter(msg => !msg.isVisibleInTranscriptOnly || msg.isCompactBoundary);
  return { compactedMessages: old, activeMessages: active, lastBoundaryIndex: boundaryIdx };
}

/**
 * 从 App.tsx 提取的 visibleMessages 逻辑
 */
function computeVisibleMessages(messages: ChatMessage[], isTranscriptMode: boolean, activeMessages: ChatMessage[]) {
  if (isTranscriptMode) {
    return messages;
  }
  return activeMessages;
}

// 工厂函数
function makeMsg(id: string, role: string, text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id,
    role,
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
    ...extra,
  };
}

describe('压缩后历史消息显示', () => {
  describe('computeCompactSplit', () => {
    it('无 boundary 时，所有消息都是 active', () => {
      const messages = [
        makeMsg('1', 'user', 'hello'),
        makeMsg('2', 'assistant', 'hi'),
        makeMsg('3', 'user', 'bye'),
      ];
      const result = computeCompactSplit(messages);
      expect(result.compactedMessages).toHaveLength(0);
      expect(result.activeMessages).toEqual(messages);
      expect(result.lastBoundaryIndex).toBe(-1);
    });

    it('有 boundary 时，正确分离旧消息和当前消息', () => {
      const messages = [
        makeMsg('1', 'user', 'old message 1'),
        makeMsg('2', 'assistant', 'old reply 1'),
        makeMsg('3', 'user', 'old message 2'),
        makeMsg('4', 'assistant', 'old reply 2'),
        makeMsg('boundary', 'system', '对话已压缩', { isCompactBoundary: true }),
        makeMsg('summary', 'user', 'summary text', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
        makeMsg('5', 'user', 'new message'),
        makeMsg('6', 'assistant', 'new reply'),
      ];
      const result = computeCompactSplit(messages);

      // 旧消息不包含 boundary 和 summary
      expect(result.compactedMessages).toHaveLength(4);
      expect(result.compactedMessages.map(m => m.id)).toEqual(['1', '2', '3', '4']);

      // 当前消息包含 boundary 但不包含 transcript-only 的 summary
      expect(result.activeMessages).toHaveLength(3); // boundary + new message + new reply
      expect(result.activeMessages.map(m => m.id)).toEqual(['boundary', '5', '6']);

      expect(result.lastBoundaryIndex).toBe(4);
    });

    it('多次压缩时，使用最后一个 boundary', () => {
      const messages = [
        makeMsg('1', 'user', 'very old'),
        makeMsg('boundary1', 'system', '第一次压缩', { isCompactBoundary: true }),
        makeMsg('2', 'user', 'middle'),
        makeMsg('3', 'assistant', 'middle reply'),
        makeMsg('boundary2', 'system', '第二次压缩', { isCompactBoundary: true }),
        makeMsg('4', 'user', 'latest'),
        makeMsg('5', 'assistant', 'latest reply'),
      ];
      const result = computeCompactSplit(messages);

      // 旧消息：boundary2 之前的所有非 boundary 消息
      expect(result.compactedMessages.map(m => m.id)).toEqual(['1', '2', '3']);

      // 当前消息：从 boundary2 开始
      expect(result.activeMessages.map(m => m.id)).toEqual(['boundary2', '4', '5']);
      expect(result.lastBoundaryIndex).toBe(4);
    });

    it('boundary 是最后一条消息时，没有 active 内容消息', () => {
      const messages = [
        makeMsg('1', 'user', 'old'),
        makeMsg('2', 'assistant', 'old reply'),
        makeMsg('boundary', 'system', '压缩', { isCompactBoundary: true }),
      ];
      const result = computeCompactSplit(messages);

      expect(result.compactedMessages).toHaveLength(2);
      expect(result.activeMessages).toHaveLength(1); // 只有 boundary
      expect(result.activeMessages[0].id).toBe('boundary');
    });

    it('旧消息中的 summary 被过滤掉', () => {
      const messages = [
        makeMsg('1', 'user', 'old'),
        makeMsg('old-summary', 'user', 'old summary', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
        makeMsg('old-boundary', 'system', '旧压缩', { isCompactBoundary: true }),
        makeMsg('2', 'user', 'middle'),
        makeMsg('boundary', 'system', '新压缩', { isCompactBoundary: true }),
        makeMsg('3', 'user', 'new'),
      ];
      const result = computeCompactSplit(messages);

      // 旧消息不包含 old-summary 和 old-boundary
      expect(result.compactedMessages.map(m => m.id)).toEqual(['1', '2']);
    });
  });

  describe('computeVisibleMessages', () => {
    it('非 transcript 模式返回 activeMessages', () => {
      const all = [makeMsg('1', 'user', 'old'), makeMsg('2', 'user', 'new')];
      const active = [makeMsg('2', 'user', 'new')];
      const result = computeVisibleMessages(all, false, active);
      expect(result).toBe(active);
    });

    it('transcript 模式返回全部消息', () => {
      const all = [makeMsg('1', 'user', 'old'), makeMsg('2', 'user', 'new')];
      const active = [makeMsg('2', 'user', 'new')];
      const result = computeVisibleMessages(all, true, active);
      expect(result).toBe(all);
    });
  });

  describe('compactedMessages 用于 UI 折叠区域', () => {
    it('用户可以看到旧消息数量', () => {
      const messages = [
        makeMsg('1', 'user', 'q1'),
        makeMsg('2', 'assistant', 'a1'),
        makeMsg('3', 'user', 'q2'),
        makeMsg('4', 'assistant', 'a2'),
        makeMsg('5', 'user', 'q3'),
        makeMsg('6', 'assistant', 'a3'),
        makeMsg('boundary', 'system', '压缩', { isCompactBoundary: true }),
        makeMsg('7', 'user', 'current'),
      ];
      const result = computeCompactSplit(messages);

      // UI 应显示 "6 条历史消息（不在 AI 上下文中）"
      expect(result.compactedMessages.length).toBe(6);

      // 展开后用户可以看到所有旧消息
      expect(result.compactedMessages.every(m => !m.isCompactBoundary && !m.isCompactSummary)).toBe(true);
    });
  });
});
