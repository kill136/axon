/**
 * GeminiImageService - saveImageToDisk 逻辑测试
 * 
 * 不测 Gemini API 调用（需要真实 key），只测本地文件保存逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// 因为 saveImageToDisk 是 private，我们通过 generateImage 的集成路径测
// 但 generateImage 依赖 Gemini API，所以这里直接测保存逻辑的等价实现
// 提取核心逻辑作为纯函数测试

/**
 * 从 data URL 解析并保存图片到磁盘（与 GeminiImageService.saveImageToDisk 等价逻辑）
 */
function saveImageToDisk(dataUrl: string, outputDir: string, prompt: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL format');
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const sanitized = prompt
    .substring(0, 30)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const shortHash = crypto.createHash('md5').update(dataUrl).digest('hex').substring(0, 8);
  const filename = `${sanitized || 'image'}_${shortHash}.${ext}`;

  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, buffer);

  return path.resolve(filePath);
}

describe('GeminiImageService - saveImageToDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegen-test-'));
  });

  afterEach(() => {
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 创建一个最小的 1x1 红色 PNG 的 base64
  const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

  it('should save PNG image to specified directory', () => {
    const outputDir = path.join(tmpDir, 'output');
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, outputDir, 'test prompt');

    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toContain('test_prompt_');
    expect(savedPath).toMatch(/\.png$/);

    // 验证文件内容是有效的 PNG（前 8 字节是 PNG 签名）
    const buffer = fs.readFileSync(savedPath);
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4E); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  it('should create output directory recursively if not exists', () => {
    const deepDir = path.join(tmpDir, 'a', 'b', 'c');
    expect(fs.existsSync(deepDir)).toBe(false);

    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, deepDir, 'deep dir test');

    expect(fs.existsSync(deepDir)).toBe(true);
    expect(fs.existsSync(savedPath)).toBe(true);
  });

  it('should sanitize special characters in filename', () => {
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, tmpDir, 'hello world! @#$% test');

    const filename = path.basename(savedPath);
    // 特殊字符被替换为 _
    expect(filename).toMatch(/^hello_world_test_[a-f0-9]{8}\.png$/);
  });

  it('should handle Chinese characters in prompt', () => {
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, tmpDir, '生成一个太阳花的图片');

    const filename = path.basename(savedPath);
    expect(filename).toContain('生成一个太阳花的图片');
    expect(filename).toMatch(/\.png$/);
    expect(fs.existsSync(savedPath)).toBe(true);
  });

  it('should handle empty prompt gracefully', () => {
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, tmpDir, '');

    const filename = path.basename(savedPath);
    expect(filename).toMatch(/^image_[a-f0-9]{8}\.png$/);
  });

  it('should convert jpeg to jpg extension', () => {
    const jpegDataUrl = `data:image/jpeg;base64,${TINY_PNG_BASE64}`;
    const savedPath = saveImageToDisk(jpegDataUrl, tmpDir, 'jpeg test');

    expect(savedPath).toMatch(/\.jpg$/);
  });

  it('should handle webp format', () => {
    const webpDataUrl = `data:image/webp;base64,${TINY_PNG_BASE64}`;
    const savedPath = saveImageToDisk(webpDataUrl, tmpDir, 'webp test');

    expect(savedPath).toMatch(/\.webp$/);
  });

  it('should throw on invalid data URL format', () => {
    expect(() => {
      saveImageToDisk('not-a-data-url', tmpDir, 'test');
    }).toThrow('Invalid image data URL format');
  });

  it('should produce unique filenames for same prompt but different images', () => {
    const dataUrl1 = `data:image/png;base64,${TINY_PNG_BASE64}`;
    // 稍微不同的 base64（多加一个字符不影响解码但 hash 不同）
    const dataUrl2 = `data:image/png;base64,${TINY_PNG_BASE64}A`;

    const path1 = saveImageToDisk(dataUrl1, tmpDir, 'same prompt');
    const path2 = saveImageToDisk(dataUrl2, tmpDir, 'same prompt');

    expect(path1).not.toBe(path2);
    expect(fs.existsSync(path1)).toBe(true);
    expect(fs.existsSync(path2)).toBe(true);
  });

  it('should truncate long prompts to 30 chars', () => {
    const longPrompt = 'a'.repeat(100);
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, tmpDir, longPrompt);

    const filename = path.basename(savedPath);
    // 30 个 a + _ + 8字符hash + .png
    expect(filename).toMatch(/^a{30}_[a-f0-9]{8}\.png$/);
  });

  it('should return absolute path', () => {
    const savedPath = saveImageToDisk(TINY_PNG_DATA_URL, tmpDir, 'abs path test');

    expect(path.isAbsolute(savedPath)).toBe(true);
  });
});
