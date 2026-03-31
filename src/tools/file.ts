/**
 * 文件操作工具
 * Read, Write, Edit
 *
 * 对应官方实现 (cli.js):
 * - m2A 函数: 智能字符串匹配，处理智能引号
 * - lY2 函数: 字符串替换逻辑
 * - GG1/VSA 函数: Edit 验证和执行
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { structuredPatch } from 'diff';
import { BaseTool } from './base.js';
import type { FileReadInput, FileWriteInput, FileEditInput, FileResult, EditToolResult, ToolDefinition } from '../types/index.js';
import {
  readImageFile,
  readPdfFile,
  renderSvgToPng,
  detectMediaType,
  isBlacklistedFile,
  isSupportedImageFormat,
  isPdfExtension,
  isPdfSupported,
  isSvgRenderEnabled,
  parsePageRange,
  getPdfPageCount,
  extractPdfPages,
  formatBytes,
  PDF_MAX_PAGES_PER_REQUEST,
  PDF_LARGE_THRESHOLD,
  isOfficeFile,
  documentToHtml,
  editDocument,
  documentToText,
  clearDocumentCache,
  extractDocumentVisuals,
  compressExtractedImages,
  renderPresentationToImages,
  MAX_RENDERED_PRESENTATION_PAGES,
} from '../media/index.js';
// 注意：旧的 blueprintContext 已被移除，新架构使用 SmartPlanner
// 边界检查由 SmartPlanner 在任务规划阶段处理，工具层不再需要
import { persistLargeOutputSync } from './output-persistence.js';
import { runPreToolUseHooks, runPostToolUseHooks } from '../hooks/index.js';
import { getChangeTracker } from '../hooks/auto-verify.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { t } from '../i18n/index.js';
import { fromMsysPath } from '../utils/platform.js';

/**
 * 解析文件路径
 * 如果是相对路径，则基于当前工作目录（从 AsyncLocalStorage 获取）解析
 * 这解决了多 Worker 并发时工作目录混乱的问题
 *
 * @param filePath 输入的文件路径（可能是相对路径或绝对路径）
 * @returns 绝对路径
 */
function resolveFilePath(filePath: string): string {
  // 处理 MSYS/Git Bash 路径格式：/f/axon → F:/axon
  // 子 agent 从 Bash 输出中拿到的路径可能是 MSYS 格式，Node.js fs 不认识
  filePath = fromMsysPath(filePath);

  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  // 使用 getCurrentCwd() 获取当前工作目录上下文
  // 这是通过 AsyncLocalStorage 设置的，支持多 Worker 并发
  const cwd = getCurrentCwd();
  return path.resolve(cwd, filePath);
}

/**
 * v2.1.69: 检查写入路径是否通过 symlink 逃逸工作目录
 *
 * 攻击向量：如果工作目录中有一个 symlink 指向外部目录，
 * 模型可以通过该 symlink 写入任意位置的文件。
 *
 * 修复：解析所有父目录的真实路径，确保最终目标在工作目录内。
 */
function validateWritePath(filePath: string): { safe: boolean; realPath: string; reason?: string } {
  const cwd = getCurrentCwd();

  try {
    // 找到最深的已存在的父目录，解析其真实路径
    let checkPath = filePath;
    while (!fs.existsSync(checkPath)) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break; // 到达根目录
      checkPath = parent;
    }

    // 如果已存在部分是 symlink 或包含 symlink，解析真实路径
    const realParent = fs.existsSync(checkPath) ? fs.realpathSync(checkPath) : checkPath;
    const relativePart = path.relative(checkPath, filePath);
    const realPath = relativePart ? path.join(realParent, relativePart) : realParent;

    // 检查真实路径是否在工作目录内
    const realCwd = fs.realpathSync(cwd);
    const normalizedRealPath = path.normalize(realPath).toLowerCase();
    const normalizedRealCwd = path.normalize(realCwd).toLowerCase();

    if (!normalizedRealPath.startsWith(normalizedRealCwd + path.sep) &&
        normalizedRealPath !== normalizedRealCwd) {
      return {
        safe: false,
        realPath,
        reason: `Path resolves to '${realPath}' which is outside the working directory '${realCwd}' (possible symlink escape)`,
      };
    }

    return { safe: true, realPath };
  } catch {
    // 如果无法解析，默认允许（不阻止正常操作）
    return { safe: true, realPath: filePath };
  }
}

/**
 * 差异预览接口
 */
interface DiffPreview {
  diff: string;
  additions: number;
  deletions: number;
  contextLines: number;
}

/**
 * 批量编辑接口
 */
interface BatchEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * 扩展的编辑输入接口（包含批量编辑）
 */
interface ExtendedFileEditInput extends FileEditInput {
  batch_edits?: BatchEdit[];
  show_diff?: boolean;
  require_confirmation?: boolean;
}

const IGNORABLE_BATCH_PLACEHOLDER_VALUES = new Set([
  '',
  'placeholder',
  'unused',
]);

function isIgnorableBatchPlaceholderValue(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  return IGNORABLE_BATCH_PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function hasMeaningfulTopLevelBatchEdit(oldString: string | undefined, newString: string | undefined): boolean {
  if (oldString === undefined && newString === undefined) {
    return false;
  }

  return !isIgnorableBatchPlaceholderValue(oldString) || !isIgnorableBatchPlaceholderValue(newString);
}

/**
 * 文件读取记录接口
 * v3.7: 对齐官网实现 - 存储 content 而不是 contentHash
 * 官网策略：直接比较 content 字符串，不使用哈希
 */
interface FileReadRecord {
  path: string;
  readTime: number;    // 读取时的时间戳
  mtime: number;       // 读取时的文件修改时间（mtimeMs）
  content: string;     // 文件内容（已标准化换行符为 LF）
  offset?: number;     // 部分读取时的偏移量
  limit?: number;      // 部分读取时的限制
}

/**
 * 全局文件读取跟踪器
 * 用于验证在编辑文件之前是否已读取该文件
 * 并跟踪文件的 mtime 以检测外部修改
 */
class FileReadTracker {
  private static instance: FileReadTracker;
  private readFiles: Map<string, FileReadRecord> = new Map();

  static getInstance(): FileReadTracker {
    if (!FileReadTracker.instance) {
      FileReadTracker.instance = new FileReadTracker();
    }
    return FileReadTracker.instance;
  }

  /**
   * 标记文件已被读取
   * v3.7: 对齐官网实现 - 存储 content 而不是 contentHash
   *
   * @param filePath 文件路径
   * @param content 文件内容（已标准化为 LF 换行符）
   * @param mtime 文件修改时间（mtimeMs）
   * @param offset 可选，部分读取时的偏移量
   * @param limit 可选，部分读取时的限制
   */
  markAsRead(filePath: string, content: string, mtime: number, offset?: number, limit?: number): void {
    // 规范化路径
    const normalizedPath = path.resolve(filePath);
    const record: FileReadRecord = {
      path: normalizedPath,
      readTime: Date.now(),
      mtime,
      content,
      offset,
      limit,
    };
    this.readFiles.set(normalizedPath, record);
  }

  hasBeenRead(filePath: string): boolean {
    const normalizedPath = path.resolve(filePath);
    return this.readFiles.has(normalizedPath);
  }

  getRecord(filePath: string): FileReadRecord | undefined {
    const normalizedPath = path.resolve(filePath);
    return this.readFiles.get(normalizedPath);
  }

  clear(): void {
    this.readFiles.clear();
  }
}

// 导出跟踪器供外部使用
export const fileReadTracker = FileReadTracker.getInstance();

/**
 * 计算文件内容的 SHA256 哈希值
 * v2.1.7: 用于内容变更检测，修复 Windows 上的时间戳假错误
 */
function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 智能引号字符映射
 * 对应官方 cli.js 中的 RI5, _I5, jI5, TI5 常量
 */
const SMART_QUOTE_MAP: Record<string, string> = {
  '\u2018': "'",  // 左单引号 '
  '\u2019': "'",  // 右单引号 '
  '\u201C': '"',  // 左双引号 "
  '\u201D': '"',  // 右双引号 "
};

/**
 * LLM 输出的畸形 XML token 映射表
 * 对应官方 cli.js 中的 pS9 / dS9 函数
 *
 * 模型有时会输出缩写的 XML token（因内部 tokenizer 的关系），
 * 导致 old_string 中包含 <fnr> 而文件中实际是 <function_results> 等。
 * 这个映射表将缩写 token 还原为完整形式。
 */
const TOKEN_TAG_MAP: Record<string, string> = {
  '<fnr>': '<function_results>',
  '<n>': '<name>',
  '</n>': '</name>',
  '<o>': '<output>',
  '</o>': '</output>',
  '<e>': '<error>',
  '</e>': '</error>',
  '<s>': '<system>',
  '</s>': '</system>',
  '<r>': '<result>',
  '</r>': '</result>',
};

/**
 * 将智能引号转换为普通引号
 * 对应官方 cli.js 中的 cY2 函数
 */
function normalizeQuotes(str: string): string {
  let result = str;
  for (const [smart, normal] of Object.entries(SMART_QUOTE_MAP)) {
    result = result.replaceAll(smart, normal);
  }
  return result;
}

/**
 * 标准化 LLM 输出中的畸形 XML token
 * 对应官方 cli.js 中的 dS9 函数
 *
 * @returns 标准化后的字符串和应用的替换列表
 */
function normalizeTokenTags(str: string): { result: string; appliedReplacements: Array<{ from: string; to: string }> } {
  let result = str;
  const appliedReplacements: Array<{ from: string; to: string }> = [];
  for (const [abbrev, full] of Object.entries(TOKEN_TAG_MAP)) {
    const before = result;
    result = result.replaceAll(abbrev, full);
    if (before !== result) {
      appliedReplacements.push({ from: abbrev, to: full });
    }
  }
  return { result, appliedReplacements };
}

/**
 * 清理字符串中的尾部空白（保持行结构）
 * 对应官方 cli.js 中的 VJ0 函数
 */
function cleanTrailingWhitespace(str: string): string {
  const parts = str.split(/(\r\n|\n|\r)/);
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined) {
      if (i % 2 === 0) {
        // 文本部分，清理尾部空白
        result += part.replace(/\s+$/, '');
      } else {
        // 换行符部分，保持原样
        result += part;
      }
    }
  }
  return result;
}

/**
 * 智能字符串匹配函数
 * 对应官方 cli.js 中的 m2A 函数
 *
 * 功能：
 * 1. 直接匹配
 * 2. 智能引号转换后匹配
 * 3. 返回实际匹配的字符串（保持原始格式）
 */
function findMatchingString(fileContents: string, searchString: string): string | null {
  // 直接匹配
  if (fileContents.includes(searchString)) {
    return searchString;
  }

  // 尝试智能引号转换
  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedContents = normalizeQuotes(fileContents);
  const index = normalizedContents.indexOf(normalizedSearch);

  if (index !== -1) {
    // 返回原始文件中对应位置的字符串
    return fileContents.substring(index, index + searchString.length);
  }

  return null;
}

/**
 * 检测行号前缀模式
 * Read 工具输出格式: "  123\tcode content"
 * 即: 空格 + 行号 + 制表符 + 实际内容
 */
const LINE_NUMBER_PREFIX_PATTERN = /^(\s*\d+)\t/;

/**
 * 移除字符串中的行号前缀
 * 用于处理从 Read 工具输出中复制的内容
 */
function stripLineNumberPrefixes(str: string): string {
  return str.split('\n').map(line => {
    const match = line.match(LINE_NUMBER_PREFIX_PATTERN);
    if (match) {
      // 移除行号前缀（包括制表符）
      return line.substring(match[0].length);
    }
    return line;
  }).join('\n');
}

/**
 * 检测字符串是否包含行号前缀
 */
function hasLineNumberPrefixes(str: string): boolean {
  const lines = str.split('\n');
  // 检查是否有多行都包含行号前缀模式
  let prefixCount = 0;
  for (const line of lines) {
    if (LINE_NUMBER_PREFIX_PATTERN.test(line)) {
      prefixCount++;
    }
  }
  // 如果超过一半的行有行号前缀，则认为需要处理
  return prefixCount > 0 && prefixCount >= lines.length / 2;
}

/**
 * 智能查找并匹配字符串
 * 对应官方 cli.js 中的 sn7 + m2A 函数
 *
 * 渐进式匹配策略：
 * 1. 直接匹配（含智能引号标准化）
 * 2. 行号前缀处理
 * 3. XML token 标准化（dS9）
 * 4. 尾部换行处理
 */
function smartFindString(fileContents: string, searchString: string): string | null {
  // 1. 直接匹配（findMatchingString 内部已含智能引号标准化）
  let match = findMatchingString(fileContents, searchString);
  if (match) return match;

  // 2. 尝试移除行号前缀后匹配
  if (hasLineNumberPrefixes(searchString)) {
    const strippedSearch = stripLineNumberPrefixes(searchString);
    match = findMatchingString(fileContents, strippedSearch);
    if (match) return match;
  }

  // 3. XML token 标准化（对应官方 dS9/sn7）
  // 模型有时输出缩写 token（如 <fnr> 代替 <function_results>）
  const { result: normalizedSearch, appliedReplacements } = normalizeTokenTags(searchString);
  if (appliedReplacements.length > 0) {
    match = findMatchingString(fileContents, normalizedSearch);
    if (match) return match;
  }

  // 4. 处理尾部换行
  // 如果搜索字符串不以换行结尾，但文件中该位置后面有换行
  if (!searchString.endsWith('\n') && fileContents.includes(searchString + '\n')) {
    return searchString;
  }

  return null;
}

/**
 * 执行字符串替换
 * 对应官方 cli.js 中的 lY2 函数
 */
function replaceString(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false
): string {
  if (replaceAll) {
    return content.replaceAll(oldString, newString);
  }

  // 处理空 new_string 的特殊情况
  if (newString === '') {
    // 如果 old_string 不以换行结尾，但在文件中后面跟着换行
    // 则应该也删除那个换行
    if (!oldString.endsWith('\n') && content.includes(oldString + '\n')) {
      return content.replace(oldString + '\n', newString);
    }
  }

  return content.replace(oldString, newString);
}

export class ReadTool extends BaseTool<FileReadInput, FileResult> {
  name = 'Read';
  description = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Axon to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Axon is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can read Office documents (.docx, .xlsx, .pptx) and converts them to HTML for easy reading. Word documents preserve formatting, Excel files show all sheets as tables, PowerPoint files extract slide text.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'The line number to start reading from. Only provide if the file is too large to read at once',
        },
        limit: {
          type: 'number',
          description: 'The number of lines to read. Only provide if the file is too large to read at once.',
        },
        pages: {
          type: 'string',
          description: `Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum ${PDF_MAX_PAGES_PER_REQUEST} pages per request.`,
        },
      },
      required: ['file_path'],
    };
  }

  async execute(input: FileReadInput): Promise<FileResult> {
    const normalizedPages = typeof input.pages === 'string' && input.pages === ''
      ? undefined
      : input.pages;
    const { file_path: inputPath, offset = 0, limit = 2000 } = input;

    // 解析文件路径（支持相对路径，基于当前工作目录上下文）
    const file_path = resolveFilePath(inputPath);

    // v2.1.30: 验证 pages 参数
    if (normalizedPages !== undefined) {
      const parsedRange = parsePageRange(normalizedPages);
      if (!parsedRange) {
        return {
          success: false,
          error: t('file.invalidPages', { pages: normalizedPages }),
        };
      }
      const pageCount = parsedRange.lastPage === Infinity
        ? PDF_MAX_PAGES_PER_REQUEST + 1
        : parsedRange.lastPage - parsedRange.firstPage + 1;
      if (pageCount > PDF_MAX_PAGES_PER_REQUEST) {
        return {
          success: false,
          error: t('file.pageRangeExceeds', { pages: normalizedPages, max: PDF_MAX_PAGES_PER_REQUEST }),
        };
      }
    }

    try {
      if (!fs.existsSync(file_path)) {
        return { success: false, error: t('file.notFound', { path: file_path }) };
      }

      const stat = fs.statSync(file_path);
      if (stat.isDirectory()) {
        return { success: false, error: t('file.isDirectory', { path: file_path }) };
      }

      const ext = path.extname(file_path).toLowerCase().slice(1);

      // 检查是否在黑名单中
      if (isBlacklistedFile(file_path)) {
        return {
          success: false,
          error: t('file.binaryNotSupported', { ext })
        };
      }

      // 处理 Office 文档 (docx/xlsx/pptx)
      if (isOfficeFile(file_path)) {
        return await this.readOfficeDocument(file_path);
      }

      // 检测媒体文件类型
      const mediaType = detectMediaType(file_path);

      // 处理图片
      if (mediaType === 'image') {
        return await this.readImageEnhanced(file_path);
      }

      // 处理 PDF
      if (mediaType === 'pdf') {
        return await this.readPdfEnhanced(file_path, normalizedPages);
      }

      // 处理 SVG（可选渲染）
      if (mediaType === 'svg') {
        return await this.readSvg(file_path);
      }

      // 处理 Jupyter Notebook
      if (ext === 'ipynb') {
        return this.readNotebook(file_path);
      }

      // 读取文本文件
      const content = fs.readFileSync(file_path, 'utf-8');
      const lines = content.split('\n');
      const selectedLines = lines.slice(offset, offset + limit);

      // 格式化带行号的输出
      const maxLineNumWidth = String(offset + selectedLines.length).length;
      let output = selectedLines.map((line, idx) => {
        const lineNum = String(offset + idx + 1).padStart(maxLineNumWidth, ' ');
        const truncatedLine = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
        return `${lineNum}\t${truncatedLine}`;
      }).join('\n');

      // 使用输出持久化处理大输出
      const persistResult = persistLargeOutputSync(output, {
        toolName: 'Read',
        maxLength: 30000,
      });

      // v3.7: 对齐官网实现 - 存储完整文件内容
      // 官网逻辑: z.set(X,{content:G, timestamp:dP(X), offset:void 0, limit:void 0})
      // 标准化换行符以确保跨平台一致性（Windows CRLF -> LF）
      const normalizedContent = content.replaceAll('\r\n', '\n');

      // 标记文件已被读取（用于 Edit 工具验证）
      // 如果是部分读取（offset != 0 或未读到末尾），记录 offset 和 limit
      const isPartialRead = offset !== 0 || (offset + limit) < lines.length;
      if (isPartialRead) {
        fileReadTracker.markAsRead(file_path, normalizedContent, stat.mtimeMs, offset, limit);
      } else {
        // 完整读取，不传 offset 和 limit（与官网一致）
        fileReadTracker.markAsRead(file_path, normalizedContent, stat.mtimeMs);
      }

      return {
        success: true,
        content: persistResult.content,
        output: persistResult.content,
        lineCount: lines.length,
      };
    } catch (err) {
      return { success: false, error: t('file.readError', { error: err }) };
    }
  }

  /**
   * Office 文档读取（图片优先模式）
   * 从 ZIP 中提取嵌入图片 + 文本，通过 newMessages 让模型"看到"文档内容
   * 降级：如果图片提取失败，回退到 HTML 文本模式
   */
  private async readOfficeDocument(filePath: string): Promise<FileResult> {
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const sizeKB = (stat.size / 1024).toFixed(2);

      if (ext === 'ppt' || ext === 'pptx') {
        try {
          const rendered = await renderPresentationToImages(filePath);
          const jpgFiles = fs.readdirSync(rendered.file.outputDir)
            .filter(f => f.endsWith('.jpg'))
            .sort();

          if (jpgFiles.length > 0) {
            const imageBlocks: Array<{
              type: 'image';
              source: {
                type: 'base64';
                media_type: 'image/jpeg';
                data: string;
              };
            }> = [];

            for (const jpgFile of jpgFiles) {
              const jpgPath = path.join(rendered.file.outputDir, jpgFile);
              const base64 = fs.readFileSync(jpgPath).toString('base64');
              imageBlocks.push({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: base64,
                },
              });
            }

            let slideText = '';
            if (ext === 'pptx') {
              slideText = await documentToText(filePath);
            }
            let textOutput = `[${ext.toUpperCase()} Document: ${filePath}] (${sizeKB} KB)\n`;
            textOutput += `Slides rendered: ${jpgFiles.length} page image(s)`;
            if (rendered.file.totalCount !== null) {
              textOutput += ` of ${rendered.file.totalCount}`;
            }
            if (rendered.file.truncated) {
              textOutput += ` (truncated to first ${MAX_RENDERED_PRESENTATION_PAGES} slides)`;
            }
            if (slideText) {
              textOutput += '\n\n';
              textOutput += slideText;
            }

            return {
              success: true,
              output: textOutput,
              newMessages: [{
                role: 'user' as const,
                content: imageBlocks as any,
              }],
            };
          }
        } catch {
          // PPT 渲染失败时再回退到旧的 embedded image 提取逻辑
        }
      }

      // 尝试视觉提取（图片 + 文本）
      try {
        const visuals = await extractDocumentVisuals(filePath);

        // 收集所有图片（slide 关联的 + 未关联的）
        const allImages = [
          ...visuals.slides.flatMap(s => s.images),
          ...visuals.unassociatedImages,
        ];

        if (allImages.length > 0) {
          // 压缩图片
          const compressed = await compressExtractedImages(allImages);

          if (compressed.length > 0) {
            // 构建文本输出
            let textOutput = `[${ext.toUpperCase()} Document: ${filePath}] (${sizeKB} KB)\n`;
            textOutput += `Images: ${compressed.length} embedded image(s) extracted\n\n`;
            textOutput += visuals.fullText;

            // 构建 image blocks（与 PDF readPdfEnhanced 模式一致）
            const imageBlocks: Array<{
              type: 'image';
              source: {
                type: 'base64';
                media_type: 'image/jpeg' | 'image/png';
                data: string;
              };
            }> = [];

            for (const img of compressed) {
              imageBlocks.push({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: img.mimeType,
                  data: img.base64,
                },
              });
            }

            return {
              success: true,
              output: textOutput,
              newMessages: [{
                role: 'user' as const,
                content: imageBlocks as any,
              }],
            };
          }
        }

        // 有文本但没图片：返回纯文本
        if (visuals.fullText) {
          const header = `[${ext.toUpperCase()} Document: ${filePath}] (${sizeKB} KB)\n\n`;
          return { success: true, output: header + visuals.fullText };
        }
      } catch {
        // 视觉提取失败，降级到 HTML 模式
      }

      // 降级：转 HTML 文本
      const html = await documentToHtml(filePath);
      const header = `[${ext.toUpperCase()} Document: ${filePath}] (${sizeKB} KB)\n\n`;
      return { success: true, output: header + html };
    } catch (err) {
      return {
        success: false,
        error: `Failed to read Office document: ${err}`,
      };
    }
  }

  /**
   * 增强的图片读取（使用媒体处理模块）
   */
  private async readImageEnhanced(filePath: string): Promise<FileResult> {
    try {
      const result = await readImageFile(filePath);
      const sizeKB = (result.file.originalSize / 1024).toFixed(2);
      const tokenEstimate = Math.ceil(result.file.base64.length * 0.125);

      let output = `[Image: ${filePath}]\n`;
      output += `Format: ${result.file.type}\n`;
      output += `Size: ${sizeKB} KB\n`;

      if (result.file.dimensions) {
        const { originalWidth, originalHeight, displayWidth, displayHeight } = result.file.dimensions;
        if (originalWidth && originalHeight) {
          output += `Original dimensions: ${originalWidth}x${originalHeight}\n`;
          if (displayWidth && displayHeight && (displayWidth !== originalWidth || displayHeight !== originalHeight)) {
            output += `Display dimensions: ${displayWidth}x${displayHeight} (resized)\n`;
          }
        }
      }

      output += `Estimated tokens: ${tokenEstimate}`;

      return {
        success: true,
        output,
        content: `data:${result.file.type};base64,${result.file.base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: t('file.imageReadError', { error }),
      };
    }
  }

  /**
   * 增强的 PDF 读取（使用媒体处理模块）
   * v2.1.30: 支持 pages 参数，大 PDF 强制使用页面范围
   *
   * 对应官方实现 (cli.js 第3626行附近):
   * - 如果有 pages 参数，使用 pdftoppm 提取指定页面为 JPEG
   * - 如果没有 pages 参数且 PDF > 10 页，报错要求提供 pages
   * - 如果没有 pages 参数且 PDF <= 10 页，作为 document 发送
   */
  private async readPdfEnhanced(filePath: string, pages?: string): Promise<FileResult> {
    try {
      // 检查 PDF 支持
      if (!isPdfSupported()) {
        return {
          success: false,
          error: t('file.pdfNotEnabled'),
        };
      }

      // v2.1.30: 如果提供了 pages 参数，使用 pdftoppm 提取指定页面
      if (pages) {
        const parsedRange = parsePageRange(pages);
        const extractResult = await extractPdfPages(filePath, parsedRange ?? undefined);

        if (extractResult.success === false) {
          return {
            success: false,
            error: extractResult.error.message,
          };
        }

        const { data } = extractResult;
        const output = `PDF pages extracted: ${data.file.count} page(s) from ${filePath} (${formatBytes(data.file.originalSize)})`;

        // 读取提取的 JPEG 图片并构建 newMessages
        const outputDir = data.file.outputDir;
        const jpgFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.jpg')).sort();

        const imageBlocks: Array<{
          type: 'image';
          source: {
            type: 'base64';
            media_type: 'image/jpeg';
            data: string;
          };
        }> = [];

        for (const jpgFile of jpgFiles) {
          const jpgPath = path.join(outputDir, jpgFile);
          const jpgData = fs.readFileSync(jpgPath).toString('base64');
          imageBlocks.push({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/jpeg' as const,
              data: jpgData,
            },
          });
        }

        return {
          success: true,
          output,
          newMessages: imageBlocks.length > 0 ? [
            {
              role: 'user' as const,
              content: imageBlocks as any,
            },
          ] : undefined,
        };
      }

      // v2.1.30: 检查 PDF 页数，超过阈值必须使用 pages 参数
      const pageCount = await getPdfPageCount(filePath);
      if (pageCount !== null && pageCount > PDF_LARGE_THRESHOLD) {
        return {
          success: false,
          error: t('file.pdfTooLarge', { count: pageCount, max: PDF_MAX_PAGES_PER_REQUEST }),
        };
      }

      // PDF <= 10 页或无法检测页数：直接作为 document 发送
      const result = await readPdfFile(filePath);
      const output = `PDF file read: ${filePath} (${formatBytes(result.file.originalSize)})`;

      return {
        success: true,
        output,
        content: result.file.base64,
        newMessages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'document' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'application/pdf' as const,
                  data: result.file.base64,
                },
              },
            ],
          },
        ],
      };
    } catch (error: any) {
      // v2.1.31: PDF 过大错误不应锁死 session
      // 返回友好的错误信息，包含实际限制
      const errorMessage = error?.message || String(error);
      return {
        success: false,
        error: t('file.pdfReadError', { error: errorMessage }),
      };
    }
  }

  /**
   * SVG 文件读取（可选渲染为 PNG）
   */
  private async readSvg(filePath: string): Promise<FileResult> {
    try {
      // 检查是否启用 SVG 渲染
      if (isSvgRenderEnabled()) {
        // 渲染为 PNG
        const result = await renderSvgToPng(filePath, {
          fitTo: { mode: 'width', value: 800 }
        });

        let output = `[SVG rendered to PNG: ${filePath}]\n`;
        output += `Format: ${result.file.type}\n`;
        if (result.file.dimensions) {
          output += `Dimensions: ${result.file.dimensions.displayWidth}x${result.file.dimensions.displayHeight}\n`;
        }

        return {
          success: true,
          output,
          content: `data:${result.file.type};base64,${result.file.base64}`,
        };
      } else {
        // 作为文本读取
        const content = fs.readFileSync(filePath, 'utf-8');
        return {
          success: true,
          output: `[SVG File: ${filePath}]\n`,
          content,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: t('file.svgReadError', { error }),
      };
    }
  }

  private readImage(filePath: string): FileResult {
    const base64 = fs.readFileSync(filePath).toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' :
                     ext === '.gif' ? 'image/gif' :
                     ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return {
      success: true,
      output: `[Image: ${filePath}]\nBase64 data (${base64.length} chars)`,
      content: `data:${mimeType};base64,${base64}`,
    };
  }

  private readPdf(filePath: string): FileResult {
    // 简化版 PDF 读取
    return {
      success: true,
      output: `[PDF File: ${filePath}]\nPDF reading requires additional processing.`,
    };
  }

  /**
   * 读取 Jupyter Notebook 文件
   * 完整支持单元格输出的 MIME bundles 处理
   *
   * 支持的输出类型：
   * - execute_result: 代码执行结果
   * - display_data: 显示数据（图表、HTML 等）
   * - stream: stdout/stderr 流
   * - error: 错误信息和 traceback
   *
   * 支持的 MIME 类型：
   * - text/plain: 纯文本
   * - text/html: HTML 内容
   * - text/markdown: Markdown 内容
   * - image/png, image/jpeg, image/gif, image/svg+xml: 图片
   * - application/json: JSON 数据
   */
  private readNotebook(filePath: string): FileResult {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const notebook = JSON.parse(content);
      const cells = notebook.cells || [];

      let output = '';
      const imageMessages: Array<{
        role: 'user';
        content: Array<{
          type: 'text' | 'image';
          text?: string;
          source?: {
            type: 'base64';
            media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
            data: string;
          };
        }>;
      }> = [];

      cells.forEach((cell: any, idx: number) => {
        const cellType = cell.cell_type || 'unknown';
        const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
        const executionCount = cell.execution_count;

        // 单元格头部
        const cellHeader = executionCount
          ? `In [${executionCount}]`
          : `Cell ${idx + 1}`;
        output += `\n${'═'.repeat(60)}\n`;
        output += `📝 ${cellHeader} (${cellType})\n`;
        output += `${'─'.repeat(60)}\n`;
        output += `${source}\n`;

        // 处理单元格输出（仅 code 类型有输出）
        if (cellType === 'code' && cell.outputs && Array.isArray(cell.outputs)) {
          const cellOutputs = this.processCellOutputs(cell.outputs, idx);

          if (cellOutputs.text) {
            output += `\n${'─'.repeat(40)}\n`;
            output += `📤 Output:\n`;
            output += cellOutputs.text;
          }

          // 收集图片消息
          if (cellOutputs.images.length > 0) {
            for (const img of cellOutputs.images) {
              imageMessages.push({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `[Jupyter Notebook image output - Cell ${idx + 1}]`,
                  },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                      data: img.data,
                    },
                  },
                ],
              });
            }
            output += `\n🖼️ [${cellOutputs.images.length} image output(s) - see images below]\n`;
          }
        }
      });

      output += `\n${'═'.repeat(60)}\n`;
      output += `📊 Notebook stats: ${cells.length} cells\n`;

      // 构建结果
      const result: FileResult = {
        success: true,
        output,
        content,
      };

      // 如果有图片，添加到 newMessages
      if (imageMessages.length > 0) {
        result.newMessages = imageMessages;
      }

      return result;
    } catch (err) {
      return { success: false, error: t('file.notebookReadError', { error: err }) };
    }
  }

  /**
   * 处理单元格输出
   * 解析 MIME bundles 并提取可显示的内容
   */
  private processCellOutputs(outputs: any[], cellIndex: number): {
    text: string;
    images: Array<{ mimeType: string; data: string }>;
  } {
    let textOutput = '';
    const images: Array<{ mimeType: string; data: string }> = [];

    for (const output of outputs) {
      const outputType = output.output_type;

      switch (outputType) {
        case 'execute_result':
        case 'display_data': {
          // MIME bundle 输出
          const data = output.data || {};
          const executionCount = output.execution_count;

          // 优先处理图片
          const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
          let hasImage = false;

          for (const mimeType of imageTypes) {
            if (data[mimeType]) {
              const imgData = Array.isArray(data[mimeType])
                ? data[mimeType].join('')
                : data[mimeType];

              // SVG 特殊处理（转为 base64）
              if (mimeType === 'image/svg+xml') {
                const svgBase64 = Buffer.from(imgData).toString('base64');
                images.push({ mimeType: 'image/svg+xml', data: svgBase64 });
              } else {
                // PNG/JPEG/GIF 已经是 base64
                images.push({ mimeType, data: imgData });
              }
              hasImage = true;
              break;
            }
          }

          // 如果没有图片，显示其他内容
          if (!hasImage) {
            // 优先显示 HTML
            if (data['text/html']) {
              const html = Array.isArray(data['text/html'])
                ? data['text/html'].join('')
                : data['text/html'];
              textOutput += `[HTML output]\n${this.sanitizeHtmlForTerminal(html)}\n`;
            }
            // 其次显示 Markdown
            else if (data['text/markdown']) {
              const md = Array.isArray(data['text/markdown'])
                ? data['text/markdown'].join('')
                : data['text/markdown'];
              textOutput += `${md}\n`;
            }
            // 显示 JSON
            else if (data['application/json']) {
              const json = data['application/json'];
              textOutput += `[JSON]\n${JSON.stringify(json, null, 2)}\n`;
            }
            // 最后显示纯文本
            else if (data['text/plain']) {
              const text = Array.isArray(data['text/plain'])
                ? data['text/plain'].join('')
                : data['text/plain'];
              if (executionCount) {
                textOutput += `Out[${executionCount}]: ${text}\n`;
              } else {
                textOutput += `${text}\n`;
              }
            }
          }
          break;
        }

        case 'stream': {
          // stdout/stderr 流输出
          const name = output.name || 'stdout';
          const text = Array.isArray(output.text)
            ? output.text.join('')
            : (output.text || '');

          if (name === 'stderr') {
            textOutput += `⚠️ stderr:\n${text}`;
          } else {
            textOutput += text;
          }
          break;
        }

        case 'error': {
          // 错误输出
          const ename = output.ename || 'Error';
          const evalue = output.evalue || '';
          const traceback = output.traceback || [];

          textOutput += `❌ ${ename}: ${evalue}\n`;
          if (traceback.length > 0) {
            // 清理 ANSI 转义码
            const cleanTraceback = traceback
              .map((line: string) => this.stripAnsiCodes(line))
              .join('\n');
            textOutput += `${cleanTraceback}\n`;
          }
          break;
        }

        default:
          // 未知输出类型
          if (output.text) {
            const text = Array.isArray(output.text)
              ? output.text.join('')
              : output.text;
            textOutput += `${text}\n`;
          }
      }
    }

    return { text: textOutput, images };
  }

  /**
   * 清理 HTML 以便在终端显示
   * 保留基本结构，移除复杂标签
   */
  private sanitizeHtmlForTerminal(html: string): string {
    // 移除 script 和 style 标签
    let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');

    // 将表格转为简单格式
    clean = clean.replace(/<table[\s\S]*?>/gi, '\n┌────────────────────────────────────┐\n');
    clean = clean.replace(/<\/table>/gi, '\n└────────────────────────────────────┘\n');
    clean = clean.replace(/<tr[\s\S]*?>/gi, '│ ');
    clean = clean.replace(/<\/tr>/gi, ' │\n');
    clean = clean.replace(/<th[\s\S]*?>/gi, '');
    clean = clean.replace(/<\/th>/gi, ' | ');
    clean = clean.replace(/<td[\s\S]*?>/gi, '');
    clean = clean.replace(/<\/td>/gi, ' | ');

    // 处理常见标签
    clean = clean.replace(/<br\s*\/?>/gi, '\n');
    clean = clean.replace(/<p[\s\S]*?>/gi, '\n');
    clean = clean.replace(/<\/p>/gi, '\n');
    clean = clean.replace(/<div[\s\S]*?>/gi, '\n');
    clean = clean.replace(/<\/div>/gi, '\n');
    clean = clean.replace(/<h[1-6][\s\S]*?>/gi, '\n### ');
    clean = clean.replace(/<\/h[1-6]>/gi, '\n');
    clean = clean.replace(/<li[\s\S]*?>/gi, '\n• ');
    clean = clean.replace(/<\/li>/gi, '');
    clean = clean.replace(/<ul[\s\S]*?>/gi, '\n');
    clean = clean.replace(/<\/ul>/gi, '\n');
    clean = clean.replace(/<ol[\s\S]*?>/gi, '\n');
    clean = clean.replace(/<\/ol>/gi, '\n');
    clean = clean.replace(/<strong[\s\S]*?>/gi, '**');
    clean = clean.replace(/<\/strong>/gi, '**');
    clean = clean.replace(/<em[\s\S]*?>/gi, '_');
    clean = clean.replace(/<\/em>/gi, '_');
    clean = clean.replace(/<code[\s\S]*?>/gi, '`');
    clean = clean.replace(/<\/code>/gi, '`');
    clean = clean.replace(/<pre[\s\S]*?>/gi, '\n```\n');
    clean = clean.replace(/<\/pre>/gi, '\n```\n');

    // 移除所有剩余标签
    clean = clean.replace(/<[^>]+>/g, '');

    // 解码 HTML 实体
    clean = clean.replace(/&nbsp;/g, ' ');
    clean = clean.replace(/&lt;/g, '<');
    clean = clean.replace(/&gt;/g, '>');
    clean = clean.replace(/&amp;/g, '&');
    clean = clean.replace(/&quot;/g, '"');
    clean = clean.replace(/&#39;/g, "'");

    // 清理多余空行
    clean = clean.replace(/\n{3,}/g, '\n\n');

    return clean.trim();
  }

  /**
   * 移除 ANSI 转义码
   * 用于清理 Jupyter traceback 中的颜色代码
   */
  private stripAnsiCodes(str: string): string {
    // 移除 ANSI 转义序列
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  }
}

export class WriteTool extends BaseTool<FileWriteInput, FileResult> {
  name = 'Write';
  description = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to write (must be absolute, not relative)',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['file_path', 'content'],
    };
  }

  async execute(input: FileWriteInput): Promise<FileResult> {
    const { file_path: inputPath, content } = input;

    // 解析文件路径（支持相对路径，基于当前工作目录上下文）
    const file_path = resolveFilePath(inputPath);

    try {
      const hookResult = await runPreToolUseHooks('Write', input);
      if (!hookResult.allowed) {
        return { success: false, error: hookResult.message || t('file.blockedByHook') };
      }

      // 注意：蓝图边界检查已移除
      // 新架构中，边界检查由 SmartPlanner 在任务规划阶段处理

      // v2.1.69: symlink 逃逸检查
      const pathCheck = validateWritePath(file_path);
      if (!pathCheck.safe) {
        return { success: false, error: pathCheck.reason || 'Path escapes working directory via symlink' };
      }

      // 确保目录存在
      const dir = path.dirname(file_path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(file_path, content, 'utf-8');

      // v3.7: 写入成功后更新 FileReadTracker（对齐官网实现）
      // 这样后续的 Edit 操作可以正常工作
      try {
        const stat = fs.statSync(file_path);
        const normalizedContent = content.replaceAll('\r\n', '\n');
        fileReadTracker.markAsRead(file_path, normalizedContent, stat.mtimeMs);
      } catch {
        // 如果更新失败，不影响写入结果
      }

      const lines = content.split('\n').length;
      const result = {
        success: true,
        output: t('file.writeSuccess', { lines, path: file_path }),
        lineCount: lines,
      };
      await runPostToolUseHooks('Write', input, result.output || '');

      // Auto-verify: 追踪代码文件变更
      try {
        const sessionId = (globalThis as any).__currentSessionId;
        if (sessionId) getChangeTracker(sessionId).trackChange(file_path, 'Write');
      } catch { /* ignore */ }

      return result;
    } catch (err) {
      return { success: false, error: t('file.writeError', { error: err }) };
    }
  }
}

/**
 * 生成 Unified Diff 格式的差异预览
 * 使用 diff 库的 Myers O(ND) 算法（与官方 Claude Code 一致）
 */
function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines: number = 3
): DiffPreview {
  const baseName = path.basename(filePath);
  const patch = structuredPatch(
    `a/${baseName}`,
    `b/${baseName}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: contextLines }
  );

  let additions = 0;
  let deletions = 0;
  let diff = `--- a/${baseName}\n+++ b/${baseName}\n`;

  for (const hunk of patch.hunks) {
    diff += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
    for (const line of hunk.lines) {
      diff += line + '\n';
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
    }
  }

  return {
    diff,
    additions,
    deletions,
    contextLines,
  };
}

/**
 * 备份文件内容（用于回滚）
 */
class FileBackup {
  private backups: Map<string, string> = new Map();

  backup(filePath: string, content: string): void {
    this.backups.set(filePath, content);
  }

  restore(filePath: string): boolean {
    const content = this.backups.get(filePath);
    if (content === undefined) {
      return false;
    }
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.backups.clear();
  }

  has(filePath: string): boolean {
    return this.backups.has(filePath);
  }
}

/**
 * Edit 验证错误码
 * 对应官方 cli.js 中的 errorCode
 */
enum EditErrorCode {
  NO_CHANGE = 1,              // 文件内容无变化
  PATH_DENIED = 2,            // 路径权限被拒绝
  FILE_EXISTS = 3,            // 文件已存在（创建新文件时）
  FILE_NOT_FOUND = 4,         // 文件不存在
  IS_NOTEBOOK = 5,            // 是 Jupyter Notebook 文件
  NOT_READ = 6,               // 文件未被读取
  EXTERNALLY_MODIFIED = 7,    // 文件在读取后被外部修改
  STRING_NOT_FOUND = 8,       // 字符串未找到
  MULTIPLE_MATCHES = 9,       // 找到多个匹配
  FILE_NOT_READ = 10,         // 文件未被读取（兼容旧代码）
  INVALID_PATH = 11,          // 无效路径
}

export class EditTool extends BaseTool<ExtendedFileEditInput, EditToolResult> {
  name = 'Edit';
  description = `Performs exact string replacements in files, including Office documents (.docx, .xlsx, .pptx).

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- For Office documents (.docx, .xlsx, .pptx), performs text replacement while preserving formatting. The old_string/new_string work on the text content (same as what Read tool shows). Only text content can be edited; formatting/layout changes are not supported.`;

  private fileBackup = new FileBackup();
  /** 是否强制要求先读取文件（可通过环境变量配置） */
  private requireFileRead: boolean = process.env.AXON_EDIT_REQUIRE_READ !== 'false';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to modify',
        },
        old_string: {
          type: 'string',
          description: 'The text to replace',
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences of old_string (default false)',
          default: false,
        },
        batch_edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: 'The text to replace' },
              new_string: { type: 'string', description: 'The replacement text' },
              replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
            },
            required: ['old_string', 'new_string'],
          },
          description: 'Array of edits to apply atomically',
        },
      },
      required: ['file_path'],
    };
  }

  async execute(input: ExtendedFileEditInput): Promise<EditToolResult> {
    const {
      file_path: inputPath,
      old_string,
      new_string,
      replace_all = false,
      batch_edits,
      show_diff = true,
      require_confirmation = false,
    } = input;
    const hasBatchEdits = Array.isArray(batch_edits) && batch_edits.length > 0;

    // 解析文件路径（支持相对路径，基于当前工作目录上下文）
    const file_path = resolveFilePath(inputPath);

    try {
      // 注意：不再要求必须是绝对路径，因为 resolveFilePath 已经处理了相对路径

      // 注意：蓝图边界检查已移除
      // 新架构中，边界检查由 SmartPlanner 在任务规划阶段处理

      // v2.1.69: symlink 逃逸检查
      const pathCheck = validateWritePath(file_path);
      if (!pathCheck.safe) {
        return { success: false, error: pathCheck.reason || 'Path escapes working directory via symlink' };
      }

      const hookResult = await runPreToolUseHooks('Edit', input);
      if (!hookResult.allowed) {
        return { success: false, error: hookResult.message || t('file.blockedByHook') };
      }

      if (hasBatchEdits && hasMeaningfulTopLevelBatchEdit(old_string, new_string)) {
        return {
          success: false,
          error: 'Cannot combine batch_edits with top-level old_string/new_string edits.',
        };
      }

      if (!hasBatchEdits && (old_string === undefined || new_string === undefined)) {
        return {
          success: false,
          error: 'Edit requires either batch_edits or top-level old_string/new_string.',
        };
      }

      // 2. 验证文件是否已被读取（如果启用了此检查）
      if (this.requireFileRead && !fileReadTracker.hasBeenRead(file_path)) {
        return {
          success: false,
          error: t('file.mustReadBeforeEdit', { path: file_path }),
          errorCode: EditErrorCode.NOT_READ,
        };
      }

      // 3. 检查文件是否存在
      if (!fs.existsSync(file_path)) {
        // 特殊情况：如果 old_string 为空，视为创建新文件
        if (old_string === '' && new_string !== undefined) {
          const result = this.createNewFile(file_path, new_string);
          if (result.success) {
            await runPostToolUseHooks('Edit', input, result.output || '');
          }
          return result;
        }
        return { success: false, error: t('file.notFound', { path: file_path }) };
      }

      const stat = fs.statSync(file_path);
      if (stat.isDirectory()) {
        return { success: false, error: t('file.isDirectory', { path: file_path }) };
      }

      // Office 文档走专用编辑路径（JSZip XML 级编辑，保留格式）
      if (isOfficeFile(file_path)) {
        const result = await this.editOfficeDocument(
          file_path, old_string!, new_string!, replace_all, batch_edits, show_diff,
        );
        if (result.success) {
          await runPostToolUseHooks('Edit', input, result.output || '');
        }
        return result;
      }

      // 5. 读取原始内容并标准化换行符
      // 官方实现: let $ = O.readFileSync(w, {encoding:uX(w)}).replaceAll(`\r\n`, `\n`)
      // Windows 文件使用 CRLF，但 Claude 传来的 old_string 使用 LF，必须统一
      const rawContent = fs.readFileSync(file_path, 'utf-8');
      const originalContent = rawContent.replaceAll('\r\n', '\n');

      // 4. 检查文件是否在读取后被外部修改
      // v3.7: 对齐官网实现 - 直接比较 content 字符串，不使用哈希
      // 官网逻辑: if(dP(w)>_.timestamp) if($.readFileSync(w).replaceAll(`\r\n`,`\n`)===_.content); else return error
      const readRecord = fileReadTracker.getRecord(file_path);
      if (readRecord && stat.mtimeMs > readRecord.mtime) {
        // 时间戳已变化，需要检查内容是否真正被修改
        // 特殊处理：如果是部分读取（有 offset 或 limit），跳过验证
        // 官网逻辑: if (C && C.offset === void 0 && C.limit === void 0 && M === C.content)
        if (readRecord.offset !== undefined || readRecord.limit !== undefined) {
          // 部分读取的文件不能进行完整内容比对，直接报错
          return {
            success: false,
            error: t('file.modifiedSinceRead'),
            errorCode: EditErrorCode.EXTERNALLY_MODIFIED,
          };
        }

        // 全文读取：直接比较 content 字符串（已标准化为 LF）
        // originalContent 已经标准化过了（见上方 1284 行）
        if (originalContent !== readRecord.content) {
          return {
            success: false,
            error: t('file.modifiedSinceRead'),
            errorCode: EditErrorCode.EXTERNALLY_MODIFIED,
          };
        }
        // 如果 content 相同，说明只是时间戳变化但内容未变
        // 这种情况在 Windows 上很常见（linter/prettier 触碰文件），不应该报错
      }

      // 6. 特殊情况：old_string 为空表示写入/覆盖整个文件（仅单次编辑模式）
      if (!hasBatchEdits && old_string === '') {
        const result = this.writeEntireFile(file_path, new_string ?? '', originalContent, show_diff);
        if (result.success) {
          await runPostToolUseHooks('Edit', input, result.output || '');
        }
        return result;
      }

      // 7. 备份原始内容
      this.fileBackup.backup(file_path, originalContent);

      // 8. 确定编辑操作列表，并做 token 标准化预处理（对齐官方 sn7）
      const rawEdits: BatchEdit[] = hasBatchEdits ? batch_edits : [{ old_string: old_string!, new_string: new_string!, replace_all }];
      const edits = rawEdits.map(edit => {
        // 如果 old_string 精确匹配文件内容，无需标准化
        if (originalContent.includes(edit.old_string)) return edit;
        // 尝试 token 标准化
        const { result: normalized, appliedReplacements } = normalizeTokenTags(edit.old_string);
        if (appliedReplacements.length > 0 && originalContent.includes(normalized)) {
          // 对 new_string 也应用同样的替换（对齐官方 sn7）
          let newStr = edit.new_string;
          for (const { from, to } of appliedReplacements) {
            newStr = newStr.replaceAll(from, to);
          }
          return { ...edit, old_string: normalized, new_string: newStr };
        }
        return edit;
      });

      // 9. 验证并执行所有编辑操作
      let currentContent = originalContent;
      const appliedEdits: string[] = [];

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];

        // 9.1 智能查找匹配字符串
        const matchedString = smartFindString(currentContent, edit.old_string);

        if (!matchedString) {
          // 字符串未找到
          return {
            success: false,
            error: t('file.stringNotFound', { str: edit.old_string }),
            errorCode: EditErrorCode.STRING_NOT_FOUND,
          };
        }

        // 9.2 计算匹配次数
        const matchCount = currentContent.split(matchedString).length - 1;

        // 9.3 如果不是 replace_all，检查唯一性
        if (matchCount > 1 && !edit.replace_all) {
          return {
            success: false,
            error: t('file.multipleMatches', { count: String(matchCount), str: edit.old_string }),
            errorCode: EditErrorCode.MULTIPLE_MATCHES,
          };
        }

        // 9.4 检查 old_string 和 new_string 是否相同
        if (matchedString === edit.new_string) {
          continue; // 跳过无变化的编辑
        }

        // 9.5 检查是否会与之前的 new_string 冲突
        for (const prevEdit of appliedEdits) {
          if (matchedString !== '' && prevEdit.includes(matchedString)) {
            return {
              success: false,
              error: t('file.editSubstringConflict', { match: matchedString }),
            };
          }
        }

        // 9.6 应用编辑
        currentContent = replaceString(currentContent, matchedString, edit.new_string, edit.replace_all);
        appliedEdits.push(edit.new_string);
      }

      // 10. 检查是否有实际变化
      if (currentContent === originalContent) {
        return {
          success: false,
          error: t('file.editNoChanges'),
        };
      }

      const modifiedContent = currentContent;

      // 11. 生成差异预览
      let diffPreview: DiffPreview | null = null;
      if (show_diff) {
        diffPreview = generateUnifiedDiff(file_path, originalContent, modifiedContent);
      }

      // 12. 检查是否需要确认
      if (require_confirmation) {
        return {
          success: false,
          error: t('file.confirmationRequired'),
          output: diffPreview ? this.formatDiffOutput(diffPreview) : undefined,
        };
      }

      // 13. 执行实际的文件写入
      try {
        fs.writeFileSync(file_path, modifiedContent, 'utf-8');

        // v3.7: 写入成功后更新 FileReadTracker（对齐官网实现）
        // 官网逻辑: z.set(X,{content:G, timestamp:dP(X), offset:void 0, limit:void 0})
        // 重新读取文件获取最新的 mtime 和 content（linter 可能在写入后立即修改文件）
        try {
          const newStat = fs.statSync(file_path);
          const newContent = fs.readFileSync(file_path, 'utf-8');
          const normalizedNewContent = newContent.replaceAll('\r\n', '\n');
          fileReadTracker.markAsRead(file_path, normalizedNewContent, newStat.mtimeMs);
        } catch {
          // 如果更新失败，不影响编辑结果
        }

        // 构建输出消息
        let output = '';

        if (batch_edits) {
          output += t('file.editBatchSuccess', { count: edits.length, path: file_path }) + '\n';
        } else {
          output += t('file.editSuccess', { path: file_path }) + '\n';
        }

        if (diffPreview) {
          output += '\n' + this.formatDiffOutput(diffPreview);
        }

        // 清除备份
        this.fileBackup.clear();

        const result = {
          success: true,
          output,
          content: modifiedContent,
        };
        await runPostToolUseHooks('Edit', input, result.output || '');

        // Auto-verify: 追踪代码文件变更
        try {
          const sessionId = (globalThis as any).__currentSessionId;
          if (sessionId) getChangeTracker(sessionId).trackChange(file_path, 'Edit');
        } catch { /* ignore */ }

        return result;
      } catch (writeErr) {
        // 写入失败，尝试回滚
        this.fileBackup.restore(file_path);
        return {
          success: false,
          error: t('file.editWriteError', { error: writeErr }),
        };
      }
    } catch (err) {
      // 发生错误，尝试回滚
      if (this.fileBackup.has(file_path)) {
        this.fileBackup.restore(file_path);
      }
      return {
        success: false,
        error: t('file.editError', { error: err }),
      };
    }
  }

  /**
   * 创建新文件
   * 当 old_string 为空且文件不存在时调用
   */
  private createNewFile(filePath: string, content: string): EditToolResult {
    try {
      // 确保父目录存在
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');

      // v3.7: 创建文件后更新 FileReadTracker（对齐官网实现）
      try {
        const stat = fs.statSync(filePath);
        const normalizedContent = content.replaceAll('\r\n', '\n');
        fileReadTracker.markAsRead(filePath, normalizedContent, stat.mtimeMs);
      } catch {
        // 如果更新失败，不影响创建结果
      }

      const lineCount = content.split('\n').length;
      return {
        success: true,
        output: t('file.createSuccess', { path: filePath, lines: lineCount }),
        content,
      };
    } catch (err) {
      return {
        success: false,
        error: t('file.createError', { error: err }),
      };
    }
  }

  /**
   * 编辑 Office 文档（docx/xlsx/pptx）
   * 使用 JSZip 在 XML 级别进行文本替换，保留原始格式
   */
  private async editOfficeDocument(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    batchEdits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>,
    showDiff = true,
  ): Promise<EditToolResult> {
    try {
      // 获取编辑前的文本表示（用于生成 diff）
      const textBefore = await documentToText(filePath);

      // 备份原始文件（二进制备份）
      const backupBuffer = fs.readFileSync(filePath);

      // 确定编辑列表
      const edits = batchEdits || [{ old_string: oldString, new_string: newString, replace_all: replaceAll }];

      let totalReplacements = 0;

      for (const edit of edits) {
        const result = await editDocument(
          filePath,
          edit.old_string,
          edit.new_string,
          edit.replace_all ?? false,
        );

        if (!result.success) {
          // 回滚到备份
          fs.writeFileSync(filePath, backupBuffer);
          return {
            success: false,
            error: result.error || `Failed to edit document: "${edit.old_string}" not found`,
            errorCode: EditErrorCode.STRING_NOT_FOUND,
          };
        }

        totalReplacements += result.replacements;
      }

      // 获取编辑后的文本表示
      const textAfter = await documentToText(filePath);

      // 更新 fileReadTracker（用文本表示，与 Read 工具保持一致）
      try {
        const stat = fs.statSync(filePath);
        fileReadTracker.markAsRead(filePath, textAfter, stat.mtimeMs);
      } catch {
        // 不影响编辑结果
      }

      // 清除搜索缓存
      clearDocumentCache(filePath);

      // 生成文本层 diff
      const ext = path.extname(filePath).toLowerCase().slice(1).toUpperCase();
      let output = '';

      if (batchEdits) {
        output += `${ext} document edited successfully: ${edits.length} edits, ${totalReplacements} replacements in ${filePath}\n`;
      } else {
        output += `${ext} document edited successfully: ${totalReplacements} replacement(s) in ${filePath}\n`;
      }

      if (showDiff) {
        const diffPreview = generateUnifiedDiff(filePath, textBefore, textAfter);
        if (diffPreview) {
          output += '\n' + this.formatDiffOutput(diffPreview);
        }
      }

      return {
        success: true,
        output,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to edit Office document: ${err}`,
      };
    }
  }

  /**
   * 写入整个文件（覆盖现有内容）
   * 当 old_string 为空且文件存在时调用
   */
  private writeEntireFile(
    filePath: string,
    newContent: string,
    originalContent: string,
    showDiff: boolean
  ): EditToolResult {
    try {
      // 备份原始内容
      this.fileBackup.backup(filePath, originalContent);

      // 检查内容是否相同
      if (newContent === originalContent) {
        return {
          success: false,
          error: t('file.writeEntireNoChanges'),
        };
      }

      // 生成差异预览
      let diffPreview: DiffPreview | null = null;
      if (showDiff) {
        diffPreview = generateUnifiedDiff(filePath, originalContent, newContent);
      }

      // 写入文件
      fs.writeFileSync(filePath, newContent, 'utf-8');

      // 构建输出消息
      let output = t('file.writeEntireSuccess', { path: filePath }) + '\n';
      if (diffPreview) {
        output += '\n' + this.formatDiffOutput(diffPreview);
      }

      // 清除备份
      this.fileBackup.clear();

      return {
        success: true,
        output,
        content: newContent,
      };
    } catch (err) {
      // 写入失败，尝试回滚
      this.fileBackup.restore(filePath);
      return {
        success: false,
        error: t('file.writeEntireError', { error: err }),
      };
    }
  }

  /**
   * 格式化差异输出
   */
  private formatDiffOutput(diffPreview: DiffPreview): string {
    const { diff, additions, deletions } = diffPreview;
    let output = '';
    output += `Changes: +${additions} -${deletions}\n`;
    output += '─'.repeat(60) + '\n';
    output += diff;
    output += '─'.repeat(60);
    return output;
  }
}
