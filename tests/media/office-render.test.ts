/**
 * PPT/PPTX 按页渲染测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import JSZip from 'jszip';

const mockExecFile = vi.fn();
const mockExtractPdfPages = vi.fn();
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

function mockPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

vi.mock('../../src/media/pdf.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/media/pdf.js')>('../../src/media/pdf.js');
  return {
    ...actual,
    extractPdfPages: (...args: any[]) => mockExtractPdfPages(...args),
  };
});

async function createTestPptx(slideCount: number, outPath: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.folder('ppt');
  zip.folder('ppt/slides');

  for (let i = 1; i <= slideCount; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:sld>`);
  }

  fs.writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('renderPresentationToImages', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform('linux');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-render-test-'));
  });

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should use PowerPoint COM on Windows before LibreOffice fallback', async () => {
    mockPlatform('win32');
    const pptxPath = path.join(tmpDir, 'windows-deck.pptx');
    await createTestPptx(7, pptxPath);

    mockExecFile.mockImplementation((cmd: string, args: string[], _opts: any, cb: any) => {
      if (cmd === 'powershell') {
        const encoded = args[args.indexOf('-EncodedCommand') + 1];
        const script = Buffer.from(encoded, 'base64').toString('utf16le');
        const match = script.match(/\$outputDir = '([^']+)'/);
        if (!match) throw new Error('outputDir not found in script');
        const outputDir = match[1].replace(/''/g, "'");
        fs.writeFileSync(path.join(outputDir, 'slide-001.jpg'), Buffer.from('jpg1'));
        fs.writeFileSync(path.join(outputDir, 'slide-002.jpg'), Buffer.from('jpg2'));
        cb?.(null, { stdout: '{"totalCount":7,"exportedCount":2}', stderr: '' });
        return;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const { renderPresentationToImages } = await import('../../src/media/office.js');
    const result = await renderPresentationToImages(pptxPath);

    expect(mockExecFile).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)]),
      expect.objectContaining({ timeout: 120000, windowsHide: true }),
      expect.any(Function),
    );
    expect(result.file.totalCount).toBe(7);
    expect(result.file.count).toBe(2);
    expect(result.file.truncated).toBe(true);
  });

  it('should fall back to LibreOffice when PowerPoint COM fails on Windows', async () => {
    mockPlatform('win32');
    const pptxPath = path.join(tmpDir, 'windows-fallback.pptx');
    await createTestPptx(5, pptxPath);

    mockExecFile.mockImplementation((cmd: string, args: string[], _opts: any, cb: any) => {
      if (cmd === 'powershell') {
        const error: NodeJS.ErrnoException = new Error('COM failed');
        error.code = 'COMFAIL';
        cb?.(error);
        return;
      }
      if (cmd === 'soffice') {
        const outDir = args[args.indexOf('--outdir') + 1];
        fs.writeFileSync(path.join(outDir, 'windows-fallback.pdf'), 'fake pdf');
        cb?.(null, { stdout: '', stderr: '' });
        return;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const renderedDir = path.join(tmpDir, 'windows-fallback-pages');
    fs.mkdirSync(renderedDir);
    mockExtractPdfPages.mockResolvedValue({
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath: path.join(tmpDir, 'windows-fallback.pdf'),
          originalSize: 123,
          count: 5,
          outputDir: renderedDir,
        },
      },
    });

    const { renderPresentationToImages } = await import('../../src/media/office.js');
    const result = await renderPresentationToImages(pptxPath);

    expect(mockExecFile).toHaveBeenCalledWith(
      'soffice',
      expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir', expect.any(String), pptxPath]),
      expect.objectContaining({ timeout: 30000, env: expect.objectContaining({ SAL_USE_VCLPLUGIN: 'svp' }) }),
      expect.any(Function),
    );
    expect(result.file.totalCount).toBe(5);
    expect(result.file.count).toBe(5);
  });

  it('should render pptx via soffice and return extracted slide images', async () => {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    await createTestPptx(7, pptxPath);

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      const outDir = _args[_args.indexOf('--outdir') + 1];
      fs.writeFileSync(path.join(outDir, 'deck.pdf'), 'fake pdf');
      cb?.(null, { stdout: '', stderr: '' });
    });

    const renderedDir = path.join(tmpDir, 'rendered-pages');
    fs.mkdirSync(renderedDir);
    mockExtractPdfPages.mockResolvedValue({
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath: path.join(tmpDir, 'deck.pdf'),
          originalSize: 123,
          count: 7,
          outputDir: renderedDir,
        },
      },
    });

    const { renderPresentationToImages } = await import('../../src/media/office.js');
    const result = await renderPresentationToImages(pptxPath);

    expect(mockExecFile).toHaveBeenCalledWith(
      'soffice',
      expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir', expect.any(String), pptxPath]),
      expect.objectContaining({ timeout: 30000, env: expect.objectContaining({ SAL_USE_VCLPLUGIN: 'svp' }) }),
      expect.any(Function),
    );
    expect(mockExtractPdfPages).toHaveBeenCalled();
    expect(result.file.totalCount).toBe(7);
    expect(result.file.count).toBe(7);
    expect(result.file.truncated).toBe(false);
  });


  it('should also render legacy ppt files via soffice', async () => {
    const pptPath = path.join(tmpDir, 'legacy.ppt');
    fs.writeFileSync(pptPath, 'fake legacy ppt');

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      const outDir = _args[_args.indexOf('--outdir') + 1];
      fs.writeFileSync(path.join(outDir, 'legacy.pdf'), 'fake pdf');
      cb?.(null, { stdout: '', stderr: '' });
    });

    const renderedDir = path.join(tmpDir, 'legacy-pages');
    fs.mkdirSync(renderedDir);
    mockExtractPdfPages.mockResolvedValue({
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath: path.join(tmpDir, 'legacy.pdf'),
          originalSize: 123,
          count: 1,
          outputDir: renderedDir,
        },
      },
    });

    const { renderPresentationToImages } = await import('../../src/media/office.js');
    const result = await renderPresentationToImages(pptPath);

    expect(mockExecFile).toHaveBeenCalledWith(
      'soffice',
      expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir', expect.any(String), pptPath]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(result.file.filePath).toBe(pptPath);
    expect(result.file.count).toBe(1);
  });

  it('should mark truncated when deck has more slides than extracted pages', async () => {
    const pptxPath = path.join(tmpDir, 'large-deck.pptx');
    await createTestPptx(25, pptxPath);

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
      const outDir = _args[_args.indexOf('--outdir') + 1];
      fs.writeFileSync(path.join(outDir, 'large-deck.pdf'), 'fake pdf');
      cb?.(null, { stdout: '', stderr: '' });
    });

    const renderedDir = path.join(tmpDir, 'truncated-pages');
    fs.mkdirSync(renderedDir);
    mockExtractPdfPages.mockResolvedValue({
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath: path.join(tmpDir, 'large-deck.pdf'),
          originalSize: 123,
          count: 20,
          outputDir: renderedDir,
        },
      },
    });

    const { renderPresentationToImages } = await import('../../src/media/office.js');
    const result = await renderPresentationToImages(pptxPath);

    expect(result.file.totalCount).toBe(25);
    expect(result.file.count).toBe(20);
    expect(result.file.truncated).toBe(true);
  });
});
