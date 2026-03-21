/**
 * Gemini 图片生成服务
 *
 * 使用 Google Gemini 模型生成 UI 设计图
 * 用于在需求汇总阶段为用户提供可视化预览
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { setupGlobalFetchProxy } from '../../../network/global-proxy.js';

// 生成配置类型
interface GenerateDesignOptions {
  projectName: string;
  projectDescription: string;
  requirements: string[];
  constraints?: string[];
  techStack?: Record<string, string | string[] | undefined>;
  style?: 'modern' | 'minimal' | 'corporate' | 'creative';
}

// 生成结果类型
interface GenerateDesignResult {
  success: boolean;
  imageUrl?: string;      // base64 data URL
  imagePath?: string;     // 本地存储路径
  error?: string;
  generatedText?: string; // AI 生成的描述文字
}

// 通用图片生成结果类型
export interface GenerateImageSource {
  imagePath?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface GenerateImageResult {
  success: boolean;
  imageUrl?: string;
  savedPath?: string;   // 保存到磁盘的绝对路径（当传入 outputDir 时）
  error?: string;
  generatedText?: string;
}

export type GenerateImageSize = 'landscape' | 'portrait' | 'square';
export type GenerateImageEditStrength = 'low' | 'medium' | 'high';

export function parseImageBase64Input(imageBase64: string, imageMimeType?: string): { mimeType: string; data: string } {
  const trimmed = imageBase64.trim();
  const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  return {
    mimeType: imageMimeType?.trim() || 'image/png',
    data: trimmed,
  };
}

// 缓存条目
interface CacheEntry {
  imageData: string;
  timestamp: number;
  hash: string;
}

/**
 * Gemini 图片生成服务
 */
export class GeminiImageService {
  private ai: GoogleGenAI | null = null;
  private lastApiKey: string = '';
  private cache: Map<string, CacheEntry> = new Map();
  private cacheDir: string;
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存
  private readonly MODEL = 'gemini-3-pro-image-preview';

  constructor() {
    this.cacheDir = path.join(process.cwd(), '.cache', 'gemini-images');
    this.ensureCacheDir();
  }

  /**
   * 初始化 Gemini 客户端
   * 当 API Key 变化时自动重建客户端
   */
  private initClient(): void {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not configured. Please set it in Settings → API Advanced.');
    }

    // Key 变化时重建客户端
    if (this.ai && apiKey === this.lastApiKey) return;

    // 确保全局 fetch 代理已初始化（幂等）
    setupGlobalFetchProxy();

    this.ai = new GoogleGenAI({ apiKey });
    this.lastApiKey = apiKey;
  }

  /**
   * 确保缓存目录存在
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(options: GenerateDesignOptions): string {
    const content = JSON.stringify({
      name: options.projectName,
      desc: options.projectDescription,
      reqs: options.requirements,
      style: options.style,
    });
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 从缓存获取图片
   */
  private getFromCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.imageData;
    }

    // 检查文件缓存
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (Date.now() - data.timestamp < this.CACHE_TTL) {
          this.cache.set(key, data);
          return data.imageData;
        }
      } catch {
        // 忽略缓存读取错误
      }
    }

    return null;
  }

  /**
   * 保存到缓存
   */
  private saveToCache(key: string, imageData: string): void {
    const entry: CacheEntry = {
      imageData,
      timestamp: Date.now(),
      hash: key,
    };

    this.cache.set(key, entry);

    // 保存到文件
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(entry));
  }

  /**
   * 构建设计图生成提示词
   */
  private buildPrompt(options: GenerateDesignOptions): string {
    const styleDescriptions = {
      modern: 'Modern, clean, flat design style with gradient colors and rounded elements',
      minimal: 'Minimalist style with generous whitespace, primarily black/white/gray, content-focused',
      corporate: 'Enterprise-grade professional style with stable colors and clear hierarchy',
      creative: 'Creative style with bold colors, unique layouts, and strong visual impact',
    };

    const style = options.style || 'modern';
    const styleDesc = styleDescriptions[style];

    // 提取核心功能（最多 5 个）
    const coreFeatures = options.requirements.slice(0, 5);

    // 技术栈信息
    const techInfo = options.techStack
      ? Object.entries(options.techStack)
          .filter(([, v]) => v)
          .map(([k, v]) => {
            if (Array.isArray(v)) {
              return `${k}: ${v.join(', ')}`;
            }
            return `${k}: ${v}`;
          })
          .join(', ')
      : '';

    return `
Generate a professional software system UI design / interface prototype.

Project Name: ${options.projectName}
Project Description: ${options.projectDescription}

Core Feature Modules:
${coreFeatures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

${techInfo ? `Tech Stack: ${techInfo}` : ''}

Design Requirements:
- ${styleDesc}
- Show the main interface layout of the system
- Include navigation bar, sidebar, main content area and other core components
- Clear information hierarchy and visual guidance
- Professional UI design, similar to Figma mockups
- High resolution, suitable for client review

Generate a complete system interface design showing the overall layout and main feature module designs.
`.trim();
  }

  /**
   * 生成 UI 设计图
   */
  async generateDesign(options: GenerateDesignOptions): Promise<GenerateDesignResult> {
    try {
      this.initClient();

      // 检查缓存
      const cacheKey = this.generateCacheKey(options);
      const cachedImage = this.getFromCache(cacheKey);
      if (cachedImage) {
        console.log('[GeminiImageService] Using cached design image');
        return {
          success: true,
          imageUrl: cachedImage,
        };
      }

      // 构建提示词
      const prompt = this.buildPrompt(options);
      console.log('[GeminiImageService] Starting design image generation...');
      console.log('[GeminiImageService] Prompt:', prompt.substring(0, 200) + '...');

      // 调用 Gemini API
      const response = await this.ai!.models.generateContent({
        model: this.MODEL,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      });

      // 解析响应
      let imageData: string | null = null;
      let generatedText: string | undefined;

      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const { mimeType, data } = part.inlineData;
            imageData = `data:${mimeType};base64,${data}`;
          } else if (part.text) {
            generatedText = part.text;
          }
        }
      }

      if (!imageData) {
        return {
          success: false,
          error: 'Failed to generate image, please try again later',
          generatedText,
        };
      }

      // 保存到缓存
      this.saveToCache(cacheKey, imageData);

      console.log('[GeminiImageService] Design image generated successfully');
      return {
        success: true,
        imageUrl: imageData,
        generatedText,
      };
    } catch (error) {
      console.error('[GeminiImageService] Failed to generate design image:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // 处理特定错误
      if (errorMessage.includes('API key')) {
        return {
          success: false,
          error: 'No valid Gemini API Key configured, please check the GEMINI_API_KEY environment variable',
        };
      }

      if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        return {
          success: false,
          error: 'API quota exhausted or request rate too high, please try again later',
        };
      }

      return {
        success: false,
        error: `Failed to generate design image: ${errorMessage}`,
      };
    }
  }

  private buildImageEditPrompt(prompt: string, style?: string, editStrength: GenerateImageEditStrength = 'low'): string {
    const normalizedPrompt = prompt.trim();
    const normalizedStyle = style?.trim();

    const strengthInstructions: Record<GenerateImageEditStrength, string[]> = {
      low: [
        'Favor maximum fidelity to the original image.',
        'Only make minimal localized edits that are strictly necessary.',
      ],
      medium: [
        'Preserve the original image identity, but allow moderate visible edits where the request requires them.',
        'Keep the overall scene recognizable and avoid unnecessary redesign.',
      ],
      high: [
        'Apply the requested edit more aggressively, but still keep the original image recognizable.',
        'You may make broader changes when required, but do not ignore the original composition unless explicitly requested.',
      ],
    };

    const instructions = [
      'You are editing an existing image, not creating a completely new one.',
      'Use the provided image as the primary source of truth.',
      'Preserve the original subject, composition, camera angle, framing, proportions, lighting, color palette, and overall visual style unless the user explicitly asks to change them.',
      ...strengthInstructions[editStrength],
      'Keep all unspecified areas unchanged.',
      'Do not replace the whole scene, redesign the image, or introduce unrelated new elements.',
      'The output must look like an edited version of the same original image.',
    ];

    if (normalizedStyle) {
      instructions.push(`Editing style preference: ${normalizedStyle}. Only apply this style when it does not conflict with preserving the original image.`);
    }

    instructions.push(`Requested edit: ${normalizedPrompt}`);

    return instructions.join('\n');
  }

  private getAspectRatio(size?: GenerateImageSize): string | undefined {
    switch (size) {
      case 'landscape':
        return '16:9';
      case 'portrait':
        return '9:16';
      case 'square':
        return '1:1';
      default:
        return undefined;
    }
  }

  /**
   * 通用图片生成方法
   * 直接使用 prompt 调用 Gemini API
   */
  async generateImage(
    prompt: string,
    style?: string,
    imageSource?: GenerateImageSource,
    outputDir?: string,
    size?: GenerateImageSize,
    editStrength: GenerateImageEditStrength = 'low',
  ): Promise<GenerateImageResult> {
    try {
      const { imagePath, imageBase64, imageMimeType } = imageSource ?? {};

      if (imagePath && imageBase64) {
        return { success: false, error: 'Provide either image_path or image_base64, not both' };
      }

      if (imagePath && !fs.existsSync(imagePath)) {
        return { success: false, error: `Image file not found: ${imagePath}` };
      }

      this.initClient();

      const isImageToImage = Boolean(imagePath || imageBase64);

      // 本地输入校验要早于远端初始化，避免 API key 错误掩盖真正的参数问题。
      const fullPrompt = isImageToImage
        ? this.buildImageEditPrompt(prompt, style, editStrength)
        : (style ? `${prompt}\n\nStyle: ${style}` : prompt);

      // 检查缓存（图生图时把输入图片身份也算进缓存 key）
      const cacheInput = imagePath
        ? `${fullPrompt}::path::${imagePath}::${fs.statSync(imagePath).mtimeMs}`
        : imageBase64
          ? `${fullPrompt}::base64::${crypto.createHash('md5').update(imageBase64).digest('hex')}::${imageMimeType || ''}`
          : fullPrompt;
      const cacheKey = crypto.createHash('md5').update(cacheInput).digest('hex');
      const cachedImage = this.getFromCache(cacheKey);
      if (cachedImage) {
        console.log('[GeminiImageService] Using cached image');
        return {
          success: true,
          imageUrl: cachedImage,
        };
      }

      // 构建 parts：文生图只有 text，图生图先传图片再传 prompt
      const parts: any[] = [];

      if (imagePath) {
        // 图生图：读取图片文件
        const imageBuffer = fs.readFileSync(imagePath);
        const ext = path.extname(imagePath).toLowerCase().slice(1);
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          webp: 'image/webp', gif: 'image/gif',
        };
        const mimeType = mimeMap[ext] || 'image/png';
        parts.push({ inlineData: { mimeType, data: imageBuffer.toString('base64') } });
        console.log(`[GeminiImageService] Image-to-image(path): ${imagePath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
      }

      if (imageBase64) {
        const { mimeType, data } = parseImageBase64Input(imageBase64, imageMimeType);
        parts.push({ inlineData: { mimeType, data } });
        console.log(`[GeminiImageService] Image-to-image(base64): ${mimeType} (${(data.length / 1024).toFixed(1)} KB base64)`);
      }

      parts.push({ text: fullPrompt });

      console.log(`[GeminiImageService] Starting ${imagePath || imageBase64 ? 'image-to-image' : 'text-to-image'} generation...`);
      console.log('[GeminiImageService] Prompt:', fullPrompt.substring(0, 200) + '...');

      // 调用 Gemini API
      const response = await this.ai!.models.generateContent({
        model: this.MODEL,
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(this.getAspectRatio(size) ? { aspectRatio: this.getAspectRatio(size)! } : {}),
        },
      });

      // 解析响应
      let imageData: string | null = null;
      let generatedText: string | undefined;

      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const { mimeType, data } = part.inlineData;
            imageData = `data:${mimeType};base64,${data}`;
          } else if (part.text) {
            generatedText = part.text;
          }
        }
      }

      if (!imageData) {
        return {
          success: false,
          error: 'Failed to generate image, please try again later',
          generatedText,
        };
      }

      // 保存到缓存
      this.saveToCache(cacheKey, imageData);

      // 如果指定了 outputDir，将图片写入磁盘
      let savedPath: string | undefined;
      if (outputDir) {
        savedPath = this.saveImageToDisk(imageData, outputDir, prompt);
      }

      console.log('[GeminiImageService] Image generated successfully');
      return {
        success: true,
        imageUrl: imageData,
        savedPath,
        generatedText,
      };
    } catch (error) {
      console.error('[GeminiImageService] Failed to generate image:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('API key')) {
        return {
          success: false,
          error: 'No valid Gemini API Key configured, please check the GEMINI_API_KEY environment variable',
        };
      }

      if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        return {
          success: false,
          error: 'API quota exhausted or request rate too high, please try again later',
        };
      }

      return {
        success: false,
        error: `Failed to generate image: ${errorMessage}`,
      };
    }
  }

  /**
   * 将 base64 data URL 图片保存到指定目录
   * 文件名由 prompt 摘要 + 短 hash 组成，避免冲突
   */
  private saveImageToDisk(dataUrl: string, outputDir: string, prompt: string): string {
    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 解析 data URL: "data:image/png;base64,xxxxx"
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid image data URL format');
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 生成文件名：prompt 前 30 字符（sanitize）+ 短 hash
    const sanitized = prompt
      .substring(0, 30)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const shortHash = crypto.createHash('md5').update(dataUrl).digest('hex').substring(0, 8);
    const filename = `${sanitized || 'image'}_${shortHash}.${ext}`;

    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[GeminiImageService] Image saved to: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`);

    return path.resolve(filePath);
  }

  /**
   * 清理过期缓存
   */
  cleanupCache(): void {
    const now = Date.now();

    // 清理内存缓存
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }

    // 清理文件缓存
    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (now - data.timestamp > this.CACHE_TTL) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // 删除无效的缓存文件
          fs.unlinkSync(filePath);
        }
      }
    }
  }
}

// 导出单例
export const geminiImageService = new GeminiImageService();
