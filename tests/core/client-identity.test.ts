import { describe, expect, it } from 'vitest';
import { formatSystemPrompt } from '../../src/core/client.js';

describe('formatSystemPrompt identity variants', () => {
  it('should inject agent identity when requested without a system prompt', () => {
    const formatted = formatSystemPrompt(
      undefined,
      false,
      undefined,
      true,
      'none',
      'agent',
    );

    expect(formatted).toEqual([
      {
        type: 'text',
        text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('should prepend agent identity for non-oauth system prompts', () => {
    const formatted = formatSystemPrompt(
      'You are an interactive CLI tool.',
      false,
      undefined,
      true,
      'none',
      'agent',
    );

    expect(formatted).toEqual([
      {
        type: 'text',
        text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      },
      {
        type: 'text',
        text: 'You are an interactive CLI tool.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('should preserve legacy behavior when no identity variant is provided', () => {
    const formatted = formatSystemPrompt(
      'You are an interactive CLI tool.',
      false,
      undefined,
      true,
      'none',
    );

    expect(formatted).toEqual([
      {
        type: 'text',
        text: 'You are an interactive CLI tool.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });
});
