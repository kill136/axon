/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

import { useWebSocket } from '../../src/web/client/src/hooks/useWebSocket';

const SESSION_ID_STORAGE_KEY = 'claude-code-current-session-id';

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(): void {}

  close(): void {}
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sentMessages: unknown[] = [];

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function HookHarness({ receivedMessages }: { receivedMessages?: unknown[] }) {
  const { addMessageHandler } = useWebSocket('ws://localhost:3456/ws');

  ClientReact.useEffect(() => {
    if (!receivedMessages) {
      return;
    }
    return addMessageHandler((message) => {
      receivedMessages.push(message);
    });
  }, [addMessageHandler, receivedMessages]);

  return null;
}

describe('useWebSocket recovery', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    localStorage.clear();
    MockWebSocket.instances = [];
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    ClientReact.act(() => {
      root.unmount();
    });
    container.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should request a fresh session when restoring a stale session fails', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'stale-session');

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness));
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'temporary-session', model: 'opus' },
      });
      vi.advanceTimersByTime(100);
    });

    expect(ws.sentMessages).toContainEqual({
      type: 'session_switch',
      payload: { sessionId: 'stale-session' },
    });

    ClientReact.act(() => {
      ws.emitMessage({
        type: 'error',
        payload: { message: 'Session does not exist or failed to load' },
      });
    });

    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(ws.sentMessages).toContainEqual({
      type: 'session_new',
      payload: {},
    });
  });

  it('should only request one fresh session for repeated restore errors', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'stale-session');

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness));
    });

    const ws = MockWebSocket.instances[0];

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'temporary-session', model: 'opus' },
      });
      vi.advanceTimersByTime(100);
      ws.emitMessage({
        type: 'error',
        payload: { message: 'Session does not exist or failed to load' },
      });
      ws.emitMessage({
        type: 'error',
        payload: { message: 'Session does not exist or failed to load' },
      });
    });

    const freshSessionRequests = ws.sentMessages.filter((message) => (
      typeof message === 'object'
      && message !== null
      && (message as { type?: string }).type === 'session_new'
    ));

    expect(freshSessionRequests).toHaveLength(1);
  });

  it('should suppress stale restore errors from app message handlers', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'stale-session');
    const receivedMessages: unknown[] = [];

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness, { receivedMessages }));
    });

    const ws = MockWebSocket.instances[0];

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'temporary-session', model: 'opus' },
      });
      vi.advanceTimersByTime(100);
      ws.emitMessage({
        type: 'error',
        payload: { message: 'Session does not exist or failed to load' },
      });
    });

    expect(receivedMessages.some((message) => (
      typeof message === 'object'
      && message !== null
      && (message as { type?: string }).type === 'error'
    ))).toBe(false);
  });

  it('should still forward normal errors to app message handlers', () => {
    const receivedMessages: unknown[] = [];

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness, { receivedMessages }));
    });

    const ws = MockWebSocket.instances[0];

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'temporary-session', model: 'opus' },
      });
      ws.emitMessage({
        type: 'error',
        payload: { message: 'Failed to switch session' },
      });
    });

    expect(receivedMessages).toContainEqual({
      type: 'error',
      payload: { message: 'Failed to switch session' },
    });
  });

  it('should drop streaming messages from non-active sessions before they reach app handlers', () => {
    const receivedMessages: unknown[] = [];

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness, { receivedMessages }));
    });

    const ws = MockWebSocket.instances[0];

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'active-session', model: 'opus' },
      });
      ws.emitMessage({
        type: 'text_delta',
        payload: { sessionId: 'background-session', text: 'background token' },
      });
      ws.emitMessage({
        type: 'tool_use_start',
        payload: { sessionId: 'background-session', toolUseId: 'tool-1', toolName: 'Read' },
      });
      ws.emitMessage({
        type: 'text_delta',
        payload: { sessionId: 'active-session', text: 'foreground token' },
      });
    });

    expect(receivedMessages).toContainEqual({
      type: 'text_delta',
      payload: { sessionId: 'active-session', text: 'foreground token' },
    });
    expect(receivedMessages).not.toContainEqual({
      type: 'text_delta',
      payload: { sessionId: 'background-session', text: 'background token' },
    });
    expect(receivedMessages).not.toContainEqual({
      type: 'tool_use_start',
      payload: { sessionId: 'background-session', toolUseId: 'tool-1', toolName: 'Read' },
    });
  });

  it('should keep forwarding cross-session status and permission signals', () => {
    const receivedMessages: unknown[] = [];

    ClientReact.act(() => {
      root.render(ClientReact.createElement(HookHarness, { receivedMessages }));
    });

    const ws = MockWebSocket.instances[0];

    ClientReact.act(() => {
      ws.emitOpen();
      ws.emitMessage({
        type: 'connected',
        payload: { sessionId: 'active-session', model: 'opus' },
      });
      ws.emitMessage({
        type: 'status',
        payload: { sessionId: 'background-session', status: 'thinking' },
      });
      ws.emitMessage({
        type: 'permission_request',
        payload: { sessionId: 'background-session', requestId: 'perm-1', tool: 'Bash' },
      });
    });

    expect(receivedMessages).toContainEqual({
      type: 'status',
      payload: { sessionId: 'background-session', status: 'thinking' },
    });
    expect(receivedMessages).toContainEqual({
      type: 'permission_request',
      payload: { sessionId: 'background-session', requestId: 'perm-1', tool: 'Bash' },
    });
  });
});
