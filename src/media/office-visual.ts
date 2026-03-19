/**
 * Office 文档视觉提取模块
 * 从 docx/pptx/xlsx ZIP 包中提取嵌入图片 + 文本，
 * 让多模态模型能"看到"文档中的图片内容。
 *
 * 策略：纯 JS 从 ZIP 提取 media/ 目录下的嵌入图片 + 解析文本
 * 不依赖 LibreOffice 等外部工具
 */

import * as fs from 'fs';
import * as path from 'path';

// 支持的嵌入图片格式
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.emf', '.wmf',
]);

/** 单张提取的图片 */
export interface ExtractedImage {
  /** 图片在 ZIP 中的路径 (e.g. ppt/media/image1.png) */
  zipPath: string;
  /** 原始二进制数据 */
  data: Buffer;
  /** MIME 类型 */
  mimeType: string;
  /** 关联的 slide/page 编号（如果可以确定） */
  slideIndex?: number;
}

/** 单个 slide/page 的信息 */
export interface SlideInfo {
  /** slide 编号（从 1 开始） */
  index: number;
  /** 提取的纯文本 */
  text: string;
  /** 关联的图片列表 */
  images: ExtractedImage[];
}

/** 文档视觉提取结果 */
export interface VisualExtractionResult {
  /** 文档类型 */
  type: 'pptx' | 'docx' | 'xlsx';
  /** 按 slide/page 组织的内容 */
  slides: SlideInfo[];
  /** 未关联到 slide 的图片（兜底） */
  unassociatedImages: ExtractedImage[];
  /** 纯文本摘要（所有 slide 文本拼接） */
  fullText: string;
  /** 总图片数 */
  totalImages: number;
}

/** 每次提取的最大图片数 */
export const MAX_IMAGES_PER_DOCUMENT = 20;

/** 单张图片最大尺寸（字节），超过的跳过 */
const MAX_SINGLE_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 从 Office 文档中提取嵌入图片和文本
 */
export async function extractDocumentVisuals(filePath: string): Promise<VisualExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  switch (ext) {
    case '.pptx':
      return extractPptxVisuals(zip);
    case '.docx':
      return extractDocxVisuals(zip);
    case '.xlsx':
      return extractXlsxVisuals(zip, filePath);
    default:
      throw new Error(`Unsupported document format: ${ext}`);
  }
}

/**
 * 从图片文件扩展名获取 MIME 类型
 */
function getImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.emf': 'image/emf',
    '.wmf': 'image/wmf',
  };
  return map[ext] || 'image/png';
}

/**
 * 判断文件名是否为支持的图片格式
 */
function isSupportedImage(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

/**
 * 从 ZIP 中读取所有 media 目录下的图片
 */
async function extractMediaImages(
  zip: any,
  mediaPrefix: string,
): Promise<Map<string, ExtractedImage>> {
  const images = new Map<string, ExtractedImage>();
  const entries: string[] = [];

  zip.forEach((relativePath: string) => {
    if (relativePath.startsWith(mediaPrefix) && isSupportedImage(relativePath)) {
      entries.push(relativePath);
    }
  });

  // 按文件名排序
  entries.sort();

  for (const entry of entries) {
    const file = zip.file(entry);
    if (!file) continue;

    const data = await file.async('nodebuffer') as Buffer;
    if (data.length > MAX_SINGLE_IMAGE_SIZE) continue; // 跳过过大的图片

    images.set(entry, {
      zipPath: entry,
      data,
      mimeType: getImageMimeType(entry),
    });
  }

  return images;
}

/**
 * 解析 .rels 文件，获取 relationship ID → target 的映射
 */
async function parseRels(zip: any, relsPath: string): Promise<Map<string, string>> {
  const rels = new Map<string, string>();
  const file = zip.file(relsPath);
  if (!file) return rels;

  const xml = await file.async('text') as string;
  const regex = /<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    rels.set(match[1], match[2]);
  }

  return rels;
}

/**
 * 从 XML 文本中提取 <a:t> 标签的内容（PPTX）
 */
function extractPptxText(xml: string): string {
  const texts: string[] = [];
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = unescapeXml(match[1]).trim();
    if (text) texts.push(text);
  }
  return texts.join(' ');
}

/**
 * 从 slide XML 中提取引用的图片 relationship IDs
 */
function extractImageRelIds(xml: string): string[] {
  const relIds: string[] = [];
  // <a:blip r:embed="rId2" /> 或 <a:blip r:link="rId3" />
  const regex = /<a:blip[^>]*r:(?:embed|link)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    relIds.push(match[1]);
  }
  return relIds;
}

/**
 * XML 反转义
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// ============================================================================
// PPTX 提取
// ============================================================================

async function extractPptxVisuals(zip: any): Promise<VisualExtractionResult> {
  // 1. 提取所有 media 图片
  const allImages = await extractMediaImages(zip, 'ppt/media/');

  // 2. 收集 slide 文件
  const slideFiles: string[] = [];
  zip.forEach((relativePath: string) => {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(relativePath)) {
      slideFiles.push(relativePath);
    }
  });
  slideFiles.sort((a: string, b: string) => {
    const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0');
    const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0');
    return numA - numB;
  });

  // 3. 逐 slide 解析：文本 + 图片关联
  const slides: SlideInfo[] = [];
  const usedImages = new Set<string>();
  let imageCount = 0;

  for (const slideFile of slideFiles) {
    const slideNum = parseInt(slideFile.match(/slide(\d+)/i)?.[1] || '0');
    const content = await zip.file(slideFile)?.async('text') as string | undefined;
    if (!content) continue;

    // 提取文本
    const text = extractPptxText(content);

    // 提取图片关联：slide XML 中的 r:embed → rels 文件 → media 路径
    const slideImages: ExtractedImage[] = [];
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const rels = await parseRels(zip, relsPath);
    const imageRelIds = extractImageRelIds(content);

    for (const relId of imageRelIds) {
      if (imageCount >= MAX_IMAGES_PER_DOCUMENT) break;

      const target = rels.get(relId);
      if (!target) continue;

      // target 是相对于 ppt/slides/ 的路径，如 ../media/image1.png
      const resolvedPath = resolveRelativePath('ppt/slides/', target);
      const image = allImages.get(resolvedPath);
      if (image) {
        slideImages.push({ ...image, slideIndex: slideNum });
        usedImages.add(resolvedPath);
        imageCount++;
      }
    }

    slides.push({
      index: slideNum,
      text,
      images: slideImages,
    });
  }

  // 4. 收集未关联到 slide 的图片（兜底）
  const unassociatedImages: ExtractedImage[] = [];
  for (const [zipPath, image] of allImages) {
    if (imageCount >= MAX_IMAGES_PER_DOCUMENT) break;
    if (!usedImages.has(zipPath)) {
      unassociatedImages.push(image);
      imageCount++;
    }
  }

  const fullText = slides.map(s => `[Slide ${s.index}] ${s.text}`).join('\n');

  return {
    type: 'pptx',
    slides,
    unassociatedImages,
    fullText,
    totalImages: imageCount,
  };
}

/**
 * 解析相对路径：将 base + relative 合并为绝对 ZIP 路径
 * e.g. resolveRelativePath('ppt/slides/', '../media/image1.png') → 'ppt/media/image1.png'
 */
function resolveRelativePath(base: string, relative: string): string {
  // 去掉 base 末尾的文件名（如果有的话），保留目录
  const baseParts = base.replace(/\\/g, '/').split('/').filter(Boolean);
  const relParts = relative.replace(/\\/g, '/').split('/').filter(Boolean);

  const result = [...baseParts];
  for (const part of relParts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.') {
      result.push(part);
    }
  }
  return result.join('/');
}

// ============================================================================
// DOCX 提取
// ============================================================================

async function extractDocxVisuals(zip: any): Promise<VisualExtractionResult> {
  // 1. 提取所有 media 图片
  const allImages = await extractMediaImages(zip, 'word/media/');

  // 2. 提取文本 + 图片引用关系
  const docXml = await zip.file('word/document.xml')?.async('text') as string | undefined;
  if (!docXml) {
    return {
      type: 'docx',
      slides: [],
      unassociatedImages: [...allImages.values()].slice(0, MAX_IMAGES_PER_DOCUMENT),
      fullText: '',
      totalImages: Math.min(allImages.size, MAX_IMAGES_PER_DOCUMENT),
    };
  }

  // 提取文本：所有 <w:t> 标签
  const textParts: string[] = [];
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = textRegex.exec(docXml)) !== null) {
    textParts.push(unescapeXml(match[1]));
  }
  const fullText = textParts.join('');

  // 提取图片引用
  const rels = await parseRels(zip, 'word/_rels/document.xml.rels');
  const imageRelIds = extractDocxImageRelIds(docXml);

  const slideImages: ExtractedImage[] = [];
  const usedImages = new Set<string>();
  let imageCount = 0;

  for (const relId of imageRelIds) {
    if (imageCount >= MAX_IMAGES_PER_DOCUMENT) break;
    const target = rels.get(relId);
    if (!target) continue;

    const resolvedPath = resolveRelativePath('word/', target);
    const image = allImages.get(resolvedPath);
    if (image) {
      slideImages.push({ ...image, slideIndex: 1 });
      usedImages.add(resolvedPath);
      imageCount++;
    }
  }

  // 未关联图片
  const unassociatedImages: ExtractedImage[] = [];
  for (const [zipPath, image] of allImages) {
    if (imageCount >= MAX_IMAGES_PER_DOCUMENT) break;
    if (!usedImages.has(zipPath)) {
      unassociatedImages.push(image);
      imageCount++;
    }
  }

  return {
    type: 'docx',
    slides: [{
      index: 1,
      text: fullText,
      images: slideImages,
    }],
    unassociatedImages,
    fullText,
    totalImages: imageCount,
  };
}

/**
 * 从 DOCX document.xml 中提取图片引用的 relationship IDs
 */
function extractDocxImageRelIds(xml: string): string[] {
  const relIds: string[] = [];
  // <a:blip r:embed="rId7" /> — DrawingML inline images
  const blipRegex = /<a:blip[^>]*r:(?:embed|link)="([^"]+)"/g;
  let match;
  while ((match = blipRegex.exec(xml)) !== null) {
    relIds.push(match[1]);
  }
  // <v:imagedata r:id="rId8" /> — VML images (legacy)
  const vmlRegex = /<v:imagedata[^>]*r:id="([^"]+)"/g;
  while ((match = vmlRegex.exec(xml)) !== null) {
    relIds.push(match[1]);
  }
  return relIds;
}

// ============================================================================
// XLSX 提取（简化：只提取嵌入图片，文本走现有逻辑）
// ============================================================================

async function extractXlsxVisuals(zip: any, filePath: string): Promise<VisualExtractionResult> {
  // 提取嵌入图片
  const allImages = await extractMediaImages(zip, 'xl/media/');

  // 文本用现有逻辑（动态导入避免循环依赖）
  let fullText = '';
  try {
    const { documentToText } = await import('./office.js');
    fullText = await documentToText(filePath);
  } catch {
    // 降级：无文本
  }

  const images = [...allImages.values()].slice(0, MAX_IMAGES_PER_DOCUMENT);

  return {
    type: 'xlsx',
    slides: [{
      index: 1,
      text: fullText,
      images: [],
    }],
    unassociatedImages: images,
    fullText,
    totalImages: images.length,
  };
}

// ============================================================================
// 图片压缩（使用 sharp）
// ============================================================================

/** 压缩后的图片 */
export interface CompressedImage {
  /** base64 编码 */
  base64: string;
  /** MIME 类型 */
  mimeType: 'image/jpeg' | 'image/png';
  /** 压缩后大小（字节） */
  size: number;
  /** 原始 ZIP 路径 */
  zipPath: string;
  /** 关联的 slide 编号 */
  slideIndex?: number;
}

/**
 * 批量压缩图片
 * 使用 sharp 缩放到 2000x2000 以内，转 JPEG
 */
export async function compressExtractedImages(
  images: ExtractedImage[],
  maxDimension = 2000,
  quality = 80,
): Promise<CompressedImage[]> {
  let sharp: ((input?: string | Buffer) => any) | null = null;
  try {
    const mod = await import('sharp');
    sharp = mod.default;
  } catch {
    // sharp 不可用，返回原始 base64
    return images.map(img => ({
      base64: img.data.toString('base64'),
      mimeType: 'image/png' as const,
      size: img.data.length,
      zipPath: img.zipPath,
      slideIndex: img.slideIndex,
    }));
  }

  const results: CompressedImage[] = [];

  for (const img of images) {
    try {
      // 跳过 EMF/WMF 等 sharp 不支持的格式
      if (img.mimeType === 'image/emf' || img.mimeType === 'image/wmf') {
        continue;
      }

      const sharpInstance = sharp(img.data);
      const metadata = await sharpInstance.metadata();

      // 只在超过最大尺寸时缩放
      let pipeline = sharp(img.data);
      if (metadata.width && metadata.height) {
        if (metadata.width > maxDimension || metadata.height > maxDimension) {
          pipeline = pipeline.resize(maxDimension, maxDimension, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }
      }

      const outputBuffer = await pipeline
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      results.push({
        base64: outputBuffer.toString('base64'),
        mimeType: 'image/jpeg',
        size: outputBuffer.length,
        zipPath: img.zipPath,
        slideIndex: img.slideIndex,
      });
    } catch {
      // 单张图片处理失败，跳过
      continue;
    }
  }

  return results;
}
