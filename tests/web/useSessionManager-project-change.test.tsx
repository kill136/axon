/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { useSessionManager } from '../../src/web/client/src/hooks/useSessionManager';

let projectChangeHandler:
  | ((project: { path?: string } | null, blueprint: unknown, meta: { source: string; createSession: boolean }) => void)
  | null = null;

vi.mock('../../src/web/client/src/contexts/ProjectContext', () => ({
  useProjectChangeListener: (callback: typeof projectChangeHandler) => {
    projectChangeHandler = callback;
  },
}));

function Harness({
  send,
  setMessages,
}: {
  send: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
}) {
  useSessionManager({
    connected: true,
    send,
    addMessageHandler: vi.fn(() => () => {}),
    sessionId: 'session-1',
    model: 'gpt-5.4',
    currentProjectPath: '/workspace/demo',
    setMessages,
  });

  return null;
}

describe('useSessionManager project change handling', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    projectChangeHandler = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    ClientReact.act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('should not auto-create a session when restoring the initial project on load', async () => {
    const send = vi.fn();
    const setMessages = vi.fn();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, { send, setMessages }));
    });

    send.mockClear();
    setMessages.mockClear();

    await ClientReact.act(async () => {
      projectChangeHandler?.(
        { path: '/workspace/demo' },
        null,
        { source: 'init', createSession: false },
      );
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_new' }),
    );
  });

  it('should create a new session for a user-triggered project switch', async () => {
    const send = vi.fn();
    const setMessages = vi.fn();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, { send, setMessages }));
    });

    send.mockClear();
    setMessages.mockClear();

    await ClientReact.act(async () => {
      projectChangeHandler?.(
        { path: '/workspace/other' },
        null,
        { source: 'switch', createSession: true },
      );
    });

    expect(setMessages).toHaveBeenCalledWith([]);
    expect(send).toHaveBeenCalledWith({
      type: 'session_new',
      payload: { model: 'gpt-5.4', projectPath: '/workspace/other' },
    });
    expect(send).toHaveBeenCalledWith({
      type: 'session_list',
      payload: {
        limit: 50,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        projectPath: '/workspace/other',
      },
    });
  });
});
