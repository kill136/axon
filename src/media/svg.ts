/**
 * SVG 渲染模块
 * 增强功能 - 官方未实现
 * 使用 @resvg/resvg-js 将 SVG 转换为 PNG
 */

import * as fs from 'fs';
import type { ImageResult } from './image.js';

let _Resvg: any = null;
let _resvgLoadAttempted = false;

async function getResvg(): Promise<any> {
  if (!_resvgLoadAttempted) {
    _resvgLoadAttempted = true;
    try {
      const mod = await import('@resvg/resvg-js');
      _Resvg = mod.Resvg;
    } catch {
      try {
        const wasmMod = await import('@resvg/resvg-wasm');
        _Resvg = wasmMod.Resvg;
      } catch (e) {
        console.warn('[SVG] resvg 不可用，SVG 渲染功能已禁用:', (e as Error).message);
      }
    }
  }
  return _Resvg;
}

/**
 * SVG 渲染选项
 */
export interface SvgRenderOptions {
  width?: number;
  height?: number;
  fitTo?: {
    mode: 'width' | 'height' | 'zoom';
    value: number;
  };
  background?: string;
  dpi?: number;
}

/**
 * 默认渲染选项
 */
const DEFAULT_RENDER_OPTIONS: SvgRenderOptions = {
  dpi: 96,
};

/**
 * 检查是否启用 SVG 渲染
 * 可通过环境变量控制
 */
export function isSvgRenderEnabled(): boolean {
  if (process.env.CLAUDE_SVG_RENDER === 'false') {
    return false;
  }
  return true;
}

/**
 * 将 SVG 渲染为 PNG
 *
 * @param svgPath SVG 文件路径
 * @param options 渲染选项
 * @returns 图片结果（PNG 格式）
 */
export async function renderSvgToPng(
  svgPath: string,
  options: SvgRenderOptions = {}
): Promise<ImageResult> {
  // 读取 SVG 文件
  const svgBuffer = fs.readFileSync(svgPath);
  const svgString = svgBuffer.toString('utf-8');

  // 获取原始文件大小
  const originalSize = svgBuffer.length;

  // 合并渲染选项
  const renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };

  try {
    const Resvg = await getResvg();
    if (!Resvg) {
      throw new Error('SVG 渲染不可用：resvg-js 和 resvg-wasm 均未安装');
    }

    // 配置 resvg 选项
    const resvgOptions: any = {
      dpi: renderOptions.dpi,
    };

    // 设置尺寸约束
    if (renderOptions.fitTo) {
      resvgOptions.fitTo = {
        mode: renderOptions.fitTo.mode,
        value: renderOptions.fitTo.value,
      };
    } else if (renderOptions.width || renderOptions.height) {
      if (renderOptions.width && renderOptions.height) {
        resvgOptions.fitTo = {
          mode: 'width',
          value: renderOptions.width,
        };
      } else if (renderOptions.width) {
        resvgOptions.fitTo = {
          mode: 'width',
          value: renderOptions.width,
        };
      } else if (renderOptions.height) {
        resvgOptions.fitTo = {
          mode: 'height',
          value: renderOptions.height,
        };
      }
    }

    // 使用 resvg 渲染
    const resvg = new Resvg(svgString, resvgOptions);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // 转换为 base64
    const base64 = pngBuffer.toString('base64');

    // 获取尺寸信息
    const { width, height } = pngData;

    return {
      type: 'image',
      file: {
        base64,
        type: 'image/png',
        originalSize,
        dimensions: {
          originalWidth: width,
          originalHeight: height,
          displayWidth: width,
          displayHeight: height,
        },
      },
    };
  } catch (error) {
    throw new Error(`Failed to render SVG: ${error}`);
  }
}

/**
 * 从 SVG 字符串渲染为 PNG
 *
 * @param svgString SVG 内容字符串
 * @param options 渲染选项
 * @returns 图片结果（PNG 格式）
 */
export async function renderSvgStringToPng(
  svgString: string,
  options: SvgRenderOptions = {}
): Promise<ImageResult> {
  const originalSize = Buffer.from(svgString, 'utf-8').length;
  const renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };

  try {
    const Resvg = await getResvg();
    if (!Resvg) {
      throw new Error('SVG 渲染不可用：resvg-js 和 resvg-wasm 均未安装');
    }

    // 配置 resvg 选项
    const resvgOptions: any = {
      dpi: renderOptions.dpi,
    };

    if (renderOptions.fitTo) {
      resvgOptions.fitTo = {
        mode: renderOptions.fitTo.mode,
        value: renderOptions.fitTo.value,
      };
    }

    // 使用 resvg 渲染
    const resvg = new Resvg(svgString, resvgOptions);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // 转换为 base64
    const base64 = pngBuffer.toString('base64');

    // 获取尺寸信息
    const { width, height } = pngData;

    return {
      type: 'image',
      file: {
        base64,
        type: 'image/png',
        originalSize,
        dimensions: {
          originalWidth: width,
          originalHeight: height,
          displayWidth: width,
          displayHeight: height,
        },
      },
    };
  } catch (error) {
    throw new Error(`Failed to render SVG string: ${error}`);
  }
}

/**
 * 验证 SVG 文件
 */
export function validateSvgFile(filePath: string): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File does not exist' };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { valid: false, error: 'SVG file is empty' };
    }

    // 读取文件内容
    const content = fs.readFileSync(filePath, 'utf-8');

    // 检查是否包含 SVG 标记
    if (!content.includes('<svg') && !content.includes('<?xml')) {
      return { valid: false, error: 'File does not appear to be a valid SVG' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error}` };
  }
}

/**
 * 获取 SVG 文件的原始尺寸
 */
export function getSvgDimensions(svgPath: string): { width?: number; height?: number } {
  try {
    const svgString = fs.readFileSync(svgPath, 'utf-8');

    // 使用正则提取 width 和 height 属性
    const widthMatch = svgString.match(/width=["'](\d+(?:\.\d+)?)/);
    const heightMatch = svgString.match(/height=["'](\d+(?:\.\d+)?)/);

    return {
      width: widthMatch ? parseFloat(widthMatch[1]) : undefined,
      height: heightMatch ? parseFloat(heightMatch[1]) : undefined,
    };
  } catch (error) {
    console.error('Failed to get SVG dimensions:', error);
    return {};
  }
}
