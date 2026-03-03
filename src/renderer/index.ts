/**
 * SVG/图像渲染模块
 * 使用 resvg-wasm 进行高性能 SVG 渲染
 */

import * as fs from 'fs';
import * as path from 'path';

// resvg-wasm 类型定义
interface ResvgRenderOptions {
  fitTo?: {
    mode: 'width' | 'height' | 'zoom' | 'original';
    value?: number;
  };
  background?: string;
  crop?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

interface ResvgRenderedImage {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  asPng(): Uint8Array;
}

interface ResvgInstance {
  render(): ResvgRenderedImage;
  readonly width: number;
  readonly height: number;
  innerBBox(): { x: number; y: number; width: number; height: number } | null;
  getBBox(): { x: number; y: number; width: number; height: number } | null;
  cropByBBox(bbox: { x: number; y: number; width: number; height: number }): void;
  imagesToResolve(): string[];
  resolveImage(href: string, buffer: Uint8Array): void;
}

// 图像输出格式
export type ImageFormat = 'png' | 'raw';

// 渲染选项
export interface RenderOptions {
  width?: number;
  height?: number;
  scale?: number;
  background?: string;
  format?: ImageFormat;
}

// 渲染结果
export interface RenderResult {
  data: Buffer;
  width: number;
  height: number;
  format: ImageFormat;
}

// SVG 信息
export interface SvgInfo {
  width: number;
  height: number;
  viewBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// SVG 渲染器（优先使用原生，回退到 WASM）
export class SvgRenderer {
  private Resvg: any = null;
  private initialized: boolean = false;
  private initPromise: Promise<boolean> | null = null;
  private useNative: boolean = false;

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<boolean> {
    // 首先尝试原生 resvg
    try {
      const nativeResvg = await import('@resvg/resvg-js');
      this.Resvg = (nativeResvg as any).Resvg || (nativeResvg as any).default?.Resvg;
      if (this.Resvg) {
        this.useNative = true;
        this.initialized = true;
        console.log('resvg: using native module');
        return true;
      }
    } catch {
      // 原生模块不可用，尝试 WASM
    }

    try {
      // 动态导入 @resvg/resvg-wasm
      const resvgModule = await import('@resvg/resvg-wasm');

      // 初始化 WASM
      const wasmPath = this.findWasmPath();
      if (wasmPath) {
        const wasmBuffer = fs.readFileSync(wasmPath);
        await resvgModule.initWasm(wasmBuffer);
      } else {
        // 如果找不到 WASM 文件，抛出错误
        throw new Error('resvg WASM file not found');
      }

      this.Resvg = resvgModule.Resvg;
      this.useNative = false;
      this.initialized = true;
      console.log('resvg: using WASM module');
      return true;
    } catch (err) {
      console.warn('resvg initialization failed:', err);
      return false;
    }
  }

  isNative(): boolean {
    return this.useNative;
  }

  private findWasmPath(): string | null {
    const possiblePaths = [
      path.join(__dirname, '../../node_modules/@resvg/resvg-wasm/index_bg.wasm'),
      path.join(process.cwd(), 'node_modules/@resvg/resvg-wasm/index_bg.wasm'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // 渲染 SVG 字符串为图像
  async render(svg: string, options: RenderOptions = {}): Promise<RenderResult> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error('SVG renderer initialization failed');
      }
    }

    const resvgOptions: ResvgRenderOptions = {
      logLevel: 'off',
    };

    // 设置尺寸
    if (options.width) {
      resvgOptions.fitTo = { mode: 'width', value: options.width };
    } else if (options.height) {
      resvgOptions.fitTo = { mode: 'height', value: options.height };
    } else if (options.scale) {
      resvgOptions.fitTo = { mode: 'zoom', value: options.scale };
    } else {
      resvgOptions.fitTo = { mode: 'original' };
    }

    // 设置背景
    if (options.background) {
      resvgOptions.background = options.background;
    }

    const resvg: ResvgInstance = new this.Resvg(svg, resvgOptions);
    const rendered = resvg.render();

    const format = options.format || 'png';
    let data: Buffer;

    if (format === 'png') {
      data = Buffer.from(rendered.asPng());
    } else {
      data = Buffer.from(rendered.pixels);
    }

    return {
      data,
      width: rendered.width,
      height: rendered.height,
      format,
    };
  }

  // 从文件渲染
  async renderFile(filePath: string, options: RenderOptions = {}): Promise<RenderResult> {
    const svg = fs.readFileSync(filePath, 'utf-8');
    return this.render(svg, options);
  }

  // 渲染并保存到文件
  async renderToFile(svg: string, outputPath: string, options: RenderOptions = {}): Promise<void> {
    const result = await this.render(svg, { ...options, format: 'png' });
    fs.writeFileSync(outputPath, result.data);
  }

  // 获取 SVG 信息
  async getSvgInfo(svg: string): Promise<SvgInfo> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        // 使用正则表达式解析 SVG 尺寸（回退方案）
        return this.parseSvgInfoWithRegex(svg);
      }
    }

    try {
      const resvg: ResvgInstance = new this.Resvg(svg, { logLevel: 'off' });
      const bbox = resvg.getBBox();

      return {
        width: resvg.width,
        height: resvg.height,
        viewBox: bbox ? {
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
        } : undefined,
      };
    } catch {
      return this.parseSvgInfoWithRegex(svg);
    }
  }

  private parseSvgInfoWithRegex(svg: string): SvgInfo {
    const widthMatch = svg.match(/width=["'](\d+(?:\.\d+)?)/);
    const heightMatch = svg.match(/height=["'](\d+(?:\.\d+)?)/);
    const viewBoxMatch = svg.match(/viewBox=["']([^"']+)/);

    let width = widthMatch ? parseFloat(widthMatch[1]) : 100;
    let height = heightMatch ? parseFloat(heightMatch[1]) : 100;
    let viewBox: SvgInfo['viewBox'] | undefined;

    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4) {
        viewBox = {
          x: parts[0],
          y: parts[1],
          width: parts[2],
          height: parts[3],
        };
        // 如果没有显式尺寸，使用 viewBox 尺寸
        if (!widthMatch) width = parts[2];
        if (!heightMatch) height = parts[3];
      }
    }

    return { width, height, viewBox };
  }
}

// 图像处理器
export class ImageProcessor {
  private svgRenderer: SvgRenderer;

  constructor() {
    this.svgRenderer = new SvgRenderer();
  }

  async initialize(): Promise<boolean> {
    return this.svgRenderer.initialize();
  }

  // 检测图像类型
  detectImageType(data: Buffer): string | null {
    if (data.length < 8) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      return 'png';
    }

    // JPEG: FF D8 FF
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
      return 'jpeg';
    }

    // GIF: GIF87a or GIF89a
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
      return 'gif';
    }

    // WebP: RIFF....WEBP
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
      return 'webp';
    }

    // BMP: BM
    if (data[0] === 0x42 && data[1] === 0x4D) {
      return 'bmp';
    }

    // SVG (文本格式)
    const text = data.toString('utf-8', 0, Math.min(100, data.length));
    if (text.includes('<svg') || text.includes('<?xml')) {
      return 'svg';
    }

    return null;
  }

  // 从文件检测类型
  detectImageTypeFromFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    const extMap: Record<string, string> = {
      '.png': 'png',
      '.jpg': 'jpeg',
      '.jpeg': 'jpeg',
      '.gif': 'gif',
      '.webp': 'webp',
      '.bmp': 'bmp',
      '.svg': 'svg',
    };

    return extMap[ext] || null;
  }

  // 渲染 SVG 到 PNG
  async svgToPng(svg: string, options: RenderOptions = {}): Promise<Buffer> {
    const result = await this.svgRenderer.render(svg, { ...options, format: 'png' });
    return result.data;
  }

  // 从文件渲染 SVG 到 PNG
  async svgFileToPng(svgPath: string, options: RenderOptions = {}): Promise<Buffer> {
    const result = await this.svgRenderer.renderFile(svgPath, { ...options, format: 'png' });
    return result.data;
  }

  // 获取图像尺寸（仅限 SVG）
  async getImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
    const type = this.detectImageTypeFromFile(filePath);

    if (type === 'svg') {
      const svg = fs.readFileSync(filePath, 'utf-8');
      const info = await this.svgRenderer.getSvgInfo(svg);
      return { width: info.width, height: info.height };
    }

    // 对于其他格式，尝试读取文件头
    const data = fs.readFileSync(filePath);
    return this.getDimensionsFromBuffer(data, type);
  }

  private getDimensionsFromBuffer(data: Buffer, type: string | null): { width: number; height: number } | null {
    if (!type) return null;

    try {
      switch (type) {
        case 'png':
          // PNG: 宽度在 offset 16-19, 高度在 20-23
          if (data.length >= 24) {
            return {
              width: data.readUInt32BE(16),
              height: data.readUInt32BE(20),
            };
          }
          break;

        case 'jpeg':
          // JPEG 需要解析段
          return this.getJpegDimensions(data);

        case 'gif':
          // GIF: 宽度在 offset 6-7, 高度在 8-9 (little-endian)
          if (data.length >= 10) {
            return {
              width: data.readUInt16LE(6),
              height: data.readUInt16LE(8),
            };
          }
          break;

        case 'bmp':
          // BMP: 宽度在 offset 18-21, 高度在 22-25
          if (data.length >= 26) {
            return {
              width: data.readUInt32LE(18),
              height: Math.abs(data.readInt32LE(22)),
            };
          }
          break;
      }
    } catch {
      return null;
    }

    return null;
  }

  private getJpegDimensions(data: Buffer): { width: number; height: number } | null {
    let offset = 2; // 跳过 SOI 标记

    while (offset < data.length - 1) {
      if (data[offset] !== 0xFF) {
        offset++;
        continue;
      }

      const marker = data[offset + 1];

      // SOF0-SOF15 (除了 SOF4 和 SOF12)
      if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xCC) {
        if (offset + 9 <= data.length) {
          return {
            height: data.readUInt16BE(offset + 5),
            width: data.readUInt16BE(offset + 7),
          };
        }
      }

      // 计算段长度并跳过
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
        offset += 2;
      } else if (offset + 4 <= data.length) {
        const segmentLength = data.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      } else {
        break;
      }
    }

    return null;
  }
}

// 创建简单的 SVG 图形
export class SvgBuilder {
  private elements: string[] = [];
  private width: number;
  private height: number;

  constructor(width: number = 100, height: number = 100) {
    this.width = width;
    this.height = height;
  }

  rect(x: number, y: number, w: number, h: number, fill: string = '#000'): this {
    this.elements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
    return this;
  }

  circle(cx: number, cy: number, r: number, fill: string = '#000'): this {
    this.elements.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: string = '#000', strokeWidth: number = 1): this {
    this.elements.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
    return this;
  }

  text(x: number, y: number, content: string, fontSize: number = 12, fill: string = '#000'): this {
    this.elements.push(`<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}">${this.escapeXml(content)}</text>`);
    return this;
  }

  path(d: string, fill: string = 'none', stroke: string = '#000', strokeWidth: number = 1): this {
    this.elements.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
    return this;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  build(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
${this.elements.join('\n')}
</svg>`;
  }
}

// 默认实例
export const svgRenderer = new SvgRenderer();
export const imageProcessor = new ImageProcessor();
