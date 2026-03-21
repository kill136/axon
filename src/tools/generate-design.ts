/**
 * ImageGen 工具 - 文生图 + 图生图
 *
 * 使用 Gemini 多模态 API：
 * - 文生图：纯 prompt → 生成图片
 * - 图生图：image_path / image_base64 + prompt → 基于已有图片修改
 *
 * 需要 GEMINI_API_KEY 环境变量
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export interface ImageGenInput {
  prompt: string;
  image_path?: string;
  image_base64?: string;
  image_mime_type?: string;
  style?: string;
  size?: 'landscape' | 'portrait' | 'square';
  edit_strength?: 'low' | 'medium' | 'high';
  output_path?: string;
}

export class ImageGenTool extends BaseTool<ImageGenInput, ToolResult> {
  name = 'ImageGen';
  shouldDefer = true;
  searchHint = 'generate image, create picture, edit image, modify photo, UI mockup, illustration, diagram, text to image, image to image';
  description = `Generate or edit images using AI (Gemini).

## Modes
1. **Text-to-image**: Provide only a prompt to generate a new image from scratch
2. **Image-to-image**: Provide image_path or image_base64 + prompt to edit/modify an existing image (e.g. "change background to blue", "add a title", "remove the watermark")

## Parameters
- prompt: What to generate or how to modify the image (required)
- image_path: Path to an existing image file to edit (optional — omit for text-to-image)
- image_base64: Base64 string or data URL of an existing image to edit (optional — omit for text-to-image)
- image_mime_type: MIME type for raw image_base64 input, defaults to image/png (optional)
- style: Style hint like "modern", "minimalist", "photorealistic" (optional)
- size: Aspect ratio: 'landscape', 'portrait', or 'square' (optional, text-to-image only)
- edit_strength: How strongly to modify the original image: 'low', 'medium', or 'high' (optional, image-to-image only; default: 'low')
- output_path: Directory to save the generated image file (optional). When provided, the image is saved as a PNG file in the specified directory and the file path is returned. This makes the image available as a reusable file resource (e.g. for game assets, documents, etc.)

## Notes
- Requires GEMINI_API_KEY environment variable
- Supports common image formats: PNG, JPG, WEBP, GIF
- Generated/edited image is displayed in the chat
- When output_path is provided, the image is also saved to disk and the absolute file path is returned`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What to generate, or how to modify the existing image',
        },
        image_path: {
          type: 'string',
          description: 'Path to an existing image to edit (omit for text-to-image)',
        },
        image_base64: {
          type: 'string',
          description: 'Base64 string or data URL of an existing image to edit (omit for text-to-image)',
        },
        image_mime_type: {
          type: 'string',
          description: 'MIME type for raw image_base64 input, defaults to image/png',
        },
        style: {
          type: 'string',
          description: 'Style hint (optional, e.g. "modern", "minimalist", "photorealistic")',
        },
        size: {
          type: 'string',
          enum: ['landscape', 'portrait', 'square'],
          description: 'Image aspect ratio (optional, text-to-image only)',
        },
        edit_strength: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'How strongly to modify the original image (optional, image-to-image only; default: low)',
        },
        output_path: {
          type: 'string',
          description: 'Directory to save the generated image file. When provided, the image is saved as a PNG file and the absolute path is returned.',
        },
      },
      required: ['prompt'],
    };
  }

  async execute(_input: ImageGenInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    return {
      success: false,
      output: 'ImageGen tool requires Web chat interface. Please use it in Chat Tab.',
    };
  }
}

// 向后兼容：保留旧名导出
export { ImageGenTool as GenerateImageTool };
