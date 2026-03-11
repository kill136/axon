/**
 * Office 文档处理模块
 * 支持 docx/xlsx/pptx 转换为 HTML 文本，以及 PDF 文本提取
 * 用于 Read 工具直接读取和 Grep 工具搜索
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// Office 文档扩展名
export const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx']);

// 包含 PDF 的所有可提取文本的文档扩展名
export const DOCUMENT_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'pdf']);

// 缓存目录
const CACHE_DIR = path.join(os.homedir(), '.axon', 'office-cache');

/**
 * 检查文件是否为 Office 文档
 */
export function isOfficeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return OFFICE_EXTENSIONS.has(ext);
}

/**
 * 检查文件是否为可提取文本的文档（Office + PDF）
 */
export function isDocumentFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return DOCUMENT_EXTENSIONS.has(ext);
}

/**
 * 将 docx 文件转换为 HTML
 */
export async function docxToHtml(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.default.convertToHtml({ path: filePath });
  return result.value;
}

/**
 * 将 xlsx 文件转换为 HTML 表格
 */
export async function xlsxToHtml(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  
  const htmlParts: string[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    
    htmlParts.push(`<h2>${escapeHtml(sheetName)}</h2>`);
    const html = XLSX.utils.sheet_to_html(sheet, { header: '' });
    htmlParts.push(html);
  }
  
  return htmlParts.join('\n');
}

/**
 * 将 pptx 文件提取文本（解析 XML）
 * pptx 本质是 ZIP 包含 ppt/slides/slide*.xml
 */
export async function pptxToHtml(filePath: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  
  // 收集所有 slide 文件并排序
  const slideFiles: string[] = [];
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(relativePath)) {
      slideFiles.push(relativePath);
    }
  });
  
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0');
    const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0');
    return numA - numB;
  });
  
  const htmlParts: string[] = [];
  
  for (const slideFile of slideFiles) {
    const slideNum = slideFile.match(/slide(\d+)/i)?.[1] || '?';
    const content = await zip.file(slideFile)?.async('text');
    if (!content) continue;
    
    // 提取所有 <a:t> 标签中的文本
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const text = match[1].trim();
      if (text) texts.push(text);
    }
    
    if (texts.length > 0) {
      htmlParts.push(`<h2>Slide ${slideNum}</h2>`);
      htmlParts.push(`<p>${texts.map(escapeHtml).join(' ')}</p>`);
    }
  }
  
  return htmlParts.join('\n') || '<p>(Empty presentation)</p>';
}

/**
 * 从 PDF 提取纯文本
 */
export async function pdfToText(filePath: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

/**
 * 将任意支持的文档转换为 HTML（用于 Read 工具）
 */
export async function documentToHtml(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  switch (ext) {
    case 'docx':
      return docxToHtml(filePath);
    case 'xlsx':
      return xlsxToHtml(filePath);
    case 'pptx':
      return pptxToHtml(filePath);
    default:
      throw new Error(`Unsupported document format: .${ext}`);
  }
}

/**
 * 将任意支持的文档转换为纯文本（用于 Grep 搜索缓存）
 */
export async function documentToText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  switch (ext) {
    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth.default.extractRawText({ path: filePath });
      return result.value;
    }
    case 'xlsx': {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
      const parts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        parts.push(`[Sheet: ${sheetName}]`);
        parts.push(XLSX.utils.sheet_to_csv(sheet));
      }
      return parts.join('\n');
    }
    case 'pptx': {
      // pptx 的 HTML 已经足够简单，去掉标签就是纯文本
      const html = await pptxToHtml(filePath);
      return html.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
    }
    case 'pdf':
      return pdfToText(filePath);
    default:
      throw new Error(`Unsupported document format: .${ext}`);
  }
}

// ========== 缓存系统（用于 Grep 搜索） ==========

/**
 * 获取缓存文件路径
 * 使用文件绝对路径的 hash 作为缓存文件名
 */
function getCachePath(filePath: string): string {
  const absPath = path.resolve(filePath);
  const hash = crypto.createHash('md5').update(absPath).digest('hex');
  const ext = path.extname(filePath).slice(1);
  return path.join(CACHE_DIR, `${hash}.${ext}.txt`);
}

/**
 * 获取缓存的文本内容
 * 如果缓存不存在或已过期（源文件更新），返回 null
 */
export function getCachedText(filePath: string): string | null {
  const cachePath = getCachePath(filePath);
  
  if (!fs.existsSync(cachePath)) return null;
  
  try {
    const sourceStat = fs.statSync(filePath);
    const cacheStat = fs.statSync(cachePath);
    
    // 源文件比缓存新 → 缓存过期
    if (sourceStat.mtimeMs > cacheStat.mtimeMs) return null;
    
    return fs.readFileSync(cachePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入缓存
 */
export function writeCachedText(filePath: string, text: string): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cachePath = getCachePath(filePath);
    fs.writeFileSync(cachePath, text, 'utf-8');
  } catch {
    // 缓存写入失败不影响主逻辑
  }
}

/**
 * 获取文档的可搜索文本（优先走缓存）
 */
export async function getSearchableText(filePath: string): Promise<string> {
  // 检查缓存
  const cached = getCachedText(filePath);
  if (cached !== null) return cached;
  
  // 转换并缓存
  const text = await documentToText(filePath);
  writeCachedText(filePath, text);
  return text;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
