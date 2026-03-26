/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserQuestionDialog } from '../../src/web/client/src/components/UserQuestionDialog';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'question.defaultHeader') return 'Please answer the question';
      if (key === 'question.missingPrompt') return 'Fallback question text';
      if (key === 'question.placeholder') return 'Enter your answer...';
      if (key === 'question.skip') return 'Skip';
      if (key === 'question.submit') return 'Submit';
      if (key === 'question.timeout') return `Timeout: ${params?.seconds}s`;
      return key;
    },
  }),
}));

describe('UserQuestionDialog', () => {
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

  it('shows a fallback prompt when question text is empty', async () => {
    await ClientReact.act(async () => {
      root.render(
        ClientReact.createElement(UserQuestionDialog, {
          question: {
            requestId: 'req-empty',
            question: '   ',
            timeout: 300000,
          },
          onAnswer: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain('Please answer the question');
    expect(container.textContent).toContain('Fallback question text');
    expect(container.textContent).toContain('Timeout: 300s');
  });
});
