/**
 * 图片处理模块
 * 基于官方实现：Hw6 (主压缩入口), J39 (渐进缩放), j39 (PNG优化),
 * D39 (中等JPEG), M39 (最终兜底), XE7 (token→bytes转换)
 */

import * as fs from 'fs';
import * as path from 'path';
import type sharp from 'sharp';
import { getMimeTypeSync } from './mime.js';

// 动态加载 sharp
let _sharp: ((input?: string | Buffer) => any) | null = null;
let _sharpLoadAttempted = false;

async function getSharp() {
  if (!_sharpLoadAttempted) {
    _sharpLoadAttempted = true;
    try {
      const mod = await import('sharp');
      _sharp = mod.default;
    } catch (e) {
      console.warn('[Image] sharp 不可用，图片压缩功能已禁用:', (e as Error).message);
    }
  }
  return _sharp;
}

/**
 * 支持的图片格式
 */
export const SUPPORTED_IMAGE_FORMATS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp'
]);

/**
 * 最大图片 token 数
 */
export const MAX_IMAGE_TOKENS = 25000;

/**
 * 官方默认 maxBytes = 3932160 (Yh)
 */
const DEFAULT_MAX_BYTES = 3932160;

/**
 * 图片压缩配置 — 保留导出以保持 API 兼容
 */
export const IMAGE_COMPRESSION_CONFIG = {
  maxWidth: 400,
  maxHeight: 400,
  quality: 20,
  format: 'jpeg' as const,
};

/**
 * 图片尺寸信息
 */
export interface ImageDimensions {
  originalWidth?: number;
  originalHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
}

/**
 * 图片处理结果
 */
export interface ImageResult {
  type: 'image';
  file: {
    base64: string;
    type: string; // MIME type
    originalSize: number;
    dimensions?: ImageDimensions;
  };
}

/**
 * 内部压缩上下文（对应官方的 _ 对象）
 */
interface CompressContext {
  imageBuffer: Buffer;
  metadata: any;
  format: string;
  maxBytes: number;
  originalSize: number;
}

/**
 * 内部压缩结果（对应官方的 ex1 返回值）
 */
interface CompressedImage {
  base64: string;
  mediaType: string;
  originalSize: number;
}

/**
 * 检查是否为支持的图片格式
 */
export function isSupportedImageFormat(ext: string): boolean {
  const normalized = ext.toLowerCase().replace('.', '');
  return SUPPORTED_IMAGE_FORMATS.has(normalized);
}

/**
 * 创建压缩结果（对应官方 ex1）
 */
function makeCompressedResult(buffer: Buffer, format: string, originalSize: number): CompressedImage {
  const mediaType = format === 'jpg' ? 'jpeg' : format;
  return {
    base64: buffer.toString('base64'),
    mediaType: `image/${mediaType}`,
    originalSize,
  };
}

/**
 * 为指定格式应用最佳压缩参数（对应官方 X39）
 */
function applyFormatCompression(pipeline: any, format: string): any {
  switch (format) {
    case 'png':
      return pipeline.png({ compressionLevel: 9, palette: true });
    case 'jpeg':
    case 'jpg':
      return pipeline.jpeg({ quality: 80 });
    case 'webp':
      return pipeline.webp({ quality: 80 });
    default:
      return pipeline;
  }
}

/**
 * 第一级：渐进缩放，保持原格式（对应官方 J39）
 * 按 [100%, 75%, 50%, 25%] 逐级缩小
 */
async function tryProgressiveResize(ctx: CompressContext): Promise<CompressedImage | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  const scales = [1, 0.75, 0.5, 0.25];

  for (const scale of scales) {
    const w = Math.round((ctx.metadata.width || 2000) * scale);
    const h = Math.round((ctx.metadata.height || 2000) * scale);

    let pipeline = sharp(ctx.imageBuffer).resize(w, h, {
      fit: 'inside',
      withoutEnlargement: true,
    });
    pipeline = applyFormatCompression(pipeline, ctx.format);

    const buf = await pipeline.toBuffer();
    if (buf.length <= ctx.maxBytes) {
      return makeCompressedResult(buf, ctx.format, ctx.originalSize);
    }
  }

  return null;
}

/**
 * 第二级（仅 PNG）：800x800 + palette 64 色（对应官方 j39）
 */
async function tryPngOptimized(ctx: CompressContext): Promise<CompressedImage | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  const buf = await sharp(ctx.imageBuffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toBuffer();

  if (buf.length <= ctx.maxBytes) {
    return makeCompressedResult(buf, 'png', ctx.originalSize);
  }
  return null;
}

/**
 * 第三级：600x600 JPEG（对应官方 D39）
 */
async function tryMediumJpeg(ctx: CompressContext, quality: number): Promise<CompressedImage | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  const buf = await sharp(ctx.imageBuffer)
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  if (buf.length <= ctx.maxBytes) {
    return makeCompressedResult(buf, 'jpeg', ctx.originalSize);
  }
  return null;
}

/**
 * 第四级（兜底）：400x400 JPEG quality 20（对应官方 M39）
 */
async function fallbackCompress(ctx: CompressContext): Promise<CompressedImage> {
  const sharp = await getSharp();
  if (!sharp) return makeCompressedResult(ctx.imageBuffer, ctx.format, ctx.originalSize);

  const buf = await sharp(ctx.imageBuffer)
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 20 })
    .toBuffer();

  return makeCompressedResult(buf, 'jpeg', ctx.originalSize);
}

/**
 * 检测 buffer 的图片格式
 */
function detectMediaType(buffer: Buffer): string {
  const mime = getMimeTypeSync(buffer);
  if (mime) {
    const sub = mime.split('/')[1];
    if (sub) return sub;
  }
  return 'png';
}

/**
 * 主压缩函数（对应官方 Hw6）
 * 多级渐进压缩：渐进缩放 → PNG优化 → 中等JPEG → 兜底JPEG
 */
async function compressBuffer(
  imageBuffer: Buffer,
  maxBytes: number
): Promise<CompressedImage> {
  const sharpFn = await getSharp();
  let metadata: any = {};
  let format: string;
  if (sharpFn) {
    const meta = await sharpFn(imageBuffer).metadata();
    format = meta.format || detectMediaType(imageBuffer);
    metadata = meta;
  } else {
    format = detectMediaType(imageBuffer);
  }
  const originalSize = imageBuffer.length;

  // 已经足够小
  if (originalSize <= maxBytes) {
    return makeCompressedResult(imageBuffer, format, originalSize);
  }

  const ctx: CompressContext = { imageBuffer, metadata, format, maxBytes, originalSize };

  // 1. 渐进缩放，保持原格式
  const r1 = await tryProgressiveResize(ctx);
  if (r1) return r1;

  // 2. PNG 特殊优化
  if (format === 'png') {
    const r2 = await tryPngOptimized(ctx);
    if (r2) return r2;
  }

  // 3. 中等 JPEG（600x600, quality 50）
  const r3 = await tryMediumJpeg(ctx, 50);
  if (r3) return r3;

  // 4. 兜底（400x400, quality 20）
  return await fallbackCompress(ctx);
}

/**
 * 从 token 限制计算 maxBytes（对应官方 XE7）
 * maxBase64Length = maxTokens / 0.125
 * maxBytes = maxBase64Length * 0.75 (base64 编码膨胀率)
 */
function tokensToMaxBytes(maxTokens: number): number {
  const maxBase64Length = Math.floor(maxTokens / 0.125);
  return Math.floor(maxBase64Length * 0.75);
}

/**
 * 创建 ImageResult 对象
 */
function createImageResult(
  buffer: Buffer,
  mediaType: string,
  originalSize: number,
  dimensions?: ImageDimensions
): ImageResult {
  return {
    type: 'image',
    file: {
      base64: buffer.toString('base64'),
      type: mediaType,
      originalSize,
      dimensions,
    },
  };
}

/**
 * 读取图片文件（主入口）
 */
export async function readImageFile(
  filePath: string,
  maxTokens: number = MAX_IMAGE_TOKENS,
  ext?: string
): Promise<ImageResult> {
  const fileExt = ext || path.extname(filePath).toLowerCase().slice(1) || 'png';

  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const format = detectMediaType(buffer) || fileExt;

  // 估算 token
  const base64Len = Math.ceil(buffer.length * 4 / 3); // base64 膨胀
  const estimatedTokens = Math.ceil(base64Len * 0.125);

  if (estimatedTokens <= maxTokens) {
    // 不需要压缩，提取尺寸信息直接返回
    try {
      const sharpFn = await getSharp();
      if (!sharpFn) {
        return createImageResult(buffer, `image/${format}`, stat.size);
      }
      const metadata = await sharpFn(buffer).metadata();
      return createImageResult(buffer, `image/${format}`, stat.size, {
        originalWidth: metadata.width,
        originalHeight: metadata.height,
        displayWidth: metadata.width,
        displayHeight: metadata.height,
      });
    } catch {
      return createImageResult(buffer, `image/${format}`, stat.size);
    }
  }

  // 需要压缩
  const maxBytes = tokensToMaxBytes(maxTokens);
  const compressed = await compressBuffer(buffer, maxBytes);

  return {
    type: 'image',
    file: {
      base64: compressed.base64,
      type: compressed.mediaType,
      originalSize: stat.size,
    },
  };
}

/**
 * 同步读取图片（基础版本，不压缩）
 */
export function readImageFileSync(filePath: string): ImageResult {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1) || 'png';
  const mimeType = getMimeTypeSync(buffer) || `image/${ext}`;

  return createImageResult(buffer, mimeType, stat.size);
}

/**
 * 估算图片的 token 消耗
 */
export function estimateImageTokens(base64: string): number {
  return Math.ceil(base64.length * 0.125);
}

/**
 * 压缩 Base64 图片数据（带 data URI 前缀）
 */
export async function compressBase64Image(
  base64Data: string,
  maxTokens: number = MAX_IMAGE_TOKENS
): Promise<string> {
  let pureBase64 = base64Data;
  let originalMediaType = 'image/png';

  if (base64Data.startsWith('data:')) {
    const matches = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
    if (matches) {
      originalMediaType = matches[1];
      pureBase64 = matches[2];
    }
  }

  const estimatedTokens = Math.ceil(pureBase64.length * 0.125);
  if (estimatedTokens <= maxTokens) {
    return base64Data.startsWith('data:')
      ? base64Data
      : `data:${originalMediaType};base64,${pureBase64}`;
  }

  try {
    const buffer = Buffer.from(pureBase64, 'base64');
    const maxBytes = tokensToMaxBytes(maxTokens);
    const result = await compressBuffer(buffer, maxBytes);
    return `data:${result.mediaType};base64,${result.base64}`;
  } catch (error) {
    console.error('[ImageCompression] 压缩失败，返回原始数据:', error);
    return base64Data.startsWith('data:')
      ? base64Data
      : `data:${originalMediaType};base64,${pureBase64}`;
  }
}

/**
 * 压缩纯 base64 图片数据（不带 data URI 前缀）
 */
export async function compressRawBase64(
  base64Data: string,
  mediaType: string,
  maxTokens: number = MAX_IMAGE_TOKENS
): Promise<{ data: string; mediaType: string }> {
  const estimatedTokens = Math.ceil(base64Data.length * 0.125);

  if (estimatedTokens <= maxTokens) {
    return { data: base64Data, mediaType };
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const maxBytes = tokensToMaxBytes(maxTokens);
    const result = await compressBuffer(buffer, maxBytes);
    return { data: result.base64, mediaType: result.mediaType };
  } catch (error) {
    console.error('[ImageCompression] 附件压缩失败，使用原始数据:', error);
    return { data: base64Data, mediaType };
  }
}

/**
 * 验证图片文件
 */
export function validateImageFile(filePath: string): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File does not exist' };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { valid: false, error: 'Image file is empty' };
    }

    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!isSupportedImageFormat(ext)) {
      return {
        valid: false,
        error: `Unsupported image format: ${ext}. Supported formats: ${Array.from(SUPPORTED_IMAGE_FORMATS).join(', ')}`
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error}` };
  }
}
