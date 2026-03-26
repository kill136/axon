import { describe, it, expect, beforeEach } from 'vitest';
import { SystemPromptBuilder } from '../../src/prompt/builder.js';
import type { PromptContext } from '../../src/prompt/types.js';

describe('SystemPromptBuilder memory recall', () => {
  let builder: SystemPromptBuilder;

  beforeEach(() => {
    builder = new SystemPromptBuilder();
    builder.clearCache();
  });

  it('includes memory recall in the built prompt when provided', async () => {
    const context: PromptContext = {
      workingDir: '/test/project',
      notebookSummary: '<notebook type="profile">prefers concise responses</notebook>',
      memoryRecall: '[1] (notebook, 1h ago)\nPrefers concise responses.',
    };

    const result = await builder.build(context, { enableCache: true });

    expect(result.content).toContain('Relevant long-term memory for the current user request');
    expect(result.content).toContain('Prefers concise responses.');
  });

  it('refreshes cached prompts when notebook summary changes', async () => {
    const initialContext: PromptContext = {
      workingDir: '/test/project',
      notebookSummary: '<notebook type="profile">old preference</notebook>',
    };

    const updatedContext: PromptContext = {
      workingDir: '/test/project',
      notebookSummary: '<notebook type="profile">new preference</notebook>',
    };

    const first = await builder.build(initialContext, { enableCache: true });
    const second = await builder.build(updatedContext, { enableCache: true });

    expect(first.content).toContain('old preference');
    expect(second.content).toContain('new preference');
    expect(second.content).not.toContain('old preference');
  });
});
