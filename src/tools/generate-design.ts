/**
 * GenerateImage 工具 - Chat Tab 主 Agent 专用
 *
 * v11.0: 使用 Gemini 生成任何类型的图片
 *
 * 设计理念：
 * - 主 Agent 可以根据任何需求调用此工具生成图片（UI 设计、插图、图表等）
 * - 工具注册到全局 ToolRegistry（提供 schema）
 * - 实际执行由 ConversationManager.executeTool() 拦截处理
 *   （调用 geminiImageService.generateImage()）
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export interface GenerateImageInput {
  prompt: string;
  style?: string;
  size?: 'landscape' | 'portrait' | 'square';
}

/**
 * GenerateImage 工具
 * 主 Agent 专用，调用 Gemini 生成任意类型图片
 */
export class GenerateImageTool extends BaseTool<GenerateImageInput, ToolResult> {
  name = 'GenerateImage';
  description = `Generate any type of image using AI (UI designs, illustrations, diagrams, mockups, etc.)

## When to Use
Call this tool when:
- User requests to generate an image
- Need to visualize concepts, designs, or ideas
- Create UI mockups, wireframes, or design previews
- Generate illustrations, diagrams, or any visual content
- Any scenario where an image would enhance communication

## Parameters
- prompt: Detailed description of the image to generate (required)
- style: Style hint for the image (optional, freeform text like "modern", "minimalist", "hand-drawn", "photorealistic", etc.)
- size: Image aspect ratio (optional: 'landscape', 'portrait', or 'square')

## Notes
- Requires GEMINI_API_KEY environment variable
- Generated image will be displayed in the chat
- Can be called multiple times for different images`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate',
        },
        style: {
          type: 'string',
          description: 'Style hint (optional, freeform text like "modern", "minimalist", "photorealistic", etc.)',
        },
        size: {
          type: 'string',
          enum: ['landscape', 'portrait', 'square'],
          description: 'Image aspect ratio (optional)',
        },
      },
      required: ['prompt'],
    };
  }

  async execute(_input: GenerateImageInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    // 这里仅作为 fallback（CLI 模式或未被拦截时）
    return {
      success: false,
      output: 'GenerateImage tool requires Web chat interface. Please use it in Chat Tab.',
    };
  }
}
