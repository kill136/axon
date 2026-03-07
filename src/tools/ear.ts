/**
 * Ear Tool — Claude's hearing.
 *
 * Returns what was heard recently through the browser's microphone.
 * The browser continuously transcribes speech via Web Speech API and
 * pushes results to the server. This tool reads from the in-memory buffer.
 *
 * One tool call = "What did I just hear?"
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { getEarBuffer } from '../ear/index.js';

interface EarInput {
  /** How many seconds back to listen (default: 30, max: 60) */
  seconds?: number;
}

export class EarTool extends BaseTool<EarInput, ToolResult> {
  name = 'Ear';
  description = "Recall what was heard recently through the user's microphone. The browser continuously transcribes ambient speech — this tool retrieves the last N seconds of transcription. Use when the user asks you to listen, or when you need to know what was said.";

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'How many seconds back to recall (default: 30, max: 60)',
        },
      },
      required: [],
    };
  }

  async execute(input: EarInput): Promise<ToolResult> {
    const seconds = Math.min(Math.max(input.seconds ?? 30, 1), 60);
    const withinMs = seconds * 1000;

    const buffer = getEarBuffer();
    const formatted = buffer.getRecentFormatted(withinMs);
    const hasSpeech = buffer.hasSpeech(withinMs);

    let output = `[Ear — last ${seconds} seconds]\n`;
    output += formatted;

    if (!hasSpeech) {
      output += '\n\nNote: No speech detected. Make sure the user has enabled microphone access and voice recognition in the Web UI.';
    }

    return this.success(output);
  }
}
