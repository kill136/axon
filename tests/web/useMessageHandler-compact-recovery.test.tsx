/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSMessage } from '../../src/web/client/src/types';
import { useMessageHandler } from '../../src/web/client/src/hooks/useMessageHandler';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

describe('useMessageHandler compact recovery', () => {
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

  it('clears a stale compacting state when assistant streaming starts without a compact completion event', async () => {
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

    expect(handler).not.toBeNull();

    await ClientReact.act(async () => {
      handler?.({
        type: 'context_compact',
        payload: {
          phase: 'start',
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    expect(latestState?.compactState.phase).toBe('compacting');

    await ClientReact.act(async () => {
      handler?.({
        type: 'message_start',
        payload: {
          messageId: 'msg-1',
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    expect(latestState?.compactState.phase).toBe('idle');
    expect(latestState?.status).toBe('streaming');
  });
});
