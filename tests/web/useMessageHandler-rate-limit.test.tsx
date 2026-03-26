/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSMessage } from '../../src/web/client/src/types';
import { useMessageHandler } from '../../src/web/client/src/hooks/useMessageHandler';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

describe('useMessageHandler rate limit updates', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    ClientReact.act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('stores rate limit and cache hit info from rate_limit_update messages', async () => {
    let handler: ((msg: WSMessage) => void) | null = null;
    let latestState: ReturnType<typeof useMessageHandler> | null = null;

    const addMessageHandler = vi.fn((callback: (msg: WSMessage) => void) => {
      handler = callback;
      return () => {
        if (handler === callback) {
          handler = null;
        }
      };
    });

    function Harness() {
      const state = useMessageHandler({
        addMessageHandler,
        model: 'gpt-5.4',
        runtimeBackend: 'codex-subscription',
        send: vi.fn(),
        refreshSessions: vi.fn(),
        sessionId: 'session-1',
      });

      ClientReact.useEffect(() => {
        latestState = state;
      }, [state]);

      return null;
    }

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness));
    });

    await ClientReact.act(async () => {
      handler?.({
        type: 'rate_limit_update',
        payload: {
          status: 'available',
          remainingRequests: 42,
          limitRequests: 50,
          remainingTokens: 9000,
          limitTokens: 10000,
          cacheReadTokens: 128,
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    expect(latestState?.rateLimitInfo).toMatchObject({
      status: 'available',
      remainingRequests: 42,
      limitRequests: 50,
      remainingTokens: 9000,
      limitTokens: 10000,
      cacheReadTokens: 128,
    });
  });

  it('clears previous rate limit info when switching sessions', async () => {
    let handler: ((msg: WSMessage) => void) | null = null;
    let latestState: ReturnType<typeof useMessageHandler> | null = null;

    const addMessageHandler = vi.fn((callback: (msg: WSMessage) => void) => {
      handler = callback;
      return () => {
        if (handler === callback) {
          handler = null;
        }
      };
    });

    function Harness() {
      const state = useMessageHandler({
        addMessageHandler,
        model: 'gpt-5.4',
        runtimeBackend: 'codex-subscription',
        send: vi.fn(),
        refreshSessions: vi.fn(),
        sessionId: 'session-1',
      });

      ClientReact.useEffect(() => {
        latestState = state;
      }, [state]);

      return null;
    }

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness));
    });

    await ClientReact.act(async () => {
      handler?.({
        type: 'rate_limit_update',
        payload: {
          status: 'available',
          remainingRequests: 42,
          cacheReadTokens: 64,
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    expect(latestState?.rateLimitInfo).not.toBeNull();

    await ClientReact.act(async () => {
      handler?.({
        type: 'session_switched',
        payload: {
          sessionId: 'session-2',
          history: [],
        },
      } as WSMessage);
    });

    expect(latestState?.rateLimitInfo).toBeNull();
  });
});
