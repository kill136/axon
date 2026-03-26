/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { ArtifactsPanel } from '../../src/web/client/src/components/ArtifactsPanel/ArtifactsPanel';
import type { FileArtifact } from '../../src/web/client/src/hooks/useArtifacts';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      switch (key) {
        case 'artifacts.changes':
          return `${params?.count ?? 0} changes`;
        case 'artifacts.close':
          return 'Close';
        case 'artifacts.closePanel':
          return 'Close panel';
        case 'artifacts.empty':
          return 'No artifacts';
        case 'artifacts.executionResult':
          return 'Execution Result';
        case 'artifacts.fileChanges':
          return 'File Changes';
        case 'artifacts.noOutput':
          return '(No output)';
        case 'artifacts.title':
          return 'Artifacts';
        default:
          return key;
      }
    },
  }),
}));

describe('ArtifactsPanel edit detail overlay', () => {
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
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  const baseArtifact: FileArtifact = {
    id: 'artifact-1',
    filePath: '/tmp/example.ts',
    toolName: 'Edit',
    timestamp: 1,
    messageId: 'message-1',
    toolUseId: 'tool-1',
    status: 'completed',
  };

  const renderPanel = async (artifact: FileArtifact) => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ArtifactsPanel, {
        groups: [{
          filePath: artifact.filePath,
          artifacts: [artifact],
          latestTimestamp: artifact.timestamp,
        }],
        artifacts: [artifact],
        selectedId: artifact.id,
        selectedArtifact: artifact,
        onSelectArtifact: vi.fn(),
        onClose: vi.fn(),
      }));
    });
  };

  it('renders batch edit operations in the detail overlay instead of an empty diff', async () => {
    await renderPanel({
      ...baseArtifact,
      editOperations: [
        { old_string: 'const before = 1;', new_string: 'const after = 1;' },
        { old_string: 'return before;', new_string: 'return after;' },
      ],
      resultText: 'Applied 2 edits',
    });

    expect(document.body.textContent).toContain('const before = 1;');
    expect(document.body.textContent).toContain('const after = 1;');
    expect(document.body.textContent).toContain('return before;');
    expect(document.body.textContent).toContain('return after;');
    expect(document.body.textContent).not.toContain('0 changes');
  });

  it('falls back to the tool result when the edit detail has no renderable diff', async () => {
    await renderPanel({
      ...baseArtifact,
      resultText: 'Applied 1 edit\nChanges: +1 -1',
    });

    expect(document.body.textContent).toContain('Applied 1 edit');
    expect(document.body.textContent).toContain('Changes: +1 -1');
    expect(document.body.textContent).not.toContain('0 changes');
  });
});
