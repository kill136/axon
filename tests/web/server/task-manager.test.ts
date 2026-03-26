import { describe, expect, it, vi } from 'vitest';

const taskManagerLoopState = vi.hoisted(() => ({
  options: undefined as any,
}));

vi.mock('../../../src/core/loop.js', () => ({
  ConversationLoop: class MockConversationLoop {
    constructor(options: any) {
      taskManagerLoopState.options = options;
    }

    getSession() {
      return {
        addMessage() {},
      };
    }

    abort() {}

    async *processMessageStream() {
      yield { type: 'tool_end', toolError: 'HTTP 503 from upstream gateway' };
    }
  },
}));

vi.mock('../../../src/hooks/index.js', () => ({
  runSubagentStartHooks: vi.fn(async () => {}),
  runSubagentStopHooks: vi.fn(async () => {}),
}));

vi.mock('../../../src/config/index.js', () => ({
  configManager: {
    getAll: () => ({
      debug: false,
      fallbackModel: undefined,
      thinking: undefined,
    }),
  },
}));

import { TaskManager } from '../../../src/web/server/task-manager.js';

describe('TaskManager', () => {
  it('passes through runtime client config and reports loop stream failures as task failures', async () => {
    const taskManager = new TaskManager();

    const result = await taskManager.executeTaskSync(
      'Test task',
      'Do the task',
      'Explore',
      {
        model: 'gpt-5.4',
        workingDirectory: process.cwd(),
        clientConfig: {
          provider: 'codex',
          model: 'gpt-5.4',
          apiKey: 'sk-test',
          baseUrl: 'https://api.zyai.online',
          customModelName: 'gpt-5.4',
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('HTTP 503 from upstream gateway');
    expect(taskManagerLoopState.options?.conversationClientConfig).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.zyai.online',
      customModelName: 'gpt-5.4',
    });

    taskManager.destroy();
  });
});
