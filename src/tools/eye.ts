/**
 * Eye Tool — Claude's vision.
 *
 * A single tool call captures the current frame from the perception daemon
 * and returns it as an image that Claude can see. One step, no ceremony.
 *
 * The perception daemon keeps the camera open in memory.
 * This tool just says "let me see" and gets the latest frame.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { readImageFile } from '../media/index.js';
import { captureFrame, startEye, isEyeRunning, getEyeStatus, stopEye } from '../eye/index.js';

interface EyeInput {
  /** Action: "look" (default), "status", "start", "stop" */
  action?: 'look' | 'status' | 'start' | 'stop';
}

export class EyeTool extends BaseTool<EyeInput, ToolResult> {
  name = 'Eye';
  description = 'See through the camera. Returns a photo of what the camera currently sees. The perception daemon must be running (auto-starts if configured in settings.json). Use action "look" (default) to see, "status" to check daemon, "start"/"stop" to manage.';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform. "look" captures and returns the current frame (default). "status" checks daemon status. "start"/"stop" manage the daemon.',
          enum: ['look', 'status', 'start', 'stop'],
        },
      },
      required: [],
    };
  }

  async execute(input: EyeInput): Promise<ToolResult> {
    const action = input.action || 'look';

    switch (action) {
      case 'look':
        return this.look();
      case 'status':
        return this.status();
      case 'start':
        return this.start();
      case 'stop':
        return this.doStop();
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  private async look(): Promise<ToolResult> {
    // Auto-start daemon if not running
    if (!isEyeRunning()) {
      const startResult = await startEye();
      if (!startResult.success) {
        return this.error(`Cannot see: daemon not running. ${startResult.message}`);
      }
    }

    // Request frame from daemon
    const frame = await captureFrame();
    if (!frame.success || !frame.path) {
      return this.error(`Failed to capture frame: ${frame.error || 'unknown error'}`);
    }

    // Read the image and return it to Claude
    try {
      const imageResult = await readImageFile(frame.path);
      const output = `[Camera frame captured]\nResolution: ${frame.resolution || 'unknown'}\nTimestamp: ${frame.timestamp || 'unknown'}`;

      return {
        success: true,
        output,
        newMessages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: imageResult.file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                  data: imageResult.file.base64,
                },
              },
            ],
          },
        ],
      };
    } catch (e: any) {
      return this.error(`Failed to read captured frame: ${e.message}`);
    }
  }

  private async status(): Promise<ToolResult> {
    const status = await getEyeStatus();
    return this.success(JSON.stringify(status, null, 2));
  }

  private async start(): Promise<ToolResult> {
    const result = await startEye();
    return result.success
      ? this.success(result.message)
      : this.error(result.message);
  }

  private async doStop(): Promise<ToolResult> {
    const result = await stopEye();
    return result.success
      ? this.success(result.message)
      : this.error(result.message);
  }
}
