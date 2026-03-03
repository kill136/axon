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
export interface GenerateImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  generatedText?: string;
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
   */
  private initClient(): void {
    if (this.ai) return;

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not configured');
    }

    this.ai = new GoogleGenAI({ apiKey });
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

  /**
   * 通用图片生成方法
   * 直接使用 prompt 调用 Gemini API
   */
  async generateImage(prompt: string, style?: string): Promise<GenerateImageResult> {
    try {
      this.initClient();

      // 构建完整提示词（如果有 style，追加到 prompt 末尾）
      let fullPrompt = prompt;
      if (style) {
        fullPrompt = `${prompt}\n\nStyle: ${style}`;
      }

      // 检查缓存
      const cacheKey = crypto.createHash('md5').update(fullPrompt).digest('hex');
      const cachedImage = this.getFromCache(cacheKey);
      if (cachedImage) {
        console.log('[GeminiImageService] Using cached image');
        return {
          success: true,
          imageUrl: cachedImage,
        };
      }

      console.log('[GeminiImageService] Starting image generation...');
      console.log('[GeminiImageService] Prompt:', fullPrompt.substring(0, 200) + '...');

      // 调用 Gemini API
      const response = await this.ai!.models.generateContent({
        model: this.MODEL,
        contents: [
          {
            role: 'user',
            parts: [{ text: fullPrompt }],
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

      console.log('[GeminiImageService] Image generated successfully');
      return {
        success: true,
        imageUrl: imageData,
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
