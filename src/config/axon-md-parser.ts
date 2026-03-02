/**
 * AXON.md 解析器
 *
 * 解析项目根目录的 AXON.md 文件，并注入到系统提示中
 * 这是官方参考实现的核心特性之一
 *
 * v2.1.2 新增功能:
 * - @include 指令支持：可以引用其他文件的内容
 * - 二进制文件过滤：自动跳过图片、PDF 等二进制文件
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 允许的文本文件扩展名集合 (从官方源码提取)
 * 只有这些扩展名的文件才能被 @include
 */
const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown & 文档
  '.md', '.txt', '.text', '.rst', '.adoc', '.asciidoc', '.org', '.tex', '.latex',
  // 数据格式
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  // Web
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  // JavaScript/TypeScript
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  // Python
  '.py', '.pyi', '.pyw',
  // Ruby
  '.rb', '.erb', '.rake',
  // 系统语言
  '.go', '.rs', '.java', '.kt', '.kts', '.scala',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.cs', '.swift',
  // Shell
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  // 配置
  '.env', '.ini', '.cfg', '.conf', '.config', '.properties',
  // 数据库 & API
  '.sql', '.graphql', '.gql', '.proto',
  // 框架
  '.vue', '.svelte', '.astro', '.ejs', '.hbs', '.pug', '.jade',
  // 其他语言
  '.php', '.pl', '.pm', '.lua', '.r', '.R', '.dart',
  '.ex', '.exs', '.erl', '.hrl', '.clj', '.cljs', '.cljc', '.edn',
  '.hs', '.lhs', '.elm', '.ml', '.mli', '.f', '.f90', '.f95', '.for',
  // 构建
  '.cmake', '.make', '.makefile', '.gradle', '.sbt',
  // 其他
  '.lock', '.log', '.diff', '.patch',
]);

export interface AxonMdInfo {
  content: string;
  path: string;
  exists: boolean;
  lastModified?: Date;
  /** 包含的文件路径 (v2.1.2+) */
  includedPaths?: string[];
  /** 跳过的二进制文件 (v2.1.2+) */
  skippedBinaryFiles?: string[];
  /** 额外目录的 AXON.md 文件 (v2.1.20+) */
  additionalAxonMdPaths?: string[];
}

export class AxonMdParser {
  private axonMdPath: string;
  private workingDir: string;
  private watcher?: fs.FSWatcher;
  private changeCallbacks: Array<(content: string) => void> = [];
  /** 额外目录列表 (v2.1.20+) */
  private additionalDirectories: string[] = [];

  constructor(workingDir?: string, additionalDirectories?: string[]) {
    this.workingDir = workingDir || process.cwd();
    this.axonMdPath = path.join(this.workingDir, 'AXON.md');
    this.additionalDirectories = additionalDirectories || [];
  }

  /**
   * 设置额外目录 (v2.1.20+)
   *
   * 用于从 --add-dir 参数加载额外目录
   * 需要设置 AXON_ADDITIONAL_DIRECTORIES_AXON_MD=1 才能生效
   */
  setAdditionalDirectories(directories: string[]): void {
    this.additionalDirectories = directories;
  }

  /**
   * 检查是否启用额外目录 AXON.md 加载 (v2.1.20+)
   */
  private isAdditionalAxonMdEnabled(): boolean {
    const envValue = process.env.AXON_ADDITIONAL_DIRECTORIES_AXON_MD;
    return envValue === '1' || envValue === 'true';
  }

  /**
   * 从额外目录加载 AXON.md 文件 (v2.1.20+)
   */
  private loadAdditionalAxonMdFiles(): { content: string; paths: string[] } {
    if (!this.isAdditionalAxonMdEnabled() || this.additionalDirectories.length === 0) {
      return { content: '', paths: [] };
    }

    const loadedPaths: string[] = [];
    let combinedContent = '';

    for (const dir of this.additionalDirectories) {
      const axonMdPath = path.join(dir, 'AXON.md');

      if (fs.existsSync(axonMdPath) && fs.statSync(axonMdPath).isFile()) {
        try {
          const content = fs.readFileSync(axonMdPath, 'utf-8');
          if (content.trim()) {
            loadedPaths.push(axonMdPath);
            combinedContent += `\n\n<!-- AXON.md from ${axonMdPath} -->\n${content}`;
          }
        } catch (error) {
          console.warn(`[AXON.md] Failed to read additional file: ${axonMdPath}`, error);
        }
      }
    }

    return { content: combinedContent, paths: loadedPaths };
  }

  /**
   * 检查文件是否为文本文件 (v2.1.2+)
   *
   * 官方实现: 检查扩展名是否在允许列表中
   * 如果不在列表中，则认为是二进制文件并跳过
   */
  private isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    // 没有扩展名的文件默认为文本文件
    if (!ext) return true;
    return TEXT_FILE_EXTENSIONS.has(ext);
  }

  /**
   * 解析 @ 指令，提取文件路径 (v2.1.2+)
   *
   * 支持的格式:
   * - @./relative/path.md (相对路径)
   * - @~/home/path.md (home 目录)
   * - @/absolute/path.md (绝对路径)
   *
   * 官方实现使用 marked 解析器来避免在代码块中匹配
   */
  private extractIncludePaths(content: string): string[] {
    const paths: string[] = [];

    // 分离代码块，避免在代码块中匹配
    const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
    const codeBlocks: { start: number; end: number }[] = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      codeBlocks.push({ start: match.index, end: match.index + match[0].length });
    }

    // 匹配 @ 路径指令
    // 官方正则: /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/gm;

    while ((match = includeRegex.exec(content)) !== null) {
      const matchPos = match.index;

      // 检查是否在代码块中
      const inCodeBlock = codeBlocks.some(
        block => matchPos >= block.start && matchPos < block.end
      );
      if (inCodeBlock) continue;

      let filePath = match[1];
      if (!filePath) continue;

      // 处理转义空格
      filePath = filePath.replace(/\\ /g, ' ');

      // 只处理路径格式的引用
      if (
        filePath.startsWith('./') ||
        filePath.startsWith('~/') ||
        (filePath.startsWith('/') && filePath !== '/')
      ) {
        paths.push(filePath);
      }
    }

    return paths;
  }

  /**
   * 解析文件路径为绝对路径 (v2.1.2+)
   */
  private resolveIncludePath(includePath: string): string {
    if (includePath.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(homeDir, includePath.slice(2));
    }
    if (includePath.startsWith('/')) {
      return includePath;
    }
    // 相对路径，相对于 AXON.md 所在目录
    return path.resolve(this.workingDir, includePath);
  }

  /**
   * 读取并包含文件内容 (v2.1.2+)
   *
   * 官方实现: 如果文件不是文本文件，则跳过并打印警告
   */
  private readIncludeFile(includePath: string): { content: string | null; skipped: boolean } {
    const fullPath = this.resolveIncludePath(includePath);

    // 检查文件是否存在
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      console.warn(`[AXON.md] Include file not found: ${includePath}`);
      return { content: null, skipped: false };
    }

    // 检查是否为文本文件 (官方二进制文件过滤)
    if (!this.isTextFile(fullPath)) {
      console.warn(`[AXON.md] Skipping non-text file in @include: ${includePath}`);
      return { content: null, skipped: true };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { content, skipped: false };
    } catch (error) {
      console.warn(`[AXON.md] Failed to read include file: ${includePath}`, error);
      return { content: null, skipped: false };
    }
  }

  /**
   * 处理 @include 指令 (v2.1.2+)
   *
   * 递归处理包含的文件，防止循环引用
   */
  private processIncludes(
    content: string,
    processedPaths: Set<string> = new Set(),
    includedPaths: string[] = [],
    skippedBinaryFiles: string[] = []
  ): { content: string; includedPaths: string[]; skippedBinaryFiles: string[] } {
    const paths = this.extractIncludePaths(content);

    for (const includePath of paths) {
      const fullPath = this.resolveIncludePath(includePath);

      // 防止循环引用
      if (processedPaths.has(fullPath)) {
        console.warn(`[AXON.md] Circular include detected, skipping: ${includePath}`);
        continue;
      }

      processedPaths.add(fullPath);

      const { content: fileContent, skipped } = this.readIncludeFile(includePath);

      if (skipped) {
        skippedBinaryFiles.push(includePath);
        continue;
      }

      if (fileContent !== null) {
        includedPaths.push(includePath);

        // 递归处理包含文件中的 @include
        const nested = this.processIncludes(
          fileContent,
          processedPaths,
          includedPaths,
          skippedBinaryFiles
        );

        // 将文件内容追加到原内容后面（官方行为）
        content = content + '\n\n' + `<!-- Included from ${includePath} -->\n` + nested.content;
      }
    }

    return { content, includedPaths, skippedBinaryFiles };
  }

  /**
   * 解析 AXON.md 文件
   *
   * v2.1.2+: 支持 @include 指令和二进制文件过滤
   */
  parse(): AxonMdInfo {
    // v2.1.20+: 加载额外目录的 AXON.md 文件
    const { content: additionalContent, paths: additionalPaths } = this.loadAdditionalAxonMdFiles();

    if (!fs.existsSync(this.axonMdPath)) {
      // 即使主目录没有 AXON.md，也可能有额外目录的
      if (additionalContent) {
        return {
          content: additionalContent,
          path: this.axonMdPath,
          exists: false,
          additionalAxonMdPaths: additionalPaths.length > 0 ? additionalPaths : undefined,
        };
      }
      return {
        content: '',
        path: this.axonMdPath,
        exists: false,
      };
    }

    try {
      let content = fs.readFileSync(this.axonMdPath, 'utf-8');
      const stats = fs.statSync(this.axonMdPath);

      // v2.1.2+: 处理 @include 指令
      const { content: processedContent, includedPaths, skippedBinaryFiles } =
        this.processIncludes(content);

      // v2.1.20+: 合并额外目录的 AXON.md 内容
      const finalContent = additionalContent
        ? processedContent + additionalContent
        : processedContent;

      return {
        content: finalContent,
        path: this.axonMdPath,
        exists: true,
        lastModified: stats.mtime,
        includedPaths: includedPaths.length > 0 ? includedPaths : undefined,
        skippedBinaryFiles: skippedBinaryFiles.length > 0 ? skippedBinaryFiles : undefined,
        additionalAxonMdPaths: additionalPaths.length > 0 ? additionalPaths : undefined,
      };
    } catch (error) {
      console.warn(`Failed to read AXON.md: ${error}`);
      return {
        content: additionalContent || '',
        path: this.axonMdPath,
        exists: false,
        additionalAxonMdPaths: additionalPaths.length > 0 ? additionalPaths : undefined,
      };
    }
  }

  /**
   * 注入到系统提示
   *
   * 这是核心功能：将 AXON.md 的内容添加到系统提示中
   */
  injectIntoSystemPrompt(basePrompt: string): string {
    const info = this.parse();

    if (!info.exists || !info.content.trim()) {
      return basePrompt;
    }

    // 按照官方格式注入
    return `${basePrompt}

# axonMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of ${this.axonMdPath} (project instructions, checked into the codebase):

${info.content}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.`;
  }

  /**
   * 获取 AXON.md 内容（简化版）
   */
  getContent(): string | null {
    const info = this.parse();
    return info.exists ? info.content : null;
  }

  /**
   * 检查 AXON.md 是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.axonMdPath);
  }

  /**
   * 监听 AXON.md 变化
   */
  watch(callback: (content: string) => void): void {
    if (!this.exists()) {
      console.warn(`AXON.md does not exist, cannot watch: ${this.axonMdPath}`);
      return;
    }

    this.changeCallbacks.push(callback);

    if (!this.watcher) {
      this.watcher = fs.watch(this.axonMdPath, (eventType) => {
        if (eventType === 'change') {
          const content = this.getContent();
          if (content) {
            this.changeCallbacks.forEach(cb => cb(content));
          }
        }
      });
    }
  }

  /**
   * 停止监听
   */
  unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.changeCallbacks = [];
  }

  /**
   * 创建默认的 AXON.md 模板
   */
  static createTemplate(projectName: string, projectType?: string): string {
    return `# AXON.md

This file provides guidance to Axon (claude.ai/code) when working with code in this repository.

## Project Overview

${projectName} is a ${projectType || 'software'} project.

## Development Guidelines

### Code Style

- Follow consistent formatting
- Write clear, descriptive comments
- Use meaningful variable names

### Testing

- Write tests for new features
- Ensure all tests pass before committing
- Maintain test coverage above 80%

### Git Workflow

- Use feature branches
- Write clear commit messages
- Keep commits atomic and focused

## Important Notes

- Add project-specific guidelines here
- Document any special requirements
- Include build/deployment instructions if needed
`;
  }

  /**
   * 在项目中创建 AXON.md
   */
  create(content?: string): boolean {
    if (this.exists()) {
      console.warn('AXON.md already exists');
      return false;
    }

    const projectName = path.basename(process.cwd());
    const template = content || AxonMdParser.createTemplate(projectName);

    try {
      fs.writeFileSync(this.axonMdPath, template, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Failed to create AXON.md: ${error}`);
      return false;
    }
  }

  /**
   * 更新 AXON.md
   */
  update(content: string): boolean {
    try {
      fs.writeFileSync(this.axonMdPath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Failed to update AXON.md: ${error}`);
      return false;
    }
  }

  /**
   * 验证 AXON.md 格式
   *
   * 检查是否包含基本结构
   */
  validate(): { valid: boolean; warnings: string[] } {
    const info = this.parse();
    const warnings: string[] = [];

    if (!info.exists) {
      return { valid: false, warnings: ['AXON.md file does not exist'] };
    }

    if (!info.content.trim()) {
      warnings.push('AXON.md file is empty');
    }

    // 检查是否包含标题
    if (!info.content.includes('#')) {
      warnings.push('Recommend using Markdown headings to organize content');
    }

    // 检查文件大小（过大可能影响性能）
    if (info.content.length > 50000) {
      warnings.push('AXON.md file is too large (>50KB), may impact performance');
    }

    return { valid: true, warnings };
  }

  /**
   * 获取 AXON.md 的统计信息
   */
  getStats(): { lines: number; chars: number; size: number } | null {
    const info = this.parse();

    if (!info.exists) return null;

    const lines = info.content.split('\n').length;
    const chars = info.content.length;
    const size = fs.statSync(this.axonMdPath).size;

    return { lines, chars, size };
  }
}

/**
 * 全局 AXON.md 解析器实例
 */
export const axonMdParser = new AxonMdParser();

// ============ 导出辅助函数 (v2.1.2+) ============

/**
 * 检查文件是否为文本文件
 *
 * 用于 @include 指令的二进制文件过滤
 */
export function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return true;
  return TEXT_FILE_EXTENSIONS.has(ext);
}

/**
 * 检查文件是否为二进制文件
 *
 * 与 isTextFile 相反
 */
export function isBinaryFile(filePath: string): boolean {
  return !isTextFile(filePath);
}

/**
 * 获取所有允许的文本文件扩展名
 */
export function getTextFileExtensions(): string[] {
  return Array.from(TEXT_FILE_EXTENSIONS);
}

/**
 * 检查文件内容是否包含二进制数据
 *
 * 通过检查 NULL 字节来判断
 * 这是官方实现的备用检测方法
 */
export function hasBinaryContent(buffer: Buffer): boolean {
  // 只检查前 8000 字节
  const checkLength = Math.min(buffer.length, 8000);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}
