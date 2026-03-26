/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { CliToolCall } from '../../src/web/client/src/components/CliToolCall';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      switch (key) {
        case 'cli.editAdded':
          return `Added ${params?.count ?? 0} line(s)`;
        case 'cli.editModified':
          return 'Modified';
        case 'cli.editRemoved':
          return `Removed ${params?.count ?? 0} line(s)`;
        case 'cli.expandButton':
          return 'Expand';
        case 'cli.collapseButton':
          return 'Collapse';
        case 'cli.linesOfOutput':
          return `${params?.count ?? 0} lines of output`;
        case 'cli.hiddenLines':
          return `${params?.count ?? 0} hidden lines`;
        case 'cli.noOutput':
          return 'No output';
        default:
          return key;
      }
    },
  }),
}));

describe('CliToolCall hidden output defaults', () => {
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
    vi.clearAllMocks();
  });

  const renderToolCall = async (name: string, input: unknown, result: { success: boolean; output: string }) => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(CliToolCall, {
        toolUse: {
          id: `${name}-tool`,
          name,
          input,
          status: 'completed',
          result,
        },
      }));
    });
  };

  const clickButton = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === label,
    );

    expect(button).toBeTruthy();

    await ClientReact.act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it.each([
    [
      'Glob',
      { pattern: '**/*.ts' },
      { success: true, output: 'src/a.ts\nsrc/b.ts' },
      'src/a.ts',
      '2 lines of output',
    ],
    [
      'Read',
      { file_path: '/tmp/example.ts' },
      { success: true, output: '1\tconst a = 1;\n2\tconst b = 2;' },
      '1\tconst a = 1;',
      '2 lines of output',
    ],
    [
      'Grep',
      { pattern: 'const' },
      { success: true, output: 'src/a.ts:1:const a = 1;\nsrc/b.ts:2:const b = 2;' },
      'src/a.ts:1:const a = 1;',
      '2 lines of output',
    ],
  ])('keeps %s output hidden until expanded', async (name, input, result, hiddenText, summaryText) => {
    await renderToolCall(name, input, result);

    expect(container.textContent).toContain(summaryText);
    expect(container.textContent).not.toContain(hiddenText);

    await clickButton('Expand');

    expect(container.textContent).toContain(hiddenText);
    expect(container.textContent).toContain('Collapse');
  });

  it('renders batch Edit operations instead of an empty card body', async () => {
    await renderToolCall('Edit', {
      file_path: '/tmp/example.ts',
      batch_edits: [
        { old_string: 'const before = 1;', new_string: 'const after = 1;' },
        { old_string: 'return before;', new_string: 'return after;' },
      ],
    }, {
      success: true,
      output: 'Applied 2 edits',
    });

    expect(container.textContent).toContain('const before = 1;');
    expect(container.textContent).toContain('const after = 1;');
    expect(container.textContent).toContain('return before;');
    expect(container.textContent).toContain('return after;');
  });

  it('falls back to tool result text when Edit has no renderable diff input', async () => {
    await renderToolCall('Edit', {
      file_path: '/tmp/example.ts',
    }, {
      success: true,
      output: 'Applied 1 edit\n\nChanges: +1 -1',
    });

    expect(container.textContent).toContain('Applied 1 edit');
    expect(container.textContent).toContain('Changes: +1 -1');
  });
});
