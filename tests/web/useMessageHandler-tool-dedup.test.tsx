/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSMessage } from '../../src/web/client/src/types';
import { useMessageHandler } from '../../src/web/client/src/hooks/useMessageHandler';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

describe('useMessageHandler tool_use dedupe', () => {
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

  it('does not append duplicate tool_use_start events with the same id', async () => {
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
        type: 'message_start',
        payload: {
          messageId: 'msg-1',
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    await ClientReact.act(async () => {
      handler?.({
        type: 'tool_use_start',
        payload: {
          messageId: 'msg-1',
          toolUseId: 'edit-1',
          toolName: 'Edit',
          input: { _streaming: true },
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    await ClientReact.act(async () => {
      handler?.({
        type: 'tool_use_start',
        payload: {
          messageId: 'msg-1',
          toolUseId: 'edit-1',
          toolName: 'Edit',
          input: { file_path: 'src/core/loop.ts' },
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    await ClientReact.act(async () => {
      handler?.({
        type: 'tool_result',
        payload: {
          toolUseId: 'edit-1',
          success: true,
          output: 'Modified src/core/loop.ts',
          sessionId: 'session-1',
        },
      } as WSMessage);
    });

    const message = latestState?.messages[0];
    expect(message).toBeTruthy();

    const toolUses = message?.content.filter(
      (item): item is Extract<typeof item, { type: 'tool_use' }> => item.type === 'tool_use',
    ) || [];

    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      id: 'edit-1',
      name: 'Edit',
      input: { file_path: 'src/core/loop.ts' },
      status: 'completed',
      result: {
        success: true,
        output: 'Modified src/core/loop.ts',
      },
    });
  });
});
