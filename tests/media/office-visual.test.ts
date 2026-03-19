/**
 * Office 文档视觉提取模块测试
 * 测试从 docx/pptx ZIP 包中提取嵌入图片 + 文本
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import JSZip from 'jszip';
import {
  extractDocumentVisuals,
  compressExtractedImages,
  MAX_IMAGES_PER_DOCUMENT,
  type ExtractedImage,
} from '../../src/media/office-visual.js';

// 测试用临时目录
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-visual-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 缓存 sharp 生成的合法 PNG
let _pngBuffer: Buffer | null = null;

/**
 * 创建一个有效的 PNG 图片 buffer（使用 sharp 生成）
 */
async function createMinimalPng(): Promise<Buffer> {
  if (_pngBuffer) return _pngBuffer;
  const sharp = (await import('sharp')).default;
  _pngBuffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();
  return _pngBuffer;
}

/**
 * 创建一个测试用 PPTX 文件（带嵌入图片）
 */
async function createTestPptx(options: {
  slides: Array<{ text: string; imageCount: number }>;
}): Promise<string> {
  const zip = new JSZip();
  const pngData = await createMinimalPng();

  // [Content_Types].xml
  let contentTypes = '<?xml version="1.0" encoding="UTF-8"?>';
  contentTypes += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
  contentTypes += '<Default Extension="xml" ContentType="application/xml"/>';
  contentTypes += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
  contentTypes += '<Default Extension="png" ContentType="image/png"/>';
  for (let i = 0; i < options.slides.length; i++) {
    contentTypes += `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  contentTypes += '</Types>';
  zip.file('[Content_Types].xml', contentTypes);

  // _rels/.rels
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');

  let imageIndex = 1;
  for (let slideIdx = 0; slideIdx < options.slides.length; slideIdx++) {
    const slide = options.slides[slideIdx];
    const slideNum = slideIdx + 1;

    // slide XML with <a:t> text and <a:blip> image references
    let slideXml = '<?xml version="1.0" encoding="UTF-8"?>';
    slideXml += '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">';
    slideXml += '<p:cSld><p:spTree>';

    // 文本
    slideXml += '<p:sp><p:txBody>';
    slideXml += `<a:p><a:r><a:t>${escapeXml(slide.text)}</a:t></a:r></a:p>`;
    slideXml += '</p:txBody></p:sp>';

    // 图片引用
    for (let imgIdx = 0; imgIdx < slide.imageCount; imgIdx++) {
      const rId = `rId${imgIdx + 1}`;
      slideXml += `<p:pic><p:blipFill><a:blip r:embed="${rId}"/></p:blipFill></p:pic>`;
    }

    slideXml += '</p:spTree></p:cSld></p:sld>';
    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml);

    // slide rels — 关联图片
    let relsXml = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (let imgIdx = 0; imgIdx < slide.imageCount; imgIdx++) {
      const rId = `rId${imgIdx + 1}`;
      const imgName = `image${imageIndex}.png`;
      relsXml += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${imgName}"/>`;

      // 添加图片到 ppt/media/
      zip.file(`ppt/media/${imgName}`, pngData);
      imageIndex++;
    }
    relsXml += '</Relationships>';
    zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`, relsXml);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(tmpDir, `test-${Date.now()}.pptx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * 创建一个测试用 DOCX 文件（带嵌入图片）
 */
async function createTestDocx(options: {
  text: string;
  imageCount: number;
}): Promise<string> {
  const zip = new JSZip();
  const pngData = await createMinimalPng();

  // [Content_Types].xml
  let contentTypes = '<?xml version="1.0" encoding="UTF-8"?>';
  contentTypes += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
  contentTypes += '<Default Extension="xml" ContentType="application/xml"/>';
  contentTypes += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
  contentTypes += '<Default Extension="png" ContentType="image/png"/>';
  contentTypes += '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>';
  contentTypes += '</Types>';
  zip.file('[Content_Types].xml', contentTypes);

  // _rels/.rels
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');

  // document.xml
  let docXml = '<?xml version="1.0" encoding="UTF-8"?>';
  docXml += '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';
  docXml += '<w:body>';
  docXml += `<w:p><w:r><w:t>${escapeXml(options.text)}</w:t></w:r></w:p>`;

  // 图片引用
  for (let i = 0; i < options.imageCount; i++) {
    const rId = `rId${i + 10}`; // offset to avoid conflicts
    docXml += `<w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="${rId}"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>`;
  }

  docXml += '</w:body></w:document>';
  zip.file('word/document.xml', docXml);

  // document.xml.rels
  let relsXml = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 0; i < options.imageCount; i++) {
    const rId = `rId${i + 10}`;
    const imgName = `image${i + 1}.png`;
    relsXml += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imgName}"/>`;
    zip.file(`word/media/${imgName}`, pngData);
  }
  relsXml += '</Relationships>';
  zip.file('word/_rels/document.xml.rels', relsXml);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(tmpDir, `test-${Date.now()}.docx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Tests
// ============================================================================

describe('extractDocumentVisuals', () => {
  describe('PPTX', () => {
    it('should extract text from slides', async () => {
      const filePath = await createTestPptx({
        slides: [
          { text: 'Hello World', imageCount: 0 },
          { text: 'Second Slide', imageCount: 0 },
        ],
      });

      const result = await extractDocumentVisuals(filePath);

      expect(result.type).toBe('pptx');
      expect(result.slides).toHaveLength(2);
      expect(result.slides[0].text).toContain('Hello World');
      expect(result.slides[1].text).toContain('Second Slide');
      expect(result.totalImages).toBe(0);
    });

    it('should extract embedded images and associate with slides', async () => {
      const filePath = await createTestPptx({
        slides: [
          { text: 'Slide with image', imageCount: 2 },
          { text: 'Another slide', imageCount: 1 },
        ],
      });

      const result = await extractDocumentVisuals(filePath);

      expect(result.type).toBe('pptx');
      expect(result.slides).toHaveLength(2);

      // Slide 1 should have 2 images
      expect(result.slides[0].images).toHaveLength(2);
      expect(result.slides[0].images[0].slideIndex).toBe(1);
      expect(result.slides[0].images[0].mimeType).toBe('image/png');

      // Slide 2 should have 1 image
      expect(result.slides[1].images).toHaveLength(1);
      expect(result.slides[1].images[0].slideIndex).toBe(2);

      expect(result.totalImages).toBe(3);
    });

    it('should respect MAX_IMAGES_PER_DOCUMENT limit', async () => {
      // Create a PPTX with more images than the limit
      const slides = [];
      for (let i = 0; i < 25; i++) {
        slides.push({ text: `Slide ${i + 1}`, imageCount: 1 });
      }
      const filePath = await createTestPptx({ slides });

      const result = await extractDocumentVisuals(filePath);

      expect(result.totalImages).toBeLessThanOrEqual(MAX_IMAGES_PER_DOCUMENT);
    });

    it('should include fullText summary', async () => {
      const filePath = await createTestPptx({
        slides: [
          { text: 'First', imageCount: 0 },
          { text: 'Second', imageCount: 0 },
        ],
      });

      const result = await extractDocumentVisuals(filePath);

      expect(result.fullText).toContain('[Slide 1]');
      expect(result.fullText).toContain('First');
      expect(result.fullText).toContain('[Slide 2]');
      expect(result.fullText).toContain('Second');
    });
  });

  describe('DOCX', () => {
    it('should extract text from document', async () => {
      const filePath = await createTestDocx({
        text: 'Hello Document',
        imageCount: 0,
      });

      const result = await extractDocumentVisuals(filePath);

      expect(result.type).toBe('docx');
      expect(result.fullText).toContain('Hello Document');
      expect(result.totalImages).toBe(0);
    });

    it('should extract embedded images', async () => {
      const filePath = await createTestDocx({
        text: 'Document with images',
        imageCount: 3,
      });

      const result = await extractDocumentVisuals(filePath);

      expect(result.type).toBe('docx');
      expect(result.totalImages).toBe(3);

      // Check images are present
      const allImages = [
        ...result.slides.flatMap(s => s.images),
        ...result.unassociatedImages,
      ];
      expect(allImages.length).toBe(3);
      expect(allImages[0].mimeType).toBe('image/png');
      expect(allImages[0].data.length).toBeGreaterThan(0);
    });
  });

  it('should throw for unsupported format', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');

    await expect(extractDocumentVisuals(filePath)).rejects.toThrow();
  });
});

describe('compressExtractedImages', () => {
  it('should compress PNG images to JPEG', async () => {
    const pngData = await createMinimalPng();
    const images: ExtractedImage[] = [{
      zipPath: 'ppt/media/image1.png',
      data: pngData,
      mimeType: 'image/png',
      slideIndex: 1,
    }];

    const compressed = await compressExtractedImages(images);

    expect(compressed).toHaveLength(1);
    expect(compressed[0].mimeType).toBe('image/jpeg');
    expect(compressed[0].base64.length).toBeGreaterThan(0);
    expect(compressed[0].zipPath).toBe('ppt/media/image1.png');
    expect(compressed[0].slideIndex).toBe(1);
  });

  it('should skip EMF/WMF formats', async () => {
    const images: ExtractedImage[] = [{
      zipPath: 'ppt/media/image1.emf',
      data: Buffer.from('fake emf data'),
      mimeType: 'image/emf',
    }];

    const compressed = await compressExtractedImages(images);

    expect(compressed).toHaveLength(0);
  });

  it('should handle empty array', async () => {
    const compressed = await compressExtractedImages([]);
    expect(compressed).toHaveLength(0);
  });
});
