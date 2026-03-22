import { afterEach, describe, expect, it, vi } from 'vitest';

const agentLoopState = vi.hoisted(() => ({
  options: undefined as any,
}));

vi.mock('../../src/core/loop.js', () => ({
  ConversationLoop: class MockConversationLoop {
    constructor(options: any) {
      agentLoopState.options = options;
    }

    getSession() {
      return {
        addMessage() {},
      };
    }

    async *processMessageStream() {
      yield { type: 'tool_end', toolError: 'HTTP 503 from upstream gateway' };
    }
  },
}));

vi.mock('../../src/config/index.js', () => ({
  configManager: {
    getAll: () => ({
      apiKey: 'sk-test',
      apiBaseUrl: 'https://api.zyai.online',
      runtimeBackend: 'openai-compatible-api',
      customModelName: 'gpt-5.4',
      defaultModelByBackend: {
        'openai-compatible-api': 'gpt-5.4',
      },
    }),
  },
}));

vi.mock('../../src/hooks/index.js', () => ({
  runSubagentStartHooks: vi.fn(async () => {}),
  runSubagentStopHooks: vi.fn(async () => {}),
}));

import { TaskTool, clearCompletedAgents } from '../../src/tools/agent.js';

describe('TaskTool stream failure handling', () => {
  afterEach(() => {
    clearCompletedAgents();
  });

  it('treats loop-level stream failures as task failure and preserves codex runtime config', async () => {
    const taskTool = new TaskTool();

    const result = await taskTool.execute({
      description: 'Test stream failure',
      prompt: 'Do the task',
      subagent_type: 'Explore',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 503 from upstream gateway');
    expect(agentLoopState.options?.conversationClientConfig).toMatchObject({
      provider: 'codex',
      apiKey: 'sk-test',
      baseUrl: 'https://api.zyai.online',
      customModelName: 'gpt-5.4',
    });
  });
});
