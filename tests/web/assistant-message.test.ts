import { describe, expect, it } from 'vitest';

import { createAssistantMessage } from '../../src/web/client/src/utils/assistantMessage';
import { getAssistantDisplayName } from '../../src/web/shared/model-catalog.js';

describe('createAssistantMessage', () => {
  it('preserves Axon Cloud runtime metadata for GPT replies', () => {
    const message = createAssistantMessage({
      id: 'msg-1',
      content: [],
      model: 'gpt-5.4',
      runtimeBackend: 'axon-cloud',
    });

    expect(message.model).toBe('gpt-5.4');
    expect(message.runtimeBackend).toBe('axon-cloud');
    expect(getAssistantDisplayName(message.model, message.runtimeBackend as any)).toBe('Axon');
  });

  it('keeps runtime backend even for client-side assistant cards without a model id', () => {
    const message = createAssistantMessage({
      id: 'msg-2',
      content: [{ type: 'text', text: '执行完成' }],
      runtimeBackend: 'axon-cloud',
    });

    expect(message.model).toBeUndefined();
    expect(message.runtimeBackend).toBe('axon-cloud');
    expect(getAssistantDisplayName(message.model, message.runtimeBackend as any)).toBe('Axon');
  });
});
