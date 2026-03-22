/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { useArtifacts } from '../../src/web/client/src/hooks/useArtifacts';
import type { ChatMessage } from '../../src/web/client/src/types';

function Probe({ messages }: { messages: ChatMessage[] }) {
  const { artifacts } = useArtifacts(messages);
  return ClientReact.createElement('pre', null, JSON.stringify(artifacts));
}

describe('useArtifacts', () => {
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

  const renderMessages = async (messages: ChatMessage[]) => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(Probe, { messages }));
    });

    return JSON.parse(container.textContent || '[]');
  };

  it('extracts batch edit operations and result text for Edit tool artifacts', async () => {
    const artifacts = await renderMessages([{
      id: 'message-1',
      role: 'assistant',
      timestamp: 1000,
      content: [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'Edit',
        input: {
          file_path: 'F:\\repo\\src\\example.ts',
          batch_edits: [
            { old_string: 'beforeOne()', new_string: 'afterOne()' },
            { old_string: 'beforeTwo()', new_string: 'afterTwo()' },
          ],
        },
        status: 'completed',
        result: {
          success: true,
          output: 'Applied 2 edits',
        },
      }],
    }]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('F:/repo/src/example.ts');
    expect(artifacts[0].editOperations).toEqual([
      { old_string: 'beforeOne()', new_string: 'afterOne()' },
      { old_string: 'beforeTwo()', new_string: 'afterTwo()' },
    ]);
    expect(artifacts[0].resultText).toBe('Applied 2 edits');
  });

  it('extracts MultiEdit operations from subagent tool calls', async () => {
    const artifacts = await renderMessages([{
      id: 'message-2',
      role: 'assistant',
      timestamp: 2000,
      content: [{
        type: 'tool_use',
        id: 'task-1',
        name: 'Task',
        input: {
          description: 'Update file',
        },
        status: 'completed',
        subagentToolCalls: [{
          id: 'sub-1',
          name: 'MultiEdit',
          input: {
            file_path: './src/example.ts',
            edits: [
              { old_string: 'firstOld', new_string: 'firstNew' },
              { old_string: 'secondOld', new_string: 'secondNew' },
            ],
          },
          status: 'completed',
          result: 'Applied 2 edits',
          startTime: 2010,
        }],
      }],
    }]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].toolName).toBe('MultiEdit');
    expect(artifacts[0].filePath).toBe('src/example.ts');
    expect(artifacts[0].editOperations).toEqual([
      { old_string: 'firstOld', new_string: 'firstNew' },
      { old_string: 'secondOld', new_string: 'secondNew' },
    ]);
    expect(artifacts[0].resultText).toBe('Applied 2 edits');
  });
});
