/**
 * LSP Tool - Language Server Protocol 工具
 * 提供代码智能功能：定义跳转、引用查找、悬停信息等
 */

import { BaseTool } from './base.js';
import { z } from 'zod';
import { getLSPManager } from '../lsp/manager.js';
import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { getCurrentCwd } from '../core/cwd-context.js';
import { t } from '../i18n/index.js';

/**
 * LSP 操作类型
 */
const LSPOperation = z.enum([
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
]);

/**
 * LSP 工具输入
 */
const LSPInput = z.object({
  operation: LSPOperation.describe('The LSP operation to perform'),
  filePath: z.string().describe('The absolute or relative path to the file'),
  line: z.number().int().positive().describe('The line number (1-based, as shown in editors)'),
  character: z.number().int().positive().describe('The character offset (1-based, as shown in editors)'),
});

/**
 * LSP 工具输出 (扩展 ToolResult)
 */
const LSPOutput = z.object({
  success: z.boolean().describe('Whether the operation was successful'),
  output: z.string().optional().describe('Formatted output'),
  error: z.string().optional().describe('Error message if failed'),
  operation: LSPOperation.optional().describe('The LSP operation that was performed'),
  result: z.string().optional().describe('The formatted result of the LSP operation'),
  filePath: z.string().optional().describe('The file path the operation was performed on'),
  resultCount: z.number().int().nonnegative().optional().describe('Number of results'),
  fileCount: z.number().int().nonnegative().optional().describe('Number of files containing results'),
});

type LSPInputType = z.infer<typeof LSPInput>;
type LSPOutputType = z.infer<typeof LSPOutput> & import('../types/index.js').ToolResult;

/**
 * 规范化的位置对象
 */
interface NormalizedLocation {
  uri: string;
  range: {
    start: {
      line: number;
      character: number;
    };
    end?: {
      line: number;
      character: number;
    };
  };
}

/**
 * LSP 工具
 */
export class LSPTool extends BaseTool<LSPInputType, LSPOutputType> {
  name = 'LSP';
  description = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:
- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.`;

  inputSchema = LSPInput;
  outputSchema = LSPOutput;

  /**
   * 获取输入 Schema
   */
  getInputSchema() {
    return {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string' as const,
          enum: [
            'goToDefinition',
            'findReferences',
            'hover',
            'documentSymbol',
            'workspaceSymbol',
            'goToImplementation',
            'prepareCallHierarchy',
            'incomingCalls',
            'outgoingCalls',
          ],
          description: 'The LSP operation to perform',
        },
        filePath: {
          type: 'string' as const,
          description: 'The absolute or relative path to the file',
        },
        line: {
          type: 'number' as const,
          description: 'The line number (1-based, as shown in editors)',
        },
        character: {
          type: 'number' as const,
          description: 'The character offset (1-based, as shown in editors)',
        },
      },
      required: ['operation', 'filePath', 'line', 'character'],
    };
  }

  /**
   * 将工具输入转换为 LSP 协议请求
   */
  private buildLSPRequest(input: LSPInputType, filePath: string): { method: string; params: any } {
    const uri = pathToFileURL(filePath).href;
    const position = {
      line: input.line - 1,  // 转换为 0-based
      character: input.character - 1,
    };

    switch (input.operation) {
      case 'goToDefinition':
        return {
          method: 'textDocument/definition',
          params: {
            textDocument: { uri },
            position,
          },
        };

      case 'findReferences':
        return {
          method: 'textDocument/references',
          params: {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
          },
        };

      case 'hover':
        return {
          method: 'textDocument/hover',
          params: {
            textDocument: { uri },
            position,
          },
        };

      case 'documentSymbol':
        return {
          method: 'textDocument/documentSymbol',
          params: {
            textDocument: { uri },
          },
        };

      case 'workspaceSymbol':
        return {
          method: 'workspace/symbol',
          params: { query: '' },
        };

      case 'goToImplementation':
        return {
          method: 'textDocument/implementation',
          params: {
            textDocument: { uri },
            position,
          },
        };

      case 'prepareCallHierarchy':
        return {
          method: 'textDocument/prepareCallHierarchy',
          params: {
            textDocument: { uri },
            position,
          },
        };

      case 'incomingCalls':
        return {
          method: 'textDocument/prepareCallHierarchy',
          params: {
            textDocument: { uri },
            position,
          },
        };

      case 'outgoingCalls':
        return {
          method: 'textDocument/prepareCallHierarchy',
          params: {
            textDocument: { uri },
            position,
          },
        };
    }
  }

  /**
   * 格式化 LSP 结果
   */
  private formatResult(
    operation: string,
    result: any,
    workingDir: string
  ): { formatted: string; resultCount: number; fileCount: number } {
    switch (operation) {
      case 'goToDefinition':
      case 'goToImplementation':
        return this.formatLocationResult(result, workingDir);

      case 'findReferences':
        return this.formatReferencesResult(result, workingDir);

      case 'hover':
        return this.formatHoverResult(result);

      case 'documentSymbol':
        return this.formatDocumentSymbolResult(result);

      case 'workspaceSymbol':
        return this.formatWorkspaceSymbolResult(result, workingDir);

      case 'prepareCallHierarchy':
        return this.formatCallHierarchyResult(result, workingDir);

      case 'incomingCalls':
      case 'outgoingCalls':
        return this.formatCallsResult(operation, result, workingDir);

      default:
        return {
          formatted: JSON.stringify(result, null, 2),
          resultCount: 0,
          fileCount: 0,
        };
    }
  }

  /**
   * 格式化位置结果（definition/implementation）
   * 与官方实现一致
   */
  private formatLocationResult(result: any, workingDir: string) {
    // 处理 null/undefined 结果
    if (!result) {
      return {
        formatted: 'No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const locations = Array.isArray(result) ? result : [result];

    // 规范化位置（处理 LocationLink 类型）
    const normalizedLocations = locations.map((loc) => this.normalizeLocation(loc));

    // 过滤无效位置并记录警告
    const invalidLocations = normalizedLocations.filter((loc) => !loc || !loc.uri);
    if (invalidLocations.length > 0) {
      console.warn(
        `formatGoToDefinitionResult: Filtering out ${invalidLocations.length} invalid location(s) - this should have been caught earlier`
      );
    }

    const validLocations = normalizedLocations.filter((loc) => loc && loc.uri);

    if (validLocations.length === 0) {
      return {
        formatted: 'No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    // 单个结果
    if (validLocations.length === 1) {
      const locationStr = this.formatLocationString(validLocations[0], workingDir);
      return {
        formatted: `Defined in ${locationStr}`,
        resultCount: 1,
        fileCount: 1,
      };
    }

    // 多个结果
    const locationStrings = validLocations.map((loc) => `  ${this.formatLocationString(loc, workingDir)}`);
    const fileCount = this.countUniqueFiles(validLocations);

    return {
      formatted: `Found ${validLocations.length} definitions:\n${locationStrings.join('\n')}`,
      resultCount: validLocations.length,
      fileCount,
    };
  }

  /**
   * 计算唯一文件数量
   */
  private countUniqueFiles(locations: NormalizedLocation[]): number {
    return new Set(locations.map((loc) => loc.uri)).size;
  }

  /**
   * 格式化引用结果
   * 与官方实现一致
   */
  private formatReferencesResult(result: any, workingDir: string) {
    if (!result || result.length === 0) {
      return {
        formatted: 'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const references = result;

    // 过滤无效引用并记录警告
    const invalidRefs = references.filter((loc: any) => !loc || !loc.uri);
    if (invalidRefs.length > 0) {
      console.warn(
        `formatFindReferencesResult: Filtering out ${invalidRefs.length} invalid location(s) - this should have been caught earlier`
      );
    }

    const validReferences = references.filter((loc: any) => loc && loc.uri);

    if (validReferences.length === 0) {
      return {
        formatted: 'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    // 单个引用
    if (validReferences.length === 1) {
      const ref = validReferences[0];
      const locationStr = this.formatLocationString(ref, workingDir);
      return {
        formatted: `Found 1 reference:\n  ${locationStr}`,
        resultCount: 1,
        fileCount: 1,
      };
    }

    // 多个引用 - 按文件分组
    const grouped = this.groupByFile(validReferences, workingDir);
    const lines: string[] = [`Found ${validReferences.length} references across ${grouped.size} file${grouped.size === 1 ? '' : 's'}:`];

    for (const [file, refs] of grouped) {
      lines.push(`\n${file}:`);
      for (const ref of refs) {
        const line = ref.range.start.line + 1;
        const char = ref.range.start.character + 1;
        lines.push(`  Line ${line}:${char}`);
      }
    }

    return {
      formatted: lines.join('\n'),
      resultCount: validReferences.length,
      fileCount: grouped.size,
    };
  }

  /**
   * 格式化 hover 结果
   */
  private formatHoverResult(result: any) {
    if (!result) {
      return {
        formatted: 'No hover information available. This may occur if the cursor is not on a symbol, or if the LSP server has not fully indexed the file.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    let content = '';

    if (Array.isArray(result.contents)) {
      content = result.contents
        .map((c: any) => (typeof c === 'string' ? c : c.value))
        .join('\n\n');
    } else if (typeof result.contents === 'string') {
      content = result.contents;
    } else {
      content = result.contents.value;
    }

    if (result.range) {
      const line = result.range.start.line + 1;
      const char = result.range.start.character + 1;
      content = `Hover info at ${line}:${char}:\n\n${content}`;
    }

    return {
      formatted: content,
      resultCount: 1,
      fileCount: 1,
    };
  }

  /**
   * 格式化文档符号结果
   * 与官方实现一致 - 支持嵌套的 DocumentSymbol 和扁平的 SymbolInformation
   */
  private formatDocumentSymbolResult(result: any) {
    const symbols = result || [];

    if (symbols.length === 0) {
      return {
        formatted: 'No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    // 检查是否是 SymbolInformation 格式（有 location 属性）
    const firstSymbol = symbols[0];
    if (firstSymbol && 'location' in firstSymbol) {
      // 使用 workspaceSymbol 的格式化方法
      return this.formatWorkspaceSymbolResult(symbols, getCurrentCwd());
    }

    // DocumentSymbol 格式（有 range 和可能有 children）
    const lines: string[] = ['Document symbols:'];
    for (const symbol of symbols) {
      lines.push(...this.formatDocumentSymbol(symbol, 0));
    }

    const count = this.countSymbols(symbols);

    return {
      formatted: lines.join('\n'),
      resultCount: count,
      fileCount: symbols.length > 0 ? 1 : 0,
    };
  }

  /**
   * 递归格式化单个 DocumentSymbol（带缩进）
   */
  private formatDocumentSymbol(symbol: any, depth: number): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);
    const kind = this.symbolKindToString(symbol.kind);
    let text = `${indent}${symbol.name} (${kind})`;

    if (symbol.detail) {
      text += ` ${symbol.detail}`;
    }

    const line = symbol.range.start.line + 1;
    text += ` - Line ${line}`;

    lines.push(text);

    // 递归处理子符号
    if (symbol.children && symbol.children.length > 0) {
      for (const child of symbol.children) {
        lines.push(...this.formatDocumentSymbol(child, depth + 1));
      }
    }

    return lines;
  }

  /**
   * 格式化工作区符号结果
   */
  private formatWorkspaceSymbolResult(result: any, workingDir: string) {
    if (!result || result.length === 0) {
      return {
        formatted: 'No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    // 验证并过滤符号 - 记录警告但继续处理
    const invalidSymbols = result.filter((s: any) => !s || !s.location || !s.location.uri);
    if (invalidSymbols.length > 0) {
      console.warn(
        `formatWorkspaceSymbolResult: Filtering out ${invalidSymbols.length} invalid symbol(s) - this should have been caught earlier`
      );
    }

    const symbols = result.filter(
      (s: any) => s && s.location && s.location.uri && this.isValidLocation(s.location)
    );

    if (symbols.length === 0) {
      return {
        formatted: 'No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const grouped = this.groupSymbolsByFile(symbols, workingDir);
    const lines = [`Found ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} in workspace:`];

    for (const [file, syms] of grouped) {
      lines.push(`\n${file}:`);
      for (const sym of syms) {
        const kind = this.symbolKindToString(sym.kind);
        const line = sym.location.range.start.line + 1;
        let text = `  ${sym.name} (${kind}) - Line ${line}`;

        if (sym.containerName) {
          text += ` in ${sym.containerName}`;
        }

        lines.push(text);
      }
    }

    return {
      formatted: lines.join('\n'),
      resultCount: symbols.length,
      fileCount: grouped.size,
    };
  }

  /**
   * 格式化调用层次项
   */
  private formatCallHierarchyItem(item: any, workingDir: string): string {
    if (!item.uri) {
      console.warn('formatCallHierarchyItem: CallHierarchyItem has undefined URI');
      return `${item.name} (${this.symbolKindToString(item.kind)}) - <unknown location>`;
    }

    const filePath = this.uriToPath(item.uri, workingDir);
    const kind = this.symbolKindToString(item.kind);
    const line = item.range.start.line + 1;
    let result = `${item.name} (${kind}) - ${filePath}:${line}`;

    if (item.detail) {
      result += ` [${item.detail}]`;
    }

    return result;
  }

  /**
   * 格式化调用层次结果
   */
  private formatCallHierarchyResult(result: any, workingDir: string) {
    if (!result || result.length === 0) {
      return {
        formatted: 'No call hierarchy item found at this position',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const items = result;

    if (items.length === 1) {
      return {
        formatted: `Call hierarchy item: ${this.formatCallHierarchyItem(items[0], workingDir)}`,
        resultCount: 1,
        fileCount: 1,
      };
    }

    const lines = [`Found ${items.length} call hierarchy items:`];
    for (const item of items) {
      lines.push(`  ${this.formatCallHierarchyItem(item, workingDir)}`);
    }

    return {
      formatted: lines.join('\n'),
      resultCount: items.length,
      fileCount: new Set(items.map((i: any) => i.uri).filter(Boolean)).size,
    };
  }

  /**
   * 格式化调用结果
   * 与官方实现一致
   */
  private formatCallsResult(operation: string, result: any, workingDir: string) {
    const isIncoming = operation === 'incomingCalls';
    const callItem = isIncoming ? 'from' : 'to';

    if (!result || result.length === 0) {
      return {
        formatted: isIncoming
          ? 'No incoming calls found (nothing calls this function)'
          : 'No outgoing calls found (this function calls nothing)',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const calls = result;

    // 验证调用数据 - 记录警告并跳过无效项
    const validCalls = [];
    for (const call of calls) {
      const item = call[callItem];
      if (!item) {
        console.warn(
          `format${isIncoming ? 'Incoming' : 'Outgoing'}CallsResult: CallHierarchy${isIncoming ? 'Incoming' : 'Outgoing'}Call has undefined ${callItem} field`
        );
        continue;
      }
      validCalls.push(call);
    }

    if (validCalls.length === 0) {
      return {
        formatted: isIncoming
          ? 'No incoming calls found (nothing calls this function)'
          : 'No outgoing calls found (this function calls nothing)',
        resultCount: 0,
        fileCount: 0,
      };
    }

    const label = isIncoming ? 'incoming call' : 'outgoing call';
    const lines = [`Found ${validCalls.length} ${label}${validCalls.length === 1 ? '' : 's'}:`];

    const grouped = new Map<string, any[]>();

    for (const call of validCalls) {
      const item = call[callItem];
      if (!item) continue;

      const filePath = this.uriToPath(item.uri, workingDir);
      if (!grouped.has(filePath)) {
        grouped.set(filePath, []);
      }
      grouped.get(filePath)!.push(call);
    }

    for (const [file, fileCalls] of grouped) {
      lines.push(`\n${file}:`);
      for (const call of fileCalls) {
        const item = call[callItem];
        if (!item) continue;

        const kind = this.symbolKindToString(item.kind);
        const line = item.range.start.line + 1;
        let text = `  ${item.name} (${kind}) - Line ${line}`;

        // 添加调用位置信息
        if (call.fromRanges && call.fromRanges.length > 0) {
          const ranges = call.fromRanges
            .map((r: any) => `${r.start.line + 1}:${r.start.character + 1}`)
            .join(', ');
          text += ` [${isIncoming ? 'calls at' : 'called from'}: ${ranges}]`;
        }

        lines.push(text);
      }
    }

    // 计算文件数量
    const fileCount = this.countCallFileCount(validCalls, callItem);

    return {
      formatted: lines.join('\n'),
      resultCount: validCalls.length,
      fileCount,
    };
  }

  /**
   * 计算调用结果中的唯一文件数量
   */
  private countCallFileCount(calls: any[], callItem: string): number {
    const uris = calls
      .map((call) => call[callItem]?.uri)
      .filter((uri): uri is string => Boolean(uri));
    return new Set(uris).size;
  }

  /**
   * 辅助方法：URI 转路径（增强版）
   */
  private uriToPath(uri: string, workingDir?: string): string {
    let decoded = uri.replace(/^file:\/\//, '');
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // 使用未解码的路径
      console.warn('Failed to decode URI:', uri);
    }

    // Windows drive letter 修复：file:///C:/path → /C:/path → C:/path
    // file URI 在 Windows 上是 file:///C:/path，去掉 file:// 后剩 /C:/path
    // 需要去掉前导 / 才能得到正确的 Windows 路径
    if (/^\/[A-Za-z]:/.test(decoded)) {
      decoded = decoded.substring(1);
    }

    // 如果提供了工作目录，尝试返回相对路径
    if (workingDir) {
      const relativePath = path.relative(workingDir, decoded);
      return relativePath.startsWith('..') ? decoded : relativePath;
    }

    return decoded;
  }

  /**
   * 辅助方法：验证位置数据
   */
  private isValidLocation(loc: unknown): boolean {
    if (!loc || typeof loc !== 'object') return false;
    if (!('uri' in loc) && !('targetUri' in loc) && !('location' in loc)) {
      return false;
    }
    return true;
  }

  /**
   * 辅助方法：规范化位置对象
   */
  private normalizeLocation(loc: any): NormalizedLocation {
    if ('targetUri' in loc) {
      return {
        uri: loc.targetUri,
        range: loc.targetSelectionRange || loc.targetRange,
      };
    }
    if ('location' in loc) {
      return {
        uri: loc.location.uri,
        range: loc.location.range,
      };
    }
    return {
      uri: loc.uri,
      range: loc.range,
    };
  }

  /**
   * 辅助方法：格式化位置信息（官方格式: "路径:行:列"）
   */
  private formatLocationString(loc: NormalizedLocation, workingDir: string): string {
    const filePath = this.uriToPath(loc.uri, workingDir);
    const line = loc.range.start.line + 1;
    const char = loc.range.start.character + 1;
    return `${filePath}:${line}:${char}`;
  }

  /**
   * 辅助方法：按文件分组
   */
  private groupByFile(locations: any[], workingDir: string): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const loc of locations) {
      const uri = loc.uri || loc.targetUri || loc.location?.uri;
      if (!uri) continue;

      const filePath = this.uriToPath(uri, workingDir);

      if (!grouped.has(filePath)) {
        grouped.set(filePath, []);
      }

      grouped.get(filePath)!.push(loc);
    }

    return grouped;
  }

  /**
   * 辅助方法：按文件分组（规范化位置）
   */
  private groupNormalizedByFile(
    locations: NormalizedLocation[],
    workingDir: string
  ): Map<string, NormalizedLocation[]> {
    const grouped = new Map<string, NormalizedLocation[]>();

    for (const loc of locations) {
      const filePath = this.uriToPath(loc.uri, workingDir);

      if (!grouped.has(filePath)) {
        grouped.set(filePath, []);
      }

      grouped.get(filePath)!.push(loc);
    }

    return grouped;
  }

  /**
   * 辅助方法：按文件分组符号
   */
  private groupSymbolsByFile(symbols: any[], workingDir: string): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const sym of symbols) {
      const filePath = this.uriToPath(sym.location.uri, workingDir);

      if (!grouped.has(filePath)) {
        grouped.set(filePath, []);
      }

      grouped.get(filePath)!.push(sym);
    }

    return grouped;
  }

  /**
   * 辅助方法：递归计算符号数量
   */
  private countSymbols(symbols: any[]): number {
    let count = symbols.length;

    for (const sym of symbols) {
      if (sym.children && sym.children.length > 0) {
        count += this.countSymbols(sym.children);
      }
    }

    return count;
  }

  /**
   * 辅助方法：SymbolKind 转字符串
   */
  private symbolKindToString(kind: number): string {
    const kinds: Record<number, string> = {
      1: 'File',
      2: 'Module',
      3: 'Namespace',
      4: 'Package',
      5: 'Class',
      6: 'Method',
      7: 'Property',
      8: 'Field',
      9: 'Constructor',
      10: 'Enum',
      11: 'Interface',
      12: 'Function',
      13: 'Variable',
      14: 'Constant',
      15: 'String',
      16: 'Number',
      17: 'Boolean',
      18: 'Array',
      19: 'Object',
      20: 'Key',
      21: 'Null',
      22: 'EnumMember',
      23: 'Struct',
      24: 'Event',
      25: 'Operator',
      26: 'TypeParameter',
    };

    return kinds[kind] || 'Unknown';
  }

  /**
   * 执行工具
   */
  async execute(input: LSPInputType): Promise<LSPOutputType> {
    const manager = getLSPManager();

    if (!manager) {
      return {
        success: false,
        error: 'LSP server manager not initialized. This may indicate a startup issue.',
        operation: input.operation,
        filePath: input.filePath,
      };
    }

    const filePath = path.resolve(input.filePath);
    const workingDir = getCurrentCwd();

    // 构建 LSP 请求
    const { method, params } = this.buildLSPRequest(input, filePath);

    try {
      // 如果文件未打开，先打开
      if (!manager.isFileOpen(filePath)) {
        const content = await readFile(filePath, 'utf-8');
        await manager.openFile(filePath, content);
      }

      // 发送请求
      let result = await manager.sendRequest(filePath, method, params);

      if (result === undefined) {
        return {
          success: false,
          error: `No LSP server available for file type: ${path.extname(filePath)}`,
          operation: input.operation,
          filePath: input.filePath,
        };
      }

      // 处理 incoming/outgoing calls 的二次请求
      if (input.operation === 'incomingCalls' || input.operation === 'outgoingCalls') {
        const items = result;

        if (!items || items.length === 0) {
          const formatted = 'No call hierarchy item found at this position';
          return {
            success: true,
            output: formatted,
            operation: input.operation,
            result: formatted,
            filePath: input.filePath,
            resultCount: 0,
            fileCount: 0,
          };
        }

        const secondMethod =
          input.operation === 'incomingCalls'
            ? 'callHierarchy/incomingCalls'
            : 'callHierarchy/outgoingCalls';

        result = await manager.sendRequest(filePath, secondMethod, { item: items[0] });

        if (result === undefined) {
          return {
            success: false,
            error: 'LSP server did not return call hierarchy results',
            operation: input.operation,
            filePath: input.filePath,
          };
        }
      }

      // 格式化结果
      const { formatted, resultCount, fileCount } = this.formatResult(
        input.operation,
        result,
        workingDir
      );

      return {
        success: true,
        output: formatted,
        operation: input.operation,
        result: formatted,
        filePath: input.filePath,
        resultCount,
        fileCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: t('lsp.operationError', { operation: input.operation, error: message }),
        operation: input.operation,
        filePath: input.filePath,
      };
    }
  }

  /**
   * 检查工具是否可用
   */
  isEnabled(): boolean {
    const manager = getLSPManager();
    if (!manager) {
      return false;
    }

    const status = manager.getStatus();
    if (status.status === 'failed') {
      return false;
    }

    const servers = manager.getAllServers();
    if (servers.size === 0) {
      return false;
    }

    // 检查是否至少有一个服务器处于就绪状态
    for (const server of servers.values()) {
      if (server.getState() === 'ready') {
        return true;
      }
    }

    return false;
  }
}
