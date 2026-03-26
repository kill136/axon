/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import type { WSMessage } from '../../src/web/client/src/types';
import { useActiveRuntimeState } from '../../src/web/client/src/hooks/useActiveRuntimeState';

describe('useActiveRuntimeState', () => {
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps the current session runtime when auth refresh changes the default backend', async () => {
    let latestState: ReturnType<typeof useActiveRuntimeState> | null = null;
    const handlers: Array<(msg: WSMessage) => void> = [];
    const addMessageHandler = vi.fn((handler: (msg: WSMessage) => void) => {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          runtimeBackend: 'claude-compatible-api',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          runtimeBackend: 'codex-subscription',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    function Harness() {
      const state = useActiveRuntimeState({
        connected: true,
        sessionReady: true,
        socketRuntimeBackend: 'claude-compatible-api',
        model: 'opus',
        addMessageHandler,
      });

      ClientReact.useEffect(() => {
        latestState = state;
      }, [state]);

      return null;
    }

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness));
      await Promise.resolve();
    });

    expect(latestState?.defaultRuntimeBackend).toBe('claude-compatible-api');
    expect(latestState?.runtimeBackend).toBe('claude-compatible-api');
    expect(latestState?.runtimeProvider).toBe('anthropic');

    await ClientReact.act(async () => {
      handlers.forEach((handler) => handler({ type: 'auth_status_changed' } as WSMessage));
      await Promise.resolve();
    });

    expect(latestState?.defaultRuntimeBackend).toBe('codex-subscription');
    expect(latestState?.runtimeBackend).toBe('claude-compatible-api');
    expect(latestState?.runtimeProvider).toBe('anthropic');
  });

  it('falls back to the refreshed default runtime before the session runtime is ready', async () => {
    let latestState: ReturnType<typeof useActiveRuntimeState> | null = null;
    const handlers: Array<(msg: WSMessage) => void> = [];
    const addMessageHandler = vi.fn((handler: (msg: WSMessage) => void) => {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          runtimeBackend: 'claude-compatible-api',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          runtimeBackend: 'codex-subscription',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    function Harness() {
      const state = useActiveRuntimeState({
        connected: true,
        sessionReady: false,
        socketRuntimeBackend: null,
        model: 'gpt-5.4',
        addMessageHandler,
      });

      ClientReact.useEffect(() => {
        latestState = state;
      }, [state]);

      return null;
    }

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness));
      await Promise.resolve();
    });

    expect(latestState?.runtimeBackend).toBe('claude-compatible-api');
    expect(latestState?.runtimeProvider).toBe('anthropic');

    await ClientReact.act(async () => {
      handlers.forEach((handler) => handler({ type: 'auth_status_changed' } as WSMessage));
      await Promise.resolve();
    });

    expect(latestState?.defaultRuntimeBackend).toBe('codex-subscription');
    expect(latestState?.runtimeBackend).toBe('codex-subscription');
    expect(latestState?.runtimeProvider).toBe('codex');
  });
});
