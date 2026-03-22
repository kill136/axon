/**
 * Office 文档处理模块
 * 支持 docx/xlsx/pptx 转换为 HTML 文本，以及 PDF 文本提取
 * 用于 Read 工具直接读取和 Grep 工具搜索
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { extractPdfPages, type PageRange } from './pdf.js';

// Office 文档扩展名
export const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'ppt', 'pptx']);

// 包含 PDF 的所有可提取文本的文档扩展名
export const DOCUMENT_EXTENSIONS = new Set(['docx', 'xlsx', 'ppt', 'pptx', 'pdf']);

// 缓存目录
const CACHE_DIR = path.join(os.homedir(), '.axon', 'office-cache');
const execFileAsync = promisify(execFile);

export const MAX_RENDERED_PRESENTATION_PAGES = 20;

export interface PresentationRenderResult {
  file: {
    filePath: string;
    originalSize: number;
    count: number;
    totalCount: number | null;
    outputDir: string;
    truncated: boolean;
  };
}

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
 * 将 PPT/PPTX 渲染为逐页 JPEG 图片。
 * 优先保留整页视觉语义，而不是只提取嵌入 media。
 */
export async function renderPresentationToImages(
  filePath: string,
  pageRange?: PageRange,
): Promise<PresentationRenderResult> {
  const stat = fs.statSync(filePath);
  const knownSlideCount = await getPresentationSlideCount(filePath);
  let powerPointError: Error | null = null;

  if (process.platform === 'win32') {
    try {
      return await renderPresentationWithPowerPoint(filePath, stat.size, pageRange);
    } catch (error) {
      powerPointError = toError(error);
    }
  }

  try {
    return await renderPresentationWithLibreOffice(filePath, stat.size, knownSlideCount, pageRange);
  } catch (error) {
    const sofficeError = toError(error);
    if (powerPointError) {
      throw new Error(
        `PowerPoint COM render failed: ${powerPointError.message}; LibreOffice render failed: ${sofficeError.message}`,
      );
    }
    throw sofficeError;
  }
}

async function renderPresentationWithPowerPoint(
  filePath: string,
  originalSize: number,
  pageRange?: PageRange,
): Promise<PresentationRenderResult> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-ppt-com-'));
  const requestedFirstPage = pageRange?.firstPage ?? 1;
  const requestedLastPage = pageRange
    ? (pageRange.lastPage === Infinity ? -1 : pageRange.lastPage)
    : MAX_RENDERED_PRESENTATION_PAGES;

  const encodedCommand = encodePowerShellCommand(
    buildPowerPointExportScript(
      path.resolve(filePath),
      outputDir,
      requestedFirstPage,
      requestedLastPage,
    ),
  );

  let rawResult: unknown;
  try {
    rawResult = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodedCommand,
    ], {
      timeout: 120000,
      windowsHide: true,
    });
  } catch (error) {
    const err = toError(error);
    if ((error as any)?.code === 'ENOENT') {
      throw new Error('PowerShell is not available for PowerPoint COM rendering.');
    }
    throw new Error(`PowerPoint COM export failed: ${err.message}`);
  }

  const summary = parsePowerPointExportSummary(getExecStdout(rawResult));
  const jpgFiles = fs.readdirSync(outputDir)
    .filter(f => f.toLowerCase().endsWith('.jpg'))
    .sort();

  if (jpgFiles.length === 0 || summary.exportedCount <= 0) {
    throw new Error('PowerPoint COM export produced no slide images.');
  }

  return {
    file: {
      filePath,
      originalSize,
      count: jpgFiles.length,
      totalCount: summary.totalCount,
      outputDir,
      truncated: !pageRange && summary.totalCount > jpgFiles.length,
    },
  };
}

async function renderPresentationWithLibreOffice(
  filePath: string,
  originalSize: number,
  totalCount: number | null,
  pageRange?: PageRange,
): Promise<PresentationRenderResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-pptx-'));
  const pdfPath = path.join(tmpDir, `${path.parse(filePath).name}.pdf`);

  const sofficeEnv = getSofficeEnv();
  const convertArgs = [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    tmpDir,
    filePath,
  ];

  try {
    await execFileAsync('soffice', convertArgs, { timeout: 30000, env: sofficeEnv });
  } catch (error) {
    const reason = (error as any)?.code === 'ENOENT'
      ? 'LibreOffice (soffice) is not available for PPT/PPTX rendering.'
      : `PowerPoint to PDF conversion failed: ${toError(error).message}`;
    throw new Error(reason);
  }

  if (!fs.existsSync(pdfPath)) {
    throw new Error('PowerPoint to PDF conversion did not produce a PDF file.');
  }

  const effectivePageRange = pageRange ?? { firstPage: 1, lastPage: MAX_RENDERED_PRESENTATION_PAGES };
  const extracted = await extractPdfPages(pdfPath, effectivePageRange);
  if (extracted.success === false) {
    throw new Error(extracted.error.message);
  }

  const count = extracted.data.file.count;

  return {
    file: {
      filePath,
      originalSize,
      count,
      totalCount,
      outputDir: extracted.data.file.outputDir,
      truncated: !pageRange && totalCount !== null && totalCount > count,
    },
  };
}

interface PowerPointExportSummary {
  totalCount: number;
  exportedCount: number;
}

function buildPowerPointExportScript(
  filePath: string,
  outputDir: string,
  firstPage: number,
  lastPage: number,
): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$inputPath = '${escapePowerShellString(filePath)}'`,
    `$outputDir = '${escapePowerShellString(outputDir)}'`,
    `$startPage = ${firstPage}`,
    `$requestedEndPage = ${lastPage}`,
    '$targetWidth = 1600',
    'New-Item -ItemType Directory -Force -Path $outputDir | Out-Null',
    '$powerPoint = $null',
    '$presentation = $null',
    'try {',
    '  $powerPoint = New-Object -ComObject PowerPoint.Application',
    '  $presentation = $powerPoint.Presentations.Open($inputPath, $true, $false, $false)',
    '  $totalCount = [int]$presentation.Slides.Count',
    '  $slideWidth = [double]$presentation.PageSetup.SlideWidth',
    '  $slideHeight = [double]$presentation.PageSetup.SlideHeight',
    '  if ($slideWidth -gt 0 -and $slideHeight -gt 0) {',
    '    $targetHeight = [int][Math]::Round($targetWidth * $slideHeight / $slideWidth)',
    '  } else {',
    '    $targetHeight = 900',
    '  }',
    '  $startPage = [Math]::Max(1, $startPage)',
    '  $endPage = if ($requestedEndPage -lt 0) { $totalCount } else { [Math]::Min($totalCount, $requestedEndPage) }',
    '  $exportedCount = 0',
    '  if ($startPage -le $endPage) {',
    '    for ($i = $startPage; $i -le $endPage; $i++) {',
    "      $targetPath = Join-Path $outputDir ('slide-' + $i.ToString('000') + '.jpg')",
    "      $presentation.Slides.Item($i).Export($targetPath, 'JPG', $targetWidth, $targetHeight)",
    '      $exportedCount += 1',
    '    }',
    '  }',
    '  @{ totalCount = $totalCount; exportedCount = $exportedCount } | ConvertTo-Json -Compress',
    '} finally {',
    '  if ($presentation -ne $null) { $presentation.Close() | Out-Null }',
    '  if ($powerPoint -ne $null) { $powerPoint.Quit() }',
    '  [System.GC]::Collect()',
    '  [System.GC]::WaitForPendingFinalizers()',
    '}',
  ].join('\n');
}

function parsePowerPointExportSummary(stdout: string): PowerPointExportSummary {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as Partial<PowerPointExportSummary>;
      if (typeof parsed.totalCount === 'number' && typeof parsed.exportedCount === 'number') {
        return {
          totalCount: parsed.totalCount,
          exportedCount: parsed.exportedCount,
        };
      }
    } catch {
      // continue scanning backward
    }
  }

  throw new Error(`Could not parse PowerPoint COM export output: ${stdout || '(empty stdout)'}`);
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

function getExecStdout(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof (result as any).stdout !== 'undefined') {
    return String((result as any).stdout);
  }
  return '';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function getPresentationSlideCount(filePath: string): Promise<number | null> {
  try {
    const JSZip = (await import('jszip')).default;
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);
    let count = 0;
    zip.forEach((relativePath) => {
      if (/^ppt\/slides\/slide\d+\.xml$/i.test(relativePath)) {
        count += 1;
      }
    });
    return count;
  } catch {
    return null;
  }
}

function getSofficeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.SAL_USE_VCLPLUGIN = 'svp';
  return env;
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
    case 'ppt':
      // legacy .ppt 无法走 XML 解析，读取端应优先走整页渲染路径
      throw new Error('Legacy .ppt text extraction is not supported via XML parsing.');
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
    case 'ppt':
      // legacy .ppt 无法走 XML 解析，读取端应优先走整页渲染路径
      throw new Error('Legacy .ppt text extraction is not supported via XML parsing.');
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

// ========== 文档编辑功能 ==========

export interface EditDocumentResult {
  success: boolean;
  replacements: number;
  error?: string;
}

/**
 * 清除指定文件的搜索缓存
 */
export function clearDocumentCache(filePath: string): void {
  try {
    const cachePath = getCachePath(filePath);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // 缓存清除失败不影响主逻辑
  }
}

/**
 * XML 转义（用于写回 XML 内容）
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * XML 反转义（用于从 XML 提取纯文本比较）
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * 编辑 DOCX 文件中的文本（保留格式）
 * 
 * 策略：JSZip 解压 → 操作 word/document.xml 中的 <w:t> 节点 → 重新打包
 * 
 * 难点：Word 可能将一个可见字符串拆成多个 <w:r><w:t> 节点（中间穿插格式标记）。
 * 解法：按段落（<w:p>）为单位，拼接所有 <w:t> 文本进行匹配，
 * 然后根据匹配位置精确修改对应的 <w:t> 节点。
 */
export async function editDocx(
  filePath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<EditDocumentResult> {
  const JSZip = (await import('jszip')).default;
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 需要搜索的 XML 文件列表（document.xml + headers/footers）
  const xmlFiles = ['word/document.xml'];
  zip.forEach((relativePath) => {
    if (/^word\/(header|footer)\d+\.xml$/i.test(relativePath)) {
      xmlFiles.push(relativePath);
    }
  });

  let totalReplacements = 0;

  for (const xmlFile of xmlFiles) {
    const file = zip.file(xmlFile);
    if (!file) continue;
    let xml = await file.async('text');

    const result = replaceTextInWordXml(xml, oldText, newText, replaceAll);
    if (result.replacements > 0) {
      xml = result.xml;
      totalReplacements += result.replacements;
      zip.file(xmlFile, xml);
    }

    if (totalReplacements > 0 && !replaceAll) break;
  }

  if (totalReplacements === 0) {
    return { success: false, replacements: 0, error: 'Text not found in document' };
  }

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, output);
  clearDocumentCache(filePath);

  return { success: true, replacements: totalReplacements };
}

/**
 * 在 Word XML 中查找并替换文本
 * 处理文本可能跨多个 <w:t> 节点的情况
 */
function replaceTextInWordXml(
  xml: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): { xml: string; replacements: number } {
  let replacements = 0;

  // 按段落 <w:p> 处理
  const paragraphRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;

  const resultXml = xml.replace(paragraphRegex, (paragraph) => {
    if (!replaceAll && replacements > 0) return paragraph;

    // 提取段落中所有 <w:t> 节点的文本和位置信息
    const runs = extractRunTexts(paragraph);
    const fullText = runs.map(r => r.text).join('');

    // 在拼接文本中查找 oldText
    let currentFullText = fullText;
    let searchFrom = 0;

    while (true) {
      const pos = currentFullText.indexOf(oldText, searchFrom);
      if (pos === -1) break;

      replacements++;

      // 在 runs 中定位并替换
      paragraph = spliceRunTexts(paragraph, runs, pos, oldText.length, newText);

      if (!replaceAll) break;

      // replaceAll 模式下需要重新解析（因为 XML 结构已变）
      const newRuns = extractRunTexts(paragraph);
      currentFullText = newRuns.map(r => r.text).join('');
      // 跳过已替换部分继续搜索
      searchFrom = pos + newText.length;
      if (searchFrom >= currentFullText.length) break;
      // 更新 runs 引用
      runs.length = 0;
      runs.push(...newRuns);
    }

    return paragraph;
  });

  return { xml: resultXml, replacements };
}

interface RunTextInfo {
  /** <w:t> 节点中的纯文本（已反转义） */
  text: string;
  /** 该 <w:t> 在段落 XML 中的起始偏移 */
  xmlStart: number;
  /** 该 <w:t> 在段落 XML 中的结束偏移（含闭合标签） */
  xmlEnd: number;
  /** <w:t> 标签的开标签（含属性，如 xml:space="preserve"） */
  openTag: string;
}

/**
 * 提取段落中所有 <w:t> 节点的文本和位置
 */
function extractRunTexts(paragraphXml: string): RunTextInfo[] {
  const runs: RunTextInfo[] = [];
  const regex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let match;
  while ((match = regex.exec(paragraphXml)) !== null) {
    runs.push({
      text: unescapeXml(match[2]),
      xmlStart: match.index,
      xmlEnd: match.index + match[0].length,
      openTag: match[1],
    });
  }
  return runs;
}

/**
 * 根据拼接文本中的位置和长度，精确修改对应的 <w:t> 节点
 * 返回修改后的段落 XML
 */
function spliceRunTexts(
  paragraphXml: string,
  runs: RunTextInfo[],
  textPos: number,
  deleteLen: number,
  insertText: string,
): string {
  // 找到受影响的 run 范围
  let charOffset = 0;
  let startRunIdx = -1;
  let startCharInRun = 0;
  let endRunIdx = -1;
  let endCharInRun = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const runEnd = charOffset + run.text.length;

    if (startRunIdx === -1 && textPos < runEnd) {
      startRunIdx = i;
      startCharInRun = textPos - charOffset;
    }

    if (startRunIdx !== -1 && textPos + deleteLen <= runEnd) {
      endRunIdx = i;
      endCharInRun = textPos + deleteLen - charOffset;
      break;
    }

    charOffset += run.text.length;
  }

  if (startRunIdx === -1 || endRunIdx === -1) return paragraphXml;

  // 构建每个受影响 run 的新文本
  const replacements: Array<{ run: RunTextInfo; newText: string }> = [];

  for (let i = startRunIdx; i <= endRunIdx; i++) {
    const run = runs[i];
    let newRunText: string;

    if (i === startRunIdx && i === endRunIdx) {
      // 替换完全在一个 run 内
      newRunText = run.text.substring(0, startCharInRun) + insertText + run.text.substring(endCharInRun);
    } else if (i === startRunIdx) {
      // 第一个 run：保留前缀 + 插入新文本
      newRunText = run.text.substring(0, startCharInRun) + insertText;
    } else if (i === endRunIdx) {
      // 最后一个 run：保留后缀
      newRunText = run.text.substring(endCharInRun);
    } else {
      // 中间的 run：完全删除文本
      newRunText = '';
    }

    replacements.push({ run, newText: newRunText });
  }

  // 从后往前替换 XML（保持偏移正确）
  let result = paragraphXml;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { run, newText } = replacements[i];
    // 确保有 xml:space="preserve" 以保留空格
    const openTag = newText.includes(' ') || newText.startsWith(' ') || newText.endsWith(' ')
      ? '<w:t xml:space="preserve">'
      : run.openTag;
    const newNode = `${openTag}${escapeXml(newText)}</w:t>`;
    result = result.substring(0, run.xmlStart) + newNode + result.substring(run.xmlEnd);
  }

  return result;
}

/**
 * 编辑 XLSX 文件中的文本（保留格式）
 * 
 * 策略：JSZip 解压 → 操作 xl/sharedStrings.xml（共享字符串表）→ 重新打包
 * 
 * XLSX 中的文本存储在 sharedStrings.xml 中，单元格通过索引引用。
 * 只改 sharedStrings.xml 中的文本值，其他结构（格式、图表、宏）原封不动。
 */
export async function editXlsx(
  filePath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<EditDocumentResult> {
  const JSZip = (await import('jszip')).default;
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  let replacements = 0;

  // 1. 搜索 xl/sharedStrings.xml（共享字符串表，大多数文本在这里）
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    let xml = await ssFile.async('text');

    // 在 <si> 条目中的 <t> 标签里查找并替换文本
    // 结构: <si><t>text</t></si> 或 <si><r><t>text</t></r>...</si>（富文本）
    const siRegex = /<si>([\s\S]*?)<\/si>/g;

    xml = xml.replace(siRegex, (siMatch, siContent: string) => {
      if (!replaceAll && replacements > 0) return siMatch;

      // 提取 <t> 标签的文本拼接
      const tRegex = /(<t[^>]*>)([\s\S]*?)(<\/t>)/g;
      const tNodes: Array<{ full: string; text: string; openTag: string }> = [];
      let tMatch;
      while ((tMatch = tRegex.exec(siContent)) !== null) {
        tNodes.push({
          full: tMatch[0],
          text: unescapeXml(tMatch[2]),
          openTag: tMatch[1],
        });
      }

      if (tNodes.length === 0) return siMatch;

      // 简单情况：只有一个 <t> 节点
      if (tNodes.length === 1) {
        const t = tNodes[0];
        if (!t.text.includes(oldText)) return siMatch;

        let replaced: string;
        if (replaceAll) {
          const count = t.text.split(oldText).length - 1;
          replacements += count;
          replaced = t.text.replaceAll(oldText, newText);
        } else {
          replacements++;
          replaced = t.text.replace(oldText, newText);
        }

        const newOpenTag = replaced.includes(' ') ? '<t xml:space="preserve">' : t.openTag;
        const newT = `${newOpenTag}${escapeXml(replaced)}</t>`;
        const newSiContent = siContent.replace(t.full, newT);
        return `<si>${newSiContent}</si>`;
      }

      // 多 <t> 节点（富文本）：逐个 <t> 内尝试替换
      const fullText = tNodes.map(t => t.text).join('');
      if (!fullText.includes(oldText)) return siMatch;

      let modified = false;
      let newSiContent = siContent;
      for (const t of tNodes) {
        if (!replaceAll && modified) break;
        if (!t.text.includes(oldText)) continue;

        let replaced: string;
        if (replaceAll) {
          const count = t.text.split(oldText).length - 1;
          replacements += count;
          replaced = t.text.replaceAll(oldText, newText);
        } else {
          replacements++;
          replaced = t.text.replace(oldText, newText);
          modified = true;
        }

        const newOpenTag = replaced.includes(' ') ? '<t xml:space="preserve">' : t.openTag;
        const newT = `${newOpenTag}${escapeXml(replaced)}</t>`;
        newSiContent = newSiContent.replace(t.full, newT);
      }

      return `<si>${newSiContent}</si>`;
    });

    if (replacements > 0) {
      zip.file('xl/sharedStrings.xml', xml);
    }
  }

  // 2. 搜索 sheet XML 中的内联字符串（<is><t>text</t></is>）
  if (replacements === 0 || replaceAll) {
    const sheetFiles: string[] = [];
    zip.forEach((relativePath) => {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(relativePath)) {
        sheetFiles.push(relativePath);
      }
    });

    for (const sheetFile of sheetFiles) {
      if (!replaceAll && replacements > 0) break;
      const file = zip.file(sheetFile);
      if (!file) continue;
      let sheetXml = await file.async('text');

      // 内联字符串: <c t="inlineStr"><is><t>text</t></is></c>
      const isRegex = /(<is>[\s\S]*?<t[^>]*>)([\s\S]*?)(<\/t>[\s\S]*?<\/is>)/g;
      let sheetModified = false;

      sheetXml = sheetXml.replace(isRegex, (match, before, text, after) => {
        if (!replaceAll && replacements > 0) return match;
        const decoded = unescapeXml(text);
        if (!decoded.includes(oldText)) return match;

        let replaced: string;
        if (replaceAll) {
          const count = decoded.split(oldText).length - 1;
          replacements += count;
          replaced = decoded.replaceAll(oldText, newText);
        } else {
          replacements++;
          replaced = decoded.replace(oldText, newText);
        }

        sheetModified = true;
        return `${before}${escapeXml(replaced)}${after}`;
      });

      if (sheetModified) {
        zip.file(sheetFile, sheetXml);
      }
    }
  }

  if (replacements === 0) {
    return { success: false, replacements: 0, error: 'Text not found in spreadsheet' };
  }

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, output);
  clearDocumentCache(filePath);

  return { success: true, replacements };
}

/**
 * 编辑 PPTX 文件中的文本（保留格式）
 * 
 * 策略：JSZip 解压 → 操作 ppt/slides/slide*.xml 中的 <a:t> 节点 → 重新打包
 * 和 DOCX 类似，文本可能跨多个 <a:r><a:t> 节点。
 */
export async function editPptx(
  filePath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<EditDocumentResult> {
  const JSZip = (await import('jszip')).default;
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 收集所有 slide 文件
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

  let totalReplacements = 0;

  for (const slideFile of slideFiles) {
    const file = zip.file(slideFile);
    if (!file) continue;
    let xml = await file.async('text');

    const result = replaceTextInPptxXml(xml, oldText, newText, replaceAll);
    if (result.replacements > 0) {
      xml = result.xml;
      totalReplacements += result.replacements;
      zip.file(slideFile, xml);
    }

    if (totalReplacements > 0 && !replaceAll) break;
  }

  if (totalReplacements === 0) {
    return { success: false, replacements: 0, error: 'Text not found in presentation' };
  }

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, output);
  clearDocumentCache(filePath);

  return { success: true, replacements: totalReplacements };
}

/**
 * 在 PPTX slide XML 中查找并替换文本
 * 处理文本可能跨多个 <a:t> 节点的情况（和 Word 的 <w:t> 类似）
 */
function replaceTextInPptxXml(
  xml: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): { xml: string; replacements: number } {
  let replacements = 0;

  // 按文本段 <a:p> 处理
  const paragraphRegex = /<a:p[\s>][\s\S]*?<\/a:p>/g;

  const resultXml = xml.replace(paragraphRegex, (paragraph) => {
    if (!replaceAll && replacements > 0) return paragraph;

    // 提取所有 <a:t> 节点
    const runs: RunTextInfo[] = [];
    const regex = /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g;
    let match;
    while ((match = regex.exec(paragraph)) !== null) {
      runs.push({
        text: unescapeXml(match[2]),
        xmlStart: match.index,
        xmlEnd: match.index + match[0].length,
        openTag: match[1],
      });
    }

    if (runs.length === 0) return paragraph;

    let currentFullText = runs.map(r => r.text).join('');
    let searchFrom = 0;

    while (true) {
      const pos = currentFullText.indexOf(oldText, searchFrom);
      if (pos === -1) break;

      replacements++;
      paragraph = spliceRunTextsPptx(paragraph, runs, pos, oldText.length, newText);

      if (!replaceAll) break;

      // 重新解析
      const newRuns: RunTextInfo[] = [];
      const re2 = /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g;
      let m2;
      while ((m2 = re2.exec(paragraph)) !== null) {
        newRuns.push({
          text: unescapeXml(m2[2]),
          xmlStart: m2.index,
          xmlEnd: m2.index + m2[0].length,
          openTag: m2[1],
        });
      }
      searchFrom = pos + newText.length;
      currentFullText = newRuns.map(r => r.text).join('');
      if (searchFrom >= currentFullText.length) break;
      runs.length = 0;
      runs.push(...newRuns);
    }

    return paragraph;
  });

  return { xml: resultXml, replacements };
}

/**
 * PPTX 版本的 spliceRunTexts（操作 <a:t> 节点）
 */
function spliceRunTextsPptx(
  paragraphXml: string,
  runs: RunTextInfo[],
  textPos: number,
  deleteLen: number,
  insertText: string,
): string {
  let charOffset = 0;
  let startRunIdx = -1;
  let startCharInRun = 0;
  let endRunIdx = -1;
  let endCharInRun = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const runEnd = charOffset + run.text.length;

    if (startRunIdx === -1 && textPos < runEnd) {
      startRunIdx = i;
      startCharInRun = textPos - charOffset;
    }

    if (startRunIdx !== -1 && textPos + deleteLen <= runEnd) {
      endRunIdx = i;
      endCharInRun = textPos + deleteLen - charOffset;
      break;
    }

    charOffset += run.text.length;
  }

  if (startRunIdx === -1 || endRunIdx === -1) return paragraphXml;

  const replacements: Array<{ run: RunTextInfo; newText: string }> = [];

  for (let i = startRunIdx; i <= endRunIdx; i++) {
    const run = runs[i];
    let newRunText: string;

    if (i === startRunIdx && i === endRunIdx) {
      newRunText = run.text.substring(0, startCharInRun) + insertText + run.text.substring(endCharInRun);
    } else if (i === startRunIdx) {
      newRunText = run.text.substring(0, startCharInRun) + insertText;
    } else if (i === endRunIdx) {
      newRunText = run.text.substring(endCharInRun);
    } else {
      newRunText = '';
    }

    replacements.push({ run, newText: newRunText });
  }

  let result = paragraphXml;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { run, newText: txt } = replacements[i];
    const newNode = `${run.openTag}${escapeXml(txt)}</a:t>`;
    result = result.substring(0, run.xmlStart) + newNode + result.substring(run.xmlEnd);
  }

  return result;
}

/**
 * 统一文档编辑入口
 */
export async function editDocument(
  filePath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<EditDocumentResult> {
  const ext = path.extname(filePath).toLowerCase().slice(1);

  switch (ext) {
    case 'docx':
      return editDocx(filePath, oldText, newText, replaceAll);
    case 'xlsx':
      return editXlsx(filePath, oldText, newText, replaceAll);
    case 'pptx':
      return editPptx(filePath, oldText, newText, replaceAll);
    default:
      return { success: false, replacements: 0, error: `Unsupported document format: .${ext}` };
  }
}
