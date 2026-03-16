/**
 * Tests for collapsible system message logic and chat text extraction in NetworkPanel.
 * These functions group simple protocol messages (ack, ping/pong, handshake)
 * into collapsed dividers similar to Feishu's read receipts.
 */
import { describe, it, expect } from 'vitest';
import {
  isCollapsibleSystemMessage,
  summarizeCollapsedMessages,
  groupCollapsibleMessages,
  extractChatText,
} from '../../src/web/client/src/pages/CustomizePage/NetworkPanel';

// Helper to create a minimal AuditLogEntry
function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    direction: 'inbound' as const,
    fromAgentId: 'agent-a',
    fromName: 'Agent A',
    toAgentId: 'agent-b',
    toName: 'Agent B',
    messageType: 'query' as 'query' | 'task' | 'notify' | 'response' | 'chat',
    method: 'agent.chat',
    summary: 'test message',
    success: true,
    ...overrides,
  };
}

describe('isCollapsibleSystemMessage', () => {
  it('collapses ALL response messages — bare ack', () => {
    const entry = makeEntry({
      messageType: 'response',
      payload: JSON.stringify({ result: { received: true } }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — pong result', () => {
    const entry = makeEntry({
      messageType: 'response',
      method: 'agent.ping',
      payload: JSON.stringify({ result: { pong: true, timestamp: Date.now() } }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — empty result', () => {
    const entry = makeEntry({
      messageType: 'response',
      payload: JSON.stringify({ result: {} }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — null result', () => {
    const entry = makeEntry({
      messageType: 'response',
      payload: JSON.stringify({ result: null }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — no payload', () => {
    const entry = makeEntry({ messageType: 'response' });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — tool result', () => {
    const entry = makeEntry({
      messageType: 'response',
      payload: JSON.stringify({ result: { toolName: 'Bash', result: { output: 'hello' } } }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses ALL response messages — meaningful data', () => {
    const entry = makeEntry({
      messageType: 'response',
      payload: JSON.stringify({ result: { status: 'completed', message: 'Task done' } }),
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses outbound ping request', () => {
    const entry = makeEntry({
      messageType: 'query',
      method: 'agent.ping',
      direction: 'outbound',
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses agent.getIdentity (protocol handshake)', () => {
    const entry = makeEntry({
      messageType: 'query',
      method: 'agent.getIdentity',
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('collapses agent.listTools (protocol handshake)', () => {
    const entry = makeEntry({
      messageType: 'query',
      method: 'agent.listTools',
    });
    expect(isCollapsibleSystemMessage(entry)).toBe(true);
  });

  it('does NOT collapse chat messages', () => {
    const entry = makeEntry({ messageType: 'chat', method: 'agent.chat' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse query messages with agent.chat', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.chat' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse task messages', () => {
    const entry = makeEntry({ messageType: 'task', method: 'agent.delegateTask' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse notify messages', () => {
    const entry = makeEntry({ messageType: 'notify' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse agent.callTool query', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.callTool' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse agent.message (chat-like via non-standard method)', () => {
    // agent.message is not in AgentMethod enum but carries chat content
    // Backend should now classify it as messageType=chat, but even if query, it should not collapse
    const entry = makeEntry({ messageType: 'query', method: 'agent.message' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });

  it('does NOT collapse agent.message classified as chat', () => {
    const entry = makeEntry({ messageType: 'chat', method: 'agent.message' });
    expect(isCollapsibleSystemMessage(entry)).toBe(false);
  });
});

describe('summarizeCollapsedMessages', () => {
  it('summarizes ping-only group', () => {
    const entries = [
      makeEntry({ method: 'agent.ping', messageType: 'query' }),
      makeEntry({ method: 'agent.ping', messageType: 'query' }),
    ];
    expect(summarizeCollapsedMessages(entries)).toBe('2 ping');
  });

  it('summarizes ack-only group', () => {
    const entries = [
      makeEntry({ messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
    ];
    expect(summarizeCollapsedMessages(entries)).toBe('3 ack');
  });

  it('summarizes single ack without count prefix', () => {
    const entries = [
      makeEntry({ messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
    ];
    expect(summarizeCollapsedMessages(entries)).toBe('ack');
  });

  it('summarizes mixed ping + ack', () => {
    const entries = [
      makeEntry({ method: 'agent.ping', messageType: 'query' }),
      makeEntry({ method: 'agent.ping', messageType: 'response', payload: JSON.stringify({ result: { pong: true } }) }),
    ];
    const result = summarizeCollapsedMessages(entries);
    expect(result).toContain('ping');
    expect(result).toContain('ack');
  });

  it('summarizes handshake-only group as system', () => {
    const entries = [
      makeEntry({ method: 'agent.getIdentity', messageType: 'query' }),
      makeEntry({ method: 'agent.listTools', messageType: 'query' }),
    ];
    // Neither ping nor response, so falls through to "system"
    const result = summarizeCollapsedMessages(entries);
    expect(result).toBe('2 system');
  });
});

describe('groupCollapsibleMessages', () => {
  it('returns all messages as-is when none are collapsible', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'chat', method: 'agent.chat' }),
      makeEntry({ id: '2', messageType: 'chat', method: 'agent.chat' }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('message');
  });

  it('groups consecutive collapsible messages', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'chat', method: 'agent.chat' }),
      makeEntry({ id: '2', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ id: '3', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ id: '4', messageType: 'response', payload: JSON.stringify({ result: {} }) }),
      makeEntry({ id: '5', messageType: 'chat', method: 'agent.chat' }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('collapsed');
    if (result[1].type === 'collapsed') {
      expect(result[1].entries).toHaveLength(3);
    }
    expect(result[2].type).toBe('message');
  });

  it('handles collapsible messages at the beginning', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ id: '2', messageType: 'chat', method: 'agent.chat' }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('collapsed');
    expect(result[1].type).toBe('message');
  });

  it('handles collapsible messages at the end', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'chat', method: 'agent.chat' }),
      makeEntry({ id: '2', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('message');
    expect(result[1].type).toBe('collapsed');
  });

  it('handles all collapsible messages', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ id: '2', method: 'agent.ping', messageType: 'query' }),
      makeEntry({ id: '3', messageType: 'response', payload: JSON.stringify({ result: { pong: true } }) }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('collapsed');
    if (result[0].type === 'collapsed') {
      expect(result[0].entries).toHaveLength(3);
    }
  });

  it('handles empty message list', () => {
    const result = groupCollapsibleMessages([]);
    expect(result).toHaveLength(0);
  });

  it('creates separate collapsed groups for non-consecutive collapsible blocks', () => {
    const messages = [
      makeEntry({ id: '1', messageType: 'response', payload: JSON.stringify({ result: { received: true } }) }),
      makeEntry({ id: '2', messageType: 'chat', method: 'agent.chat' }),
      makeEntry({ id: '3', messageType: 'response', payload: JSON.stringify({ result: {} }) }),
      makeEntry({ id: '4', method: 'agent.ping', messageType: 'query' }),
    ];
    const result = groupCollapsibleMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('collapsed');
    expect(result[1].type).toBe('message');
    expect(result[2].type).toBe('collapsed');
    if (result[2].type === 'collapsed') {
      expect(result[2].entries).toHaveLength(2);
    }
  });
});

describe('extractChatText', () => {
  it('extracts text from chat messageType via summary', () => {
    const entry = makeEntry({ messageType: 'chat', summary: 'Hello world', method: 'agent.chat' });
    expect(extractChatText(entry, null)).toBe('Hello world');
  });

  it('extracts text from params.message in payload', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message', summary: 'Request: agent.message' });
    const payload = { jsonrpc: '2.0', method: 'agent.message', params: { message: 'Hi there' } };
    expect(extractChatText(entry, payload)).toBe('Hi there');
  });

  it('extracts text from params.content in payload', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message', summary: 'Request: agent.message' });
    const payload = { jsonrpc: '2.0', method: 'agent.message', params: { content: 'I am Axon' } };
    expect(extractChatText(entry, payload)).toBe('I am Axon');
  });

  it('extracts text from top-level message in payload', () => {
    const entry = makeEntry({ messageType: 'query', method: 'custom.method' });
    const payload = { message: 'Top level message' };
    expect(extractChatText(entry, payload)).toBe('Top level message');
  });

  it('extracts text from result.message in response payload', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message' });
    const payload = { result: { message: 'Response text' } };
    expect(extractChatText(entry, payload)).toBe('Response text');
  });

  it('extracts text from result.content in response payload', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message' });
    const payload = { result: { content: 'Response content' } };
    expect(extractChatText(entry, payload)).toBe('Response content');
  });

  it('uses summary as fallback for chat-like methods', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message', summary: 'Meaningful text' });
    // No payload at all
    expect(extractChatText(entry, null)).toBe('Meaningful text');
  });

  it('returns null for non-chat methods with no text', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.callTool', summary: 'Request: agent.callTool' });
    expect(extractChatText(entry, null)).toBeNull();
  });

  it('returns null when summary matches "Request: method"', () => {
    const entry = makeEntry({ messageType: 'chat', method: 'agent.chat', summary: 'Request: agent.chat' });
    // messageType is chat but summary is the default "Request:" format → no text
    // But no payload either, so null
    expect(extractChatText(entry, null)).toBeNull();
  });

  it('ignores empty/whitespace strings in params', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message', summary: 'Request: agent.message' });
    const payload = { params: { message: '   ', content: '' } };
    // Falls through to method-name check for agent.message
    expect(extractChatText(entry, payload)).toBeNull();
  });

  it('prefers params.message over params.content', () => {
    const entry = makeEntry({ messageType: 'query', method: 'agent.message' });
    const payload = { params: { message: 'From message', content: 'From content' } };
    expect(extractChatText(entry, payload)).toBe('From message');
  });
});
