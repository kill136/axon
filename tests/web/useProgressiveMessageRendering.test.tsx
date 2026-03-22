/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { useProgressiveMessageRendering } from '../../src/web/client/src/hooks/useProgressiveMessageRendering';
import type { ChatMessage } from '../../src/web/client/src/types';

function makeMessages(count: number, prefix: string): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    timestamp: index * 1000,
    content: [{ type: 'text', text: `${prefix} message ${index}` }],
  }));
}

interface HarnessProps {
  messages: ChatMessage[];
  sessionId: string | null;
  onState: (state: ReturnType<typeof useProgressiveMessageRendering>) => void;
}

function Harness({ messages, sessionId, onState }: HarnessProps) {
  const state = useProgressiveMessageRendering(messages, sessionId);

  ClientReact.useEffect(() => {
    onState(state);
  }, [onState, state]);

  return null;
}

async function flushHydrationTimers(iterations: number = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await ClientReact.act(async () => {
      vi.runOnlyPendingTimers();
    });
  }
}

describe('useProgressiveMessageRendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
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
  });

  it('renders the newest slice first for a large initial history and hydrates the rest in background', async () => {
    const onState = vi.fn();
    const largeHistory = makeMessages(200, 'session-a');

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: [],
        sessionId: 'session-a',
        onState,
      }));
    });

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: largeHistory,
        sessionId: 'session-a',
        onState,
      }));
    });

    const latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(152);
    expect(latestState.renderedMessages).toHaveLength(48);
    expect(latestState.renderedMessages[0]?.id).toBe('session-a-152');

    await flushHydrationTimers();

    const hydratedState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(hydratedState.hiddenMessageCount).toBe(0);
    expect(hydratedState.renderedMessages).toHaveLength(200);
    expect(hydratedState.renderedMessages[0]?.id).toBe('session-a-0');
  });

  it('restarts progressive hydration when switching to another large session', async () => {
    const onState = vi.fn();
    const firstHistory = makeMessages(180, 'session-a');
    const secondHistory = makeMessages(190, 'session-b');

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: firstHistory,
        sessionId: 'session-a',
        onState,
      }));
    });
    await flushHydrationTimers();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: secondHistory,
        sessionId: 'session-b',
        onState,
      }));
    });

    const latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(142);
    expect(latestState.renderedMessages).toHaveLength(48);
    expect(latestState.renderedMessages[0]?.id).toBe('session-b-142');
  });

  it('does not re-hide existing history for small same-session updates', async () => {
    const onState = vi.fn();
    const initialHistory = makeMessages(150, 'session-a');
    const appendedHistory = [...initialHistory, ...makeMessages(2, 'session-a-extra')];

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: initialHistory,
        sessionId: 'session-a',
        onState,
      }));
    });
    await flushHydrationTimers();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: appendedHistory,
        sessionId: 'session-a',
        onState,
      }));
    });

    const latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(0);
    expect(latestState.renderedMessages).toHaveLength(152);
    expect(latestState.renderedMessages.at(-1)?.id).toBe('session-a-extra-1');
  });

  it('keeps history revealed after manual expansion during later same-session updates', async () => {
    const onState = vi.fn();
    const initialHistory = makeMessages(150, 'session-a');
    const appendedHistory = [...initialHistory, ...makeMessages(3, 'session-a-extra')];

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: initialHistory,
        sessionId: 'session-a',
        onState,
      }));
    });

    let latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(102);

    await ClientReact.act(async () => {
      latestState.revealAllMessages();
    });

    latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(0);
    expect(latestState.renderedMessages).toHaveLength(150);

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Harness, {
        messages: appendedHistory,
        sessionId: 'session-a',
        onState,
      }));
    });

    latestState = onState.mock.calls.at(-1)?.[0] as ReturnType<typeof useProgressiveMessageRendering>;
    expect(latestState.hiddenMessageCount).toBe(0);
    expect(latestState.renderedMessages).toHaveLength(153);
    expect(latestState.renderedMessages.at(-1)?.id).toBe('session-a-extra-2');
  });
});
