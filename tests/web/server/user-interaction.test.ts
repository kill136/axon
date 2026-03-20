import { describe, expect, it } from 'vitest';

import { UserInteractionHandler } from '../../../src/web/server/user-interaction.js';

class MockWebSocket {
  readyState = 1;
  sentMessages: Array<{ type: string; payload: Record<string, unknown> }> = [];

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }
}

describe('UserInteractionHandler pending question delivery', () => {
  it('does not resend a question that was already delivered to the current websocket', async () => {
    const handler = new UserInteractionHandler();
    const ws = new MockWebSocket();

    handler.setSessionId('session-1');
    handler.setWebSocket(ws as unknown as WebSocket);

    const answerPromise = handler.askQuestion({
      question: 'Which branch should I use?',
      header: 'Branch',
    });

    expect(ws.sentMessages).toHaveLength(1);
    expect(handler.getUndeliveredPayloadsForCurrentWebSocket()).toEqual([]);

    const requestId = ws.sentMessages[0].payload.requestId as string;
    handler.handleAnswer(requestId, 'main');

    await expect(answerPromise).resolves.toBe('main');
  });

  it('replays a pending question exactly once after websocket replacement', async () => {
    const handler = new UserInteractionHandler();
    const ws1 = new MockWebSocket();

    handler.setSessionId('session-1');
    handler.setWebSocket(ws1 as unknown as WebSocket);

    const answerPromise = handler.askQuestion({
      question: 'Continue deployment?',
      header: 'Deploy',
    });

    const requestId = ws1.sentMessages[0].payload.requestId as string;

    const ws2 = new MockWebSocket();
    handler.setWebSocket(ws2 as unknown as WebSocket);

    expect(handler.getUndeliveredPayloadsForCurrentWebSocket()).toEqual([
      expect.objectContaining({
        requestId,
        question: 'Continue deployment?',
        header: 'Deploy',
      }),
    ]);

    handler.markDeliveredToCurrentWebSocket(requestId);
    expect(handler.getUndeliveredPayloadsForCurrentWebSocket()).toEqual([]);

    handler.handleAnswer(requestId, 'yes');
    await expect(answerPromise).resolves.toBe('yes');
  });
});
