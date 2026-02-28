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
      throw new Error('未配置 GEMINI_API_KEY 或 GOOGLE_API_KEY 环境变量');
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
      modern: '现代、简洁、扁平化设计风格，使用渐变色和圆角元素',
      minimal: '极简主义风格，大量留白，黑白灰为主，突出内容',
      corporate: '企业级专业风格，稳重的配色，清晰的层次结构',
      creative: '创意风格，大胆的配色，独特的布局，视觉冲击力强',
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
请生成一个专业的软件系统 UI 设计图/界面原型图。

项目名称: ${options.projectName}
项目描述: ${options.projectDescription}

核心功能模块:
${coreFeatures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

${techInfo ? `技术栈: ${techInfo}` : ''}

设计要求:
- ${styleDesc}
- 展示系统的主要界面布局
- 包含导航栏、侧边栏、主内容区等核心组件
- 清晰的信息层次和视觉引导
- 专业的 UI 设计，类似 Figma 设计稿
- 高清晰度，适合展示给客户确认

请生成一张完整的系统界面设计图，展示整体布局和主要功能模块的界面设计。
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
        console.log('[GeminiImageService] 使用缓存的设计图');
        return {
          success: true,
          imageUrl: cachedImage,
        };
      }

      // 构建提示词
      const prompt = this.buildPrompt(options);
      console.log('[GeminiImageService] 开始生成设计图...');
      console.log('[GeminiImageService] 提示词:', prompt.substring(0, 200) + '...');

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
          error: '未能生成图片，请稍后重试',
          generatedText,
        };
      }

      // 保存到缓存
      this.saveToCache(cacheKey, imageData);

      console.log('[GeminiImageService] 设计图生成成功');
      return {
        success: true,
        imageUrl: imageData,
        generatedText,
      };
    } catch (error) {
      console.error('[GeminiImageService] 生成设计图失败:', error);

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 处理特定错误
      if (errorMessage.includes('API key')) {
        return {
          success: false,
          error: '未配置有效的 Gemini API Key，请检查环境变量 GEMINI_API_KEY',
        };
      }

      if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        return {
          success: false,
          error: 'API 配额已用尽或请求频率过高，请稍后重试',
        };
      }

      return {
        success: false,
        error: `生成设计图失败: ${errorMessage}`,
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
        console.log('[GeminiImageService] 使用缓存的图片');
        return {
          success: true,
          imageUrl: cachedImage,
        };
      }

      console.log('[GeminiImageService] 开始生成图片...');
      console.log('[GeminiImageService] 提示词:', fullPrompt.substring(0, 200) + '...');

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
          error: '未能生成图片，请稍后重试',
          generatedText,
        };
      }

      // 保存到缓存
      this.saveToCache(cacheKey, imageData);

      console.log('[GeminiImageService] 图片生成成功');
      return {
        success: true,
        imageUrl: imageData,
        generatedText,
      };
    } catch (error) {
      console.error('[GeminiImageService] 生成图片失败:', error);

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      if (errorMessage.includes('API key')) {
        return {
          success: false,
          error: '未配置有效的 Gemini API Key，请检查环境变量 GEMINI_API_KEY',
        };
      }

      if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        return {
          success: false,
          error: 'API 配额已用尽或请求频率过高，请稍后重试',
        };
      }

      return {
        success: false,
        error: `生成图片失败: ${errorMessage}`,
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
