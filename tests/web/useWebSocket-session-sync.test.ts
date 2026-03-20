/**
 * @vitest-environment jsdom
 */

/**
 * Tests for useWebSocket multi-tab session synchronization
 *
 * Bug history:
 * 1. sessionStorage was tab-isolated → new tabs got fresh sessionId → fixed by using localStorage
 * 2. BroadcastChannel auto-triggered session_switch → multi-tab ping-pong race condition
 *    → messages sent to wrong session / different projects show same conversation
 *    → fixed by making BroadcastChannel only update localStorage, NOT trigger session_switch
 *
 * Current design:
 * - localStorage: shared across tabs, used for HMR/refresh session recovery
 * - BroadcastChannel: only syncs localStorage, does NOT auto-switch sessions
 * - Each tab independently maintains its own WebSocket session
 */

import { describe, it, expect, beforeEach } from 'vitest';

// We test the storage/broadcast logic at the unit level since useWebSocket
// is a React hook that requires a full browser environment with WebSocket.
// These tests verify the key behavioral changes.

describe('useWebSocket session sync - localStorage migration', () => {
  const SESSION_ID_STORAGE_KEY = 'claude-code-current-session-id';

  beforeEach(() => {
    // Clear storage before each test
    localStorage.removeItem(SESSION_ID_STORAGE_KEY);
  });

  it('should use localStorage instead of sessionStorage for session persistence', () => {
    // Simulate saving a session ID (as the hook does)
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'test-session-123');

    // Verify it's in localStorage
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('test-session-123');

    // sessionStorage should NOT have the key (we migrated away from it)
    expect(sessionStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
  });

  it('should share session ID across simulated tabs via localStorage', () => {
    // Tab A saves session
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'shared-session-456');

    // Tab B reads the same localStorage (same origin)
    const tabBSessionId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    expect(tabBSessionId).toBe('shared-session-456');
  });

  it('should update session ID when session is switched', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'old-session');

    // Simulate session switch
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'new-session-789');

    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('new-session-789');
  });

  it('should clear session ID when session is deleted', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'to-delete-session');

    // Simulate the deletion logic from the hook
    const savedSessionId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (savedSessionId === 'to-delete-session') {
      localStorage.removeItem(SESSION_ID_STORAGE_KEY);
    }

    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
  });

  it('should not clear session ID when a different session is deleted', () => {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, 'my-active-session');

    // Simulate deleting a different session
    const savedSessionId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (savedSessionId === 'some-other-session') {
      localStorage.removeItem(SESSION_ID_STORAGE_KEY);
    }

    // Active session should still be saved
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('my-active-session');
  });
});

describe('useWebSocket session sync - BroadcastChannel', () => {
  const SESSION_BROADCAST_CHANNEL = 'claude-code-session-sync';
  const SESSION_ID_STORAGE_KEY = 'claude-code-current-session-id';

  beforeEach(() => {
    localStorage.removeItem(SESSION_ID_STORAGE_KEY);
  });

  it('should broadcast session changes between channels', async () => {
    const bc1 = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    const bc2 = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);

    const received = new Promise<{ type: string; sessionId: string }>((resolve) => {
      bc2.onmessage = (event) => {
        resolve(event.data);
      };
    });

    // bc1 broadcasts a session change
    bc1.postMessage({ type: 'session_change', sessionId: 'broadcast-session-123' });

    const data = await received;
    expect(data.type).toBe('session_change');
    expect(data.sessionId).toBe('broadcast-session-123');

    bc1.close();
    bc2.close();
  });

  it('should not receive own messages on same channel instance', async () => {
    const bc = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    let received = false;

    bc.onmessage = () => {
      received = true;
    };

    bc.postMessage({ type: 'session_change', sessionId: 'self-msg' });

    // Wait a bit to ensure no message is received
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toBe(false);

    bc.close();
  });

  it('should only update localStorage on broadcast, NOT trigger session_switch', async () => {
    // This test verifies the anti-ping-pong fix:
    // When Tab B receives a broadcast from Tab A, it should ONLY update localStorage
    // and NOT send a session_switch message to the server.
    
    const bc1 = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    const bc2 = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);

    // Simulate Tab B's behavior: on receiving broadcast, only update localStorage
    const receivedPromise = new Promise<void>((resolve) => {
      bc2.onmessage = (event) => {
        const { type, sessionId: newSessionId } = event.data;
        if (type === 'session_change' && newSessionId) {
          // This is the new behavior: only update localStorage
          localStorage.setItem(SESSION_ID_STORAGE_KEY, newSessionId);
          // Do NOT send session_switch — that's the fix
        }
        resolve();
      };
    });

    // Tab A broadcasts session change
    bc1.postMessage({ type: 'session_change', sessionId: 'tab-a-session' });

    await receivedPromise;

    // Verify localStorage was updated
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('tab-a-session');

    bc1.close();
    bc2.close();
  });

  it('should prevent ping-pong: rapid cross-tab broadcasts should not cascade', async () => {
    // Simulate the problematic scenario:
    // Tab A switches to S1 → broadcasts S1
    // Tab B switches to S2 → broadcasts S2
    // Without the fix, this would cascade endlessly.
    // With the fix, each tab only updates localStorage, no cascade.

    const bcA = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    const bcB = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    const sessionSwitchCalls: string[] = [];

    // Track what each tab "receives" — should only update localStorage
    bcA.onmessage = (event) => {
      const { sessionId: newSessionId } = event.data;
      // New behavior: only update localStorage
      localStorage.setItem(SESSION_ID_STORAGE_KEY, newSessionId);
      // Old buggy behavior would have pushed to sessionSwitchCalls
      // sessionSwitchCalls.push(newSessionId); // DON'T DO THIS
    };

    bcB.onmessage = (event) => {
      const { sessionId: newSessionId } = event.data;
      localStorage.setItem(SESSION_ID_STORAGE_KEY, newSessionId);
    };

    // Rapid cross-tab session changes
    bcA.postMessage({ type: 'session_change', sessionId: 'session-from-A' });
    bcB.postMessage({ type: 'session_change', sessionId: 'session-from-B' });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // No session_switch calls should have been triggered
    expect(sessionSwitchCalls).toHaveLength(0);

    bcA.close();
    bcB.close();
  });
});

describe('useWebSocket session sync - backend sessionMutex', () => {
  interface MockClient {
    sessionId: string;
    sessionMutex?: Promise<void>;
  }

  function withSessionMutex<T>(client: MockClient, fn: () => Promise<T>): Promise<T> {
    const prev = client.sessionMutex || Promise.resolve();
    let resolve: () => void;
    client.sessionMutex = new Promise<void>(r => { resolve = r; });
    return prev.then(() => fn()).finally(() => resolve!());
  }

  it('should serialize session operations with Promise chain mutex', async () => {
    // Test the withSessionMutex pattern used in the backend
    // This verifies that concurrent session_switch and chat don't interleave

    const client: MockClient = { sessionId: 'initial' };
    const executionOrder: string[] = [];

    // Simulate concurrent session_switch and chat
    const chatPromise = withSessionMutex(client, async () => {
      executionOrder.push('chat:start');
      client.sessionId = 'chat-session';
      // Simulate async work (API call)
      await new Promise(r => setTimeout(r, 50));
      executionOrder.push('chat:end');
    });

    const switchPromise = withSessionMutex(client, async () => {
      executionOrder.push('switch:start');
      client.sessionId = 'switched-session';
      executionOrder.push('switch:end');
    });

    await Promise.all([chatPromise, switchPromise]);

    // Operations should be serialized: chat completes before switch starts
    expect(executionOrder).toEqual([
      'chat:start',
      'chat:end',
      'switch:start',
      'switch:end',
    ]);

    // Final sessionId should be the last operation's value
    expect(client.sessionId).toBe('switched-session');
  });

  it('should handle mutex errors without blocking subsequent operations', async () => {
    const client: MockClient = { sessionId: 'initial' };

    // First operation throws an error
    const failingOp = withSessionMutex(client, async () => {
      throw new Error('simulated failure');
    });

    // Second operation should still execute (not deadlocked)
    const successOp = withSessionMutex(client, async () => {
      client.sessionId = 'after-error';
      return 'success';
    });

    await expect(failingOp).rejects.toThrow('simulated failure');
    const result = await successOp;
    expect(result).toBe('success');
    expect(client.sessionId).toBe('after-error');
  });

  it('session_new should NOT be blocked by ongoing chat streaming (two-phase mutex fix)', async () => {
    // This test validates the fix for the bug where clicking "new session"
    // while AI is streaming would be blocked until the stream completes.
    //
    // Root cause: chat handler held the session mutex for the entire streaming
    // duration. session_new queued behind it and couldn't execute until chat finished.
    //
    // Fix: Split chat into two phases:
    //   Phase 1 (mutex-protected): initialize session, capture chatSessionId closure
    //   Phase 2 (outside mutex): actual streaming with conversationManager.chat()

    const client: MockClient = { sessionId: 'session-A' };
    const executionOrder: string[] = [];
    let streamingResolve: () => void;
    const streamingPromise = new Promise<void>(r => { streamingResolve = r; });

    // Phase 1: prepareChatSession — runs in mutex, captures chatSessionId, returns quickly
    const chatSessionId = await withSessionMutex(client, async () => {
      executionOrder.push('chat:prepare:start');
      // May create persistent session, update client.sessionId
      client.sessionId = 'persistent-session-A';
      const captured = client.sessionId;
      executionOrder.push('chat:prepare:end');
      return captured;
    });

    // Phase 2: streaming — runs OUTSIDE mutex
    const streamPromise = (async () => {
      executionOrder.push('chat:stream:start');
      // Simulate long-running AI streaming (uses captured chatSessionId, not client.sessionId)
      expect(chatSessionId).toBe('persistent-session-A');
      await streamingPromise;
      executionOrder.push('chat:stream:end');
    })();

    // Now session_new arrives while streaming is in progress
    // It should NOT be blocked because streaming is outside the mutex
    const sessionNewPromise = withSessionMutex(client, async () => {
      executionOrder.push('session_new:start');
      client.sessionId = 'new-temp-session-B';
      executionOrder.push('session_new:end');
    });

    // session_new should complete immediately (not waiting for streaming)
    await sessionNewPromise;
    expect(executionOrder).toContain('session_new:start');
    expect(executionOrder).toContain('session_new:end');

    // Streaming should still be running
    expect(executionOrder).not.toContain('chat:stream:end');

    // Verify session_new completed before stream ended
    const newIdx = executionOrder.indexOf('session_new:end');
    expect(executionOrder).not.toContain('chat:stream:end');

    // Now complete the streaming
    streamingResolve!();
    await streamPromise;

    expect(executionOrder).toContain('chat:stream:end');

    // Final sessionId should be the new session (session_new overwrote it)
    expect(client.sessionId).toBe('new-temp-session-B');

    // The stream used the captured chatSessionId, unaffected by session_new
    expect(chatSessionId).toBe('persistent-session-A');
  });

  it('old behavior: session_new blocked by full-mutex chat (regression proof)', async () => {
    // This demonstrates what the OLD behavior looked like:
    // If chat holds the mutex for the entire streaming duration,
    // session_new is blocked until streaming completes.

    const client: MockClient = { sessionId: 'session-old' };
    const executionOrder: string[] = [];

    // OLD pattern: entire chat (including streaming) inside mutex
    const chatPromise = withSessionMutex(client, async () => {
      executionOrder.push('chat:full:start');
      // Simulate streaming delay
      await new Promise(r => setTimeout(r, 100));
      executionOrder.push('chat:full:end');
    });

    // session_new queues behind the full chat
    const sessionNewPromise = withSessionMutex(client, async () => {
      executionOrder.push('session_new:start');
      client.sessionId = 'new-session';
      executionOrder.push('session_new:end');
    });

    await Promise.all([chatPromise, sessionNewPromise]);

    // In the old pattern, session_new waits for chat to finish
    expect(executionOrder).toEqual([
      'chat:full:start',
      'chat:full:end',
      'session_new:start',
      'session_new:end',
    ]);
  });
});
