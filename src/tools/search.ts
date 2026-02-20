/**
 * 搜索工具
 * Glob 和 Grep
 */

import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { BaseTool } from './base.js';
import type { GlobInput, GrepInput, ToolResult, ToolDefinition } from '../types/index.js';
import { persistLargeOutputSync } from './output-persistence.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { getRgPath } from '../search/ripgrep.js';
import { t } from '../i18n/index.js';
import { fromMsysPath } from '../utils/platform.js';

// 检测当前平台
const isWindows = process.platform === 'win32';

export class GlobTool extends BaseTool<GlobInput, ToolResult> {
  name = 'Glob';
  description = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match files against',
        },
        path: {
          type: 'string',
          description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
        },
      },
      required: ['pattern'],
    };
  }

  async execute(input: GlobInput): Promise<ToolResult> {
    const { pattern, path: inputPath = getCurrentCwd() } = input;
    const searchPath = fromMsysPath(inputPath);

    try {
      const files = await glob(pattern, {
        cwd: searchPath,
        absolute: true,
        nodir: true,
        dot: true,
      });

      // 按修改时间排序
      const sortedFiles = files
        .map(file => ({
          file,
          mtime: fs.existsSync(file) ? fs.statSync(file).mtime.getTime() : 0,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .map(item => item.file);

      if (sortedFiles.length === 0) {
        return { success: true, output: t('search.noFiles') };
      }

      let output = sortedFiles.join('\n');

      // 使用统一的输出持久化（Glob 通常输出不大，但为统一性也使用）
      const persistResult = persistLargeOutputSync(output, {
        toolName: 'Glob',
        maxLength: 30000,
      });

      return { success: true, output: persistResult.content };
    } catch (err) {
      return { success: false, error: t('search.globError', { error: err }) };
    }
  }
}

export class GrepTool extends BaseTool<GrepInput, ToolResult> {
  name = 'Grep';
  description = `A powerful search tool built on ripgrep

Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Task tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`;

  // Directories to exclude from search
  private excludedDirs = ['.git', '.svn', '.hg', '.bzr'];

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regular expression pattern to search for in file contents',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (rg PATH). Defaults to current working directory.',
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
        },
        type: {
          type: 'string',
          description: 'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
        },
        '-i': {
          type: 'boolean',
          description: 'Case insensitive search (rg -i)',
        },
        '-n': {
          type: 'boolean',
          description: 'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
        },
        '-B': {
          type: 'number',
          description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
        },
        '-A': {
          type: 'number',
          description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
        },
        '-C': {
          type: 'number',
          description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
        },
        multiline: {
          type: 'boolean',
          description: 'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
        },
        head_limit: {
          type: 'number',
          description: 'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 0 (unlimited).',
        },
        offset: {
          type: 'number',
          description: 'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
        },
      },
      required: ['pattern'],
    };
  }

  async execute(input: GrepInput): Promise<ToolResult> {
    const {
      pattern,
      path: inputSearchPath = getCurrentCwd(),
      glob: globPattern,
      output_mode = 'files_with_matches',
      '-B': beforeContext,
      '-A': afterContext,
      '-C': context,
      '-n': showLineNumbers = true,
      '-i': ignoreCase,
      type: fileType,
      head_limit,
      offset = 0,
      multiline,
    } = input;
    const searchPath = fromMsysPath(inputSearchPath);

    try {
      // 构建 ripgrep 命令
      const args: string[] = ['--hidden'];

      // 排除特定目录
      for (const dir of this.excludedDirs) {
        args.push('--glob', `!${dir}`);
      }

      // 限制每行最大列数
      args.push('--max-columns', '500');

      // 多行模式
      if (multiline) {
        args.push('-U', '--multiline-dotall');
      }

      // 大小写不敏感
      if (ignoreCase) {
        args.push('-i');
      }

      // 输出模式
      if (output_mode === 'files_with_matches') {
        args.push('-l');
      } else if (output_mode === 'count') {
        args.push('-c');
      }

      // 行号 (仅在 content 模式下)
      if (showLineNumbers && output_mode === 'content') {
        args.push('-n');
      }

      // 上下文行 (仅在 content 模式下)
      if (output_mode === 'content') {
        if (context !== undefined) {
          args.push('-C', String(context));
        } else {
          if (beforeContext !== undefined) {
            args.push('-B', String(beforeContext));
          }
          if (afterContext !== undefined) {
            args.push('-A', String(afterContext));
          }
        }
      }

      // Pattern (如果以 - 开头，需要使用 -e 前缀)
      if (pattern.startsWith('-')) {
        args.push('-e', pattern);
      } else {
        args.push(pattern);
      }

      // 文件类型
      if (fileType) {
        args.push('--type', fileType);
      }

      // Glob 模式 - 需要处理空格和逗号分割
      if (globPattern) {
        const globs: string[] = [];
        const parts = globPattern.split(/\s+/);

        for (const part of parts) {
          if (part.includes('{') && part.includes('}')) {
            // 保留 brace expansion 格式，如 "*.{ts,tsx}"
            globs.push(part);
          } else {
            // 按逗号分割
            globs.push(...part.split(',').filter(Boolean));
          }
        }

        for (const g of globs.filter(Boolean)) {
          args.push('--glob', g);
        }
      }

      // 搜索路径
      args.push(searchPath);

      // v2.1.23: 添加超时配置（默认 600 秒）
      const GREP_TIMEOUT_MS = parseInt(process.env.GREP_TIMEOUT_MS || '600000', 10);

      // 获取 ripgrep 可执行文件路径（vendored 优先，回退到系统 PATH）
      const rgPath = getRgPath();
      if (!rgPath) {
        return {
          success: false,
          error: t('search.rgNotAvailable'),
        };
      }

      let output: string;
      try {
        const result = spawnSync(rgPath, args, {
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'utf-8',
          windowsHide: true,
          timeout: GREP_TIMEOUT_MS,
        });

        // v2.1.23: 检查是否超时（而不是静默返回空结果）
        if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
          return {
            success: false,
            error: t('search.grepTimeout', { seconds: GREP_TIMEOUT_MS / 1000 }),
          };
        }

        // ripgrep 返回码: 0=找到匹配, 1=没有匹配, 2+=错误
        if (result.error) {
          // v2.1.23: 明确报告错误而不是静默失败
          const errorMsg = result.error.message || String(result.error);
          if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timed out')) {
            return {
              success: false,
              error: t('search.grepTimeoutGeneral'),
            };
          }
          throw result.error;
        }

        output = result.stdout || '';
      } catch (err) {
        // 如果 ripgrep 不可用，尝试回退
        throw err;
      }

      let lines = output.split('\n').filter(line => line.length > 0);

      // 对于 files_with_matches 模式，按修改时间排序
      if (output_mode === 'files_with_matches' && lines.length > 0) {
        const filesWithStats = await Promise.all(
          lines.map(async file => {
            try {
              const stats = await fs.promises.stat(file);
              return { file, mtime: stats.mtimeMs };
            } catch {
              return { file, mtime: 0 };
            }
          })
        );

        filesWithStats.sort((a, b) => {
          const mtimeDiff = b.mtime - a.mtime;
          if (mtimeDiff === 0) {
            return a.file.localeCompare(b.file);
          }
          return mtimeDiff;
        });

        lines = filesWithStats.map(item => item.file);
      }

      // 对于 content 模式，将文件路径转换为相对路径
      if (output_mode === 'content') {
        lines = lines.map(line => {
          // Windows drive letter 修复：跳过 "X:\" 中的冒号
          // ripgrep 输出格式: filepath:linenum:content
          // Windows 上: F:\path\file.ts:42:content
          const colonIndex = /^[A-Za-z]:[\\/]/.test(line)
            ? line.indexOf(':', 2)
            : line.indexOf(':');
          if (colonIndex > 0) {
            const filePath = line.substring(0, colonIndex);
            const rest = line.substring(colonIndex);
            const relativePath = this.toRelativePath(filePath);
            return relativePath + rest;
          }
          return line;
        });
      }

      // 对于 count 模式，也转换文件路径
      if (output_mode === 'count') {
        lines = lines.map(line => {
          const colonIndex = line.lastIndexOf(':');
          if (colonIndex > 0) {
            const filePath = line.substring(0, colonIndex);
            const rest = line.substring(colonIndex);
            const relativePath = this.toRelativePath(filePath);
            return relativePath + rest;
          }
          return line;
        });
      }

      // 对于 files_with_matches 模式，转换为相对路径
      if (output_mode === 'files_with_matches') {
        lines = lines.map(file => this.toRelativePath(file));
      }

      // 应用 offset 和 head_limit
      lines = this.applyOffsetAndLimit(lines, head_limit, offset);

      // 根据 output_mode 格式化输出
      let finalOutput: string;

      if (output_mode === 'content') {
        // Content 模式：显示匹配行
        const content = lines.join('\n') || t('search.noMatches');
        const pagination = this.formatPagination(
          head_limit,
          offset > 0 ? offset : undefined
        );
        finalOutput = pagination
          ? `${content}\n\n[Showing results with pagination = ${pagination}]`
          : content;
      } else if (output_mode === 'count') {
        // Count 模式：显示计数 + 统计信息
        const content = lines.join('\n');

        // 计算总匹配数和文件数
        let totalMatches = 0;
        let numFiles = 0;
        for (const line of lines) {
          const colonIndex = line.lastIndexOf(':');
          if (colonIndex > 0) {
            const countStr = line.substring(colonIndex + 1);
            const count = parseInt(countStr, 10);
            if (!isNaN(count)) {
              totalMatches += count;
              numFiles += 1;
            }
          }
        }

        const pagination = this.formatPagination(
          head_limit,
          offset > 0 ? offset : undefined
        );
        const summary = `\n\nFound ${totalMatches} total ${totalMatches === 1 ? 'occurrence' : 'occurrences'} across ${numFiles} ${numFiles === 1 ? 'file' : 'files'}.${pagination ? ` with pagination = ${pagination}` : ''}`;
        finalOutput = (content || t('search.noMatches')) + summary;
      } else {
        // Files_with_matches 模式：显示文件列表 + 统计
        if (lines.length === 0) {
          return { success: true, output: t('search.noFiles') };
        }

        // 遵循官方逻辑：只有 offset > 0 时才传入 offset，否则传入 undefined
        const pagination = this.formatPagination(
          head_limit,
          offset > 0 ? offset : undefined
        );
        const header = `Found ${lines.length} file${lines.length === 1 ? '' : 's'}${pagination ? ` ${pagination}` : ''}`;
        finalOutput = `${header}\n${lines.join('\n')}`;
      }

      // 截断超长输出
      finalOutput = this.truncateOutput(finalOutput);

      return { success: true, output: finalOutput };
    } catch (err) {
      // 如果 rg 不可用，回退到 grep
      return this.fallbackGrep(input);
    }
  }

  /**
   * 将绝对路径转换为相对路径
   * 如果相对路径以 ".." 开头，则返回绝对路径
   */
  private toRelativePath(absolutePath: string): string {
    const cwd = getCurrentCwd();
    const relativePath = path.relative(cwd, absolutePath);
    return relativePath.startsWith('..') ? absolutePath : relativePath;
  }

  /**
   * 应用 offset 和 head_limit
   */
  private applyOffsetAndLimit(lines: string[], limit?: number, offset: number = 0): string[] {
    if (limit === undefined) {
      return lines.slice(offset);
    }
    return lines.slice(offset, offset + limit);
  }

  /**
   * 格式化 pagination 信息
   */
  private formatPagination(limit?: number, offset?: number): string {
    if (!limit && !offset) return '';
    return `limit: ${limit}, offset: ${offset ?? 0}`;
  }

  /**
   * 截断超长输出 (官方限制: 20000 字符)
   * 使用统一的输出持久化机制
   */
  private truncateOutput(text: string): string {
    const MAX_LENGTH = 20000;

    // 使用统一的输出持久化
    const persistResult = persistLargeOutputSync(text, {
      toolName: 'Grep',
      maxLength: MAX_LENGTH,
    });

    return persistResult.content;
  }

  private fallbackGrep(input: GrepInput): ToolResult {
    // Windows 上没有 grep 命令，直接报错
    if (isWindows) {
      return {
        success: false,
        error: t('search.rgNotAvailableWindows'),
      };
    }

    const {
      pattern,
      path: fallbackInputPath = getCurrentCwd(),
      '-i': ignoreCase,
      head_limit,
      offset = 0,
    } = input;
    const searchPath = fromMsysPath(fallbackInputPath);

    try {
      const flags = ignoreCase ? '-rni' : '-rn';
      const cmd = `grep ${flags} '${pattern.replace(/'/g, "'\\''")}' '${searchPath.replace(/'/g, "'\\''")}' 2>/dev/null || true`;
      let output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

      let lines = output.split('\n').filter(line => line.length > 0);

      // 转换文件路径为相对路径
      lines = lines.map(line => {
        // Windows drive letter 修复：跳过 "X:\" 中的冒号
        const colonIndex = /^[A-Za-z]:[\\/]/.test(line)
          ? line.indexOf(':', 2)
          : line.indexOf(':');
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex);
          const rest = line.substring(colonIndex);
          const relativePath = this.toRelativePath(filePath);
          return relativePath + rest;
        }
        return line;
      });

      // 应用 offset 和 head_limit
      lines = this.applyOffsetAndLimit(lines, head_limit, offset);

      const result = lines.join('\n');
      return { success: true, output: result || t('search.noMatches') };
    } catch (err) {
      return { success: false, error: t('search.grepError', { error: err }) };
    }
  }
}
