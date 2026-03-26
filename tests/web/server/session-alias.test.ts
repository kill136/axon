import { describe, expect, it, vi } from 'vitest';
import {
  resolveSessionAlias,
  syncClientSessionAlias,
} from '../../../src/web/server/session-alias.js';

describe('session alias helpers', () => {
  it('should resolve a temporary session id to its persistent session id', () => {
    const finder = {
      findSessionIdByTemporarySessionId: vi.fn((sessionId: string) => (
        sessionId === 'temp-session' ? 'persistent-session' : null
      )),
    };

    expect(resolveSessionAlias('temp-session', finder)).toBe('persistent-session');
    expect(resolveSessionAlias('persistent-session', finder)).toBe('persistent-session');
  });

  it('should sync the client session id and rebind websocket when an alias is found', () => {
    const client = {
      sessionId: 'temp-session',
      ws: { id: 'ws-1' },
    };
    const setWebSocket = vi.fn();
    const conversationManager = {
      getSessionManager: () => ({
        findSessionIdByTemporarySessionId: (sessionId: string) => (
          sessionId === 'temp-session' ? 'persistent-session' : null
        ),
      }),
      setWebSocket,
    };

    const resolvedSessionId = syncClientSessionAlias(client, conversationManager);

    expect(resolvedSessionId).toBe('persistent-session');
    expect(client.sessionId).toBe('persistent-session');
    expect(setWebSocket).toHaveBeenCalledWith('persistent-session', client.ws);
  });

  it('should leave the client untouched when no alias exists', () => {
    const client = {
      sessionId: 'already-persistent',
      ws: { id: 'ws-1' },
    };
    const setWebSocket = vi.fn();
    const conversationManager = {
      getSessionManager: () => ({
        findSessionIdByTemporarySessionId: () => null,
      }),
      setWebSocket,
    };

    const resolvedSessionId = syncClientSessionAlias(client, conversationManager);

    expect(resolvedSessionId).toBe('already-persistent');
    expect(client.sessionId).toBe('already-persistent');
    expect(setWebSocket).not.toHaveBeenCalled();
  });
});
