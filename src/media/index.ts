/**
 * 媒体处理模块统一导出
 * 提供图片、PDF、SVG 等媒体文件的处理功能
 *
 * 基于 Anthropic 官方 CLI 的实现
 * - 图片处理：CP3, zP3, BQ0 函数
 * - PDF 处理：XzB 函数
 * - SVG 渲染：增强功能（官方未实现）
 */

// MIME 类型检测
export {
  getMimeType,
  getMimeTypeSync,
  getMediaType,
  getMimeTypeFromExtension,
} from './mime.js';

// PDF 处理
export {
  PDF_MAX_SIZE,
  PDF_EXTENSIONS,
  PDF_MAX_PAGES_PER_REQUEST,
  PDF_LARGE_THRESHOLD,
  isPdfSupported,
  isPdfExtension,
  readPdfFile,
  readPdfFileSync,
  validatePdfFile,
  parsePageRange,
  getPdfPageCount,
  extractPdfPages,
  formatBytes,
  type PdfReadResult,
  type PdfPartsResult,
  type PageRange,
} from './pdf.js';

// 图片处理
export {
  SUPPORTED_IMAGE_FORMATS,
  MAX_IMAGE_TOKENS,
  IMAGE_COMPRESSION_CONFIG,
  isSupportedImageFormat,
  readImageFile,
  readImageFileSync,
  estimateImageTokens,
  validateImageFile,
  type ImageDimensions,
  type ImageResult,
} from './image.js';

// Office 文档处理
export {
  OFFICE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  isOfficeFile,
  isDocumentFile,
  documentToHtml,
  documentToText,
  getSearchableText,
  editDocument,
  clearDocumentCache,
  type EditDocumentResult,
} from './office.js';

// Office 文档视觉提取（图片 + 文本）
export {
  extractDocumentVisuals,
  compressExtractedImages,
  MAX_IMAGES_PER_DOCUMENT,
  type VisualExtractionResult,
  type ExtractedImage,
  type CompressedImage,
  type SlideInfo,
} from './office-visual.js';

// SVG 渲染
export {
  isSvgRenderEnabled,
  renderSvgToPng,
  renderSvgStringToPng,
  validateSvgFile,
  getSvgDimensions,
  type SvgRenderOptions,
} from './svg.js';

/**
 * 统一的媒体文件读取接口
 */
import * as path from 'path';
import { readImageFile, isSupportedImageFormat, type ImageResult } from './image.js';
import { readPdfFile, isPdfExtension, isPdfSupported, type PdfReadResult } from './pdf.js';
import { renderSvgToPng, isSvgRenderEnabled } from './svg.js';

/**
 * 媒体文件类型
 */
export type MediaType = 'image' | 'pdf' | 'svg' | 'unknown';

/**
 * 媒体读取结果
 */
export type MediaResult = ImageResult | PdfReadResult;

/**
 * 检测文件的媒体类型
 */
export function detectMediaType(filePath: string): MediaType {
  const ext = path.extname(filePath).toLowerCase().slice(1);

  if (isSupportedImageFormat(ext)) {
    return 'image';
  }

  if (isPdfExtension(ext)) {
    return 'pdf';
  }

  if (ext === 'svg') {
    return 'svg';
  }

  return 'unknown';
}

/**
 * 统一的媒体文件读取函数
 * 根据文件类型自动选择合适的处理方式
 *
 * @param filePath 文件路径
 * @param options 可选配置
 * @returns 媒体处理结果
 */
export async function readMediaFile(
  filePath: string,
  options: {
    maxTokens?: number;
    renderSvg?: boolean;
    svgOptions?: any;
  } = {}
): Promise<MediaResult> {
  const mediaType = detectMediaType(filePath);

  switch (mediaType) {
    case 'image':
      return await readImageFile(filePath, options.maxTokens);

    case 'pdf':
      if (!isPdfSupported()) {
        throw new Error('PDF support is not enabled');
      }
      return await readPdfFile(filePath);

    case 'svg':
      if (options.renderSvg && isSvgRenderEnabled()) {
        return await renderSvgToPng(filePath, options.svgOptions);
      }
      throw new Error('SVG rendering is not enabled or not requested');

    default:
      throw new Error(`Unsupported media type for file: ${filePath}`);
  }
}

/**
 * 检查文件是否为支持的媒体文件
 */
export function isSupportedMediaFile(filePath: string): boolean {
  const mediaType = detectMediaType(filePath);
  return mediaType !== 'unknown';
}

/**
 * 获取媒体处理统计信息
 */
export interface MediaStats {
  totalImages: number;
  totalPdfs: number;
  totalSvgs: number;
  totalSize: number;
  supportedFormats: string[];
}

export function getMediaStats(): MediaStats {
  return {
    totalImages: 0,
    totalPdfs: 0,
    totalSvgs: 0,
    totalSize: 0,
    supportedFormats: [
      'png', 'jpg', 'jpeg', 'gif', 'webp',  // Image formats
      'pdf',  // PDF format
      'svg',  // SVG format
    ],
  };
}

/**
 * 二进制文件黑名单（对应官方的 VP3）
 * 这些文件类型不应该被读取
 */
export const BINARY_FILE_BLACKLIST = new Set([
  // 音频格式
  'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'aiff', 'opus',

  // 视频格式
  'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpeg', 'mpg',

  // 压缩文件
  'zip', 'rar', 'tar', 'gz', 'bz2', '7z', 'xz', 'z', 'tgz', 'iso',

  // 可执行文件
  'exe', 'dll', 'so', 'dylib', 'app', 'msi', 'deb', 'rpm', 'bin',

  // 数据库文件
  'dat', 'db', 'sqlite', 'sqlite3', 'mdb', 'idx',

  // Office 文档（旧格式，不支持解析）
  'doc', 'xls', 'ppt', 'odt', 'ods', 'odp',
  // 注意：docx/xlsx/pptx 已移出黑名单，由 office.ts 模块处理

  // 字体文件
  'ttf', 'otf', 'woff', 'woff2', 'eot',

  // 设计文件
  'psd', 'ai', 'eps', 'sketch', 'fig', 'xd', 'blend', 'obj', '3ds', 'max',

  // 编译文件
  'class', 'jar', 'war', 'pyc', 'pyo', 'rlib', 'swf', 'fla',
]);

/**
 * 检查文件是否在黑名单中
 */
export function isBlacklistedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return BINARY_FILE_BLACKLIST.has(ext);
}
