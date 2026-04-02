import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getLSPManager } from '../lsp/index.js';

const MAX_LSP_FILE_SIZE_BYTES = 10_000_000;

type LSPOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

interface LSPInput {
  operation: LSPOperation;
  filePath: string;
  line: number;
  character: number;
}

const VALID_OPERATIONS: LSPOperation[] = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
];

const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

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

export class LSPTool extends BaseTool<LSPInput, ToolResult> {
  name = 'LSP';
  description = DESCRIPTION;
  shouldDefer = true;
  searchHint = 'code intelligence (definitions, references, symbols, hover)';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: VALID_OPERATIONS,
          description: 'The LSP operation to perform',
        },
        filePath: {
          type: 'string',
          description: 'The absolute or relative path to the file',
        },
        line: {
          type: 'number',
          description: 'The line number (1-based, as shown in editors)',
        },
        character: {
          type: 'number',
          description: 'The character offset (1-based, as shown in editors)',
        },
      },
      required: ['operation', 'filePath', 'line', 'character'],
    };
  }

  async execute(input: LSPInput): Promise<ToolResult> {
    if (!VALID_OPERATIONS.includes(input.operation)) {
      return this.error(`Invalid operation: ${input.operation}. Valid operations: ${VALID_OPERATIONS.join(', ')}`);
    }

    const absolutePath = path.resolve(input.filePath);

    if (!fs.existsSync(absolutePath)) {
      return this.error(`File does not exist: ${input.filePath}`);
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return this.error(`Path is not a file: ${input.filePath}`);
    }

    const manager = getLSPManager();
    if (!manager) {
      return this.error('LSP server manager not initialized. This may indicate a startup issue.');
    }

    const { method, params } = this.getMethodAndParams(input, absolutePath);

    try {
      if (!manager.isFileOpen(absolutePath)) {
        if (stat.size > MAX_LSP_FILE_SIZE_BYTES) {
          return this.error(`File too large for LSP analysis (${Math.ceil(stat.size / 1_000_000)}MB exceeds 10MB limit)`);
        }
        const content = fs.readFileSync(absolutePath, 'utf-8');
        await manager.openFile(absolutePath, content);
      }

      let result = await manager.sendRequest(absolutePath, method, params);

      if (result === undefined) {
        return this.success(`No LSP server available for file type: ${path.extname(absolutePath)}`);
      }

      if (input.operation === 'incomingCalls' || input.operation === 'outgoingCalls') {
        const callItems = result as any[];
        if (!callItems || callItems.length === 0) {
          return this.success('No call hierarchy item found at this position');
        }

        const callMethod = input.operation === 'incomingCalls'
          ? 'callHierarchy/incomingCalls'
          : 'callHierarchy/outgoingCalls';

        result = await manager.sendRequest(absolutePath, callMethod, {
          item: callItems[0],
        });
      }

      const formatted = this.formatResult(input.operation, result);
      return this.success(formatted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`Error performing ${input.operation}: ${message}`);
    }
  }

  private getMethodAndParams(input: LSPInput, absolutePath: string): { method: string; params: unknown } {
    const uri = pathToFileURL(absolutePath).href;
    const position = {
      line: input.line - 1,
      character: input.character - 1,
    };

    switch (input.operation) {
      case 'goToDefinition':
        return { method: 'textDocument/definition', params: { textDocument: { uri }, position } };
      case 'findReferences':
        return { method: 'textDocument/references', params: { textDocument: { uri }, position, context: { includeDeclaration: true } } };
      case 'hover':
        return { method: 'textDocument/hover', params: { textDocument: { uri }, position } };
      case 'documentSymbol':
        return { method: 'textDocument/documentSymbol', params: { textDocument: { uri } } };
      case 'workspaceSymbol':
        return { method: 'workspace/symbol', params: { query: '' } };
      case 'goToImplementation':
        return { method: 'textDocument/implementation', params: { textDocument: { uri }, position } };
      case 'prepareCallHierarchy':
        return { method: 'textDocument/prepareCallHierarchy', params: { textDocument: { uri }, position } };
      case 'incomingCalls':
      case 'outgoingCalls':
        return { method: 'textDocument/prepareCallHierarchy', params: { textDocument: { uri }, position } };
    }
  }

  private formatResult(operation: LSPOperation, result: unknown): string {
    switch (operation) {
      case 'goToDefinition':
      case 'goToImplementation':
        return this.formatLocations(result, operation === 'goToDefinition' ? 'definition' : 'implementation');

      case 'findReferences':
        return this.formatReferences(result as any[] | null);

      case 'hover':
        return this.formatHover(result);

      case 'documentSymbol':
        return this.formatDocumentSymbols(result as any[] | null);

      case 'workspaceSymbol':
        return this.formatWorkspaceSymbols(result as any[] | null);

      case 'prepareCallHierarchy':
        return this.formatCallHierarchyItems(result as any[] | null);

      case 'incomingCalls':
        return this.formatIncomingCalls(result as any[] | null);

      case 'outgoingCalls':
        return this.formatOutgoingCalls(result as any[] | null);
    }
  }

  private formatLocations(result: unknown, kind: string): string {
    const items = Array.isArray(result) ? result : result ? [result] : [];
    const locations = items.map((item: any) => 'targetUri' in item
      ? { uri: item.targetUri, range: item.targetSelectionRange || item.targetRange }
      : item
    ).filter((loc: any) => loc && loc.uri);

    if (locations.length === 0) {
      return `No ${kind} found.`;
    }
    if (locations.length === 1) {
      return `Defined in ${this.formatLocation(locations[0])}`;
    }
    const list = locations.map((loc: any) => `  ${this.formatLocation(loc)}`).join('\n');
    return `Found ${locations.length} ${kind}s:\n${list}`;
  }

  private formatReferences(result: any[] | null): string {
    if (!result || result.length === 0) {
      return 'No references found.';
    }

    const valid = result.filter((loc: any) => loc && loc.uri);
    if (valid.length === 0) return 'No references found.';

    if (valid.length === 1) {
      return `Found 1 reference:\n  ${this.formatLocation(valid[0])}`;
    }

    const byFile = new Map<string, any[]>();
    for (const loc of valid) {
      const fp = this.uriToPath(loc.uri);
      const arr = byFile.get(fp) || [];
      arr.push(loc);
      byFile.set(fp, arr);
    }

    const lines = [`Found ${valid.length} references across ${byFile.size} files:`];
    for (const [fp, locs] of byFile) {
      lines.push(`\n${fp}:`);
      for (const loc of locs) {
        lines.push(`  Line ${loc.range.start.line + 1}:${loc.range.start.character + 1}`);
      }
    }
    return lines.join('\n');
  }

  private formatHover(result: unknown): string {
    if (!result) return 'No hover information available.';

    const hover = result as any;
    let content: string;

    if (Array.isArray(hover.contents)) {
      content = hover.contents.map((item: any) => typeof item === 'string' ? item : item.value).join('\n\n');
    } else if (typeof hover.contents === 'string') {
      content = hover.contents;
    } else if (hover.contents && 'value' in hover.contents) {
      content = hover.contents.value;
    } else {
      content = String(hover.contents);
    }

    if (hover.range) {
      return `Hover info at ${hover.range.start.line + 1}:${hover.range.start.character + 1}:\n\n${content}`;
    }
    return content;
  }

  private formatDocumentSymbols(result: any[] | null): string {
    if (!result || result.length === 0) return 'No symbols found in document.';

    const isSymbolInfo = result[0] && 'location' in result[0];
    if (isSymbolInfo) {
      return this.formatWorkspaceSymbols(result);
    }

    const lines = ['Document symbols:'];
    const formatNode = (sym: any, indent: number) => {
      const prefix = '  '.repeat(indent);
      const kind = this.symbolKindName(sym.kind);
      let line = `${prefix}${sym.name} (${kind})`;
      if (sym.detail) line += ` ${sym.detail}`;
      line += ` - Line ${sym.range.start.line + 1}`;
      lines.push(line);
      if (sym.children) {
        for (const child of sym.children) formatNode(child, indent + 1);
      }
    };
    for (const sym of result) formatNode(sym, 0);
    return lines.join('\n');
  }

  private formatWorkspaceSymbols(result: any[] | null): string {
    if (!result || result.length === 0) return 'No symbols found in workspace.';

    const valid = result.filter((s: any) => s && s.location && s.location.uri);
    if (valid.length === 0) return 'No symbols found in workspace.';

    const byFile = new Map<string, any[]>();
    for (const sym of valid) {
      const fp = this.uriToPath(sym.location.uri);
      const arr = byFile.get(fp) || [];
      arr.push(sym);
      byFile.set(fp, arr);
    }

    const lines = [`Found ${valid.length} symbols in workspace:`];
    for (const [fp, syms] of byFile) {
      lines.push(`\n${fp}:`);
      for (const sym of syms) {
        const kind = this.symbolKindName(sym.kind);
        let line = `  ${sym.name} (${kind}) - Line ${sym.location.range.start.line + 1}`;
        if (sym.containerName) line += ` in ${sym.containerName}`;
        lines.push(line);
      }
    }
    return lines.join('\n');
  }

  private formatCallHierarchyItems(result: any[] | null): string {
    if (!result || result.length === 0) return 'No call hierarchy item found at this position';

    if (result.length === 1) {
      return `Call hierarchy item: ${this.formatCallItem(result[0])}`;
    }
    const lines = [`Found ${result.length} call hierarchy items:`];
    for (const item of result) lines.push(`  ${this.formatCallItem(item)}`);
    return lines.join('\n');
  }

  private formatIncomingCalls(result: any[] | null): string {
    if (!result || result.length === 0) return 'No incoming calls found (nothing calls this function)';

    const lines = [`Found ${result.length} incoming calls:`];
    const byFile = new Map<string, any[]>();
    for (const call of result) {
      if (!call.from) continue;
      const fp = this.uriToPath(call.from.uri);
      const arr = byFile.get(fp) || [];
      arr.push(call);
      byFile.set(fp, arr);
    }

    for (const [fp, calls] of byFile) {
      lines.push(`\n${fp}:`);
      for (const call of calls) {
        if (!call.from) continue;
        const kind = this.symbolKindName(call.from.kind);
        let line = `  ${call.from.name} (${kind}) - Line ${call.from.range.start.line + 1}`;
        if (call.fromRanges && call.fromRanges.length > 0) {
          const sites = call.fromRanges.map((r: any) => `${r.start.line + 1}:${r.start.character + 1}`).join(', ');
          line += ` [calls at: ${sites}]`;
        }
        lines.push(line);
      }
    }
    return lines.join('\n');
  }

  private formatOutgoingCalls(result: any[] | null): string {
    if (!result || result.length === 0) return 'No outgoing calls found (this function calls nothing)';

    const lines = [`Found ${result.length} outgoing calls:`];
    const byFile = new Map<string, any[]>();
    for (const call of result) {
      if (!call.to) continue;
      const fp = this.uriToPath(call.to.uri);
      const arr = byFile.get(fp) || [];
      arr.push(call);
      byFile.set(fp, arr);
    }

    for (const [fp, calls] of byFile) {
      lines.push(`\n${fp}:`);
      for (const call of calls) {
        if (!call.to) continue;
        const kind = this.symbolKindName(call.to.kind);
        let line = `  ${call.to.name} (${kind}) - Line ${call.to.range.start.line + 1}`;
        if (call.fromRanges && call.fromRanges.length > 0) {
          const sites = call.fromRanges.map((r: any) => `${r.start.line + 1}:${r.start.character + 1}`).join(', ');
          line += ` [called from: ${sites}]`;
        }
        lines.push(line);
      }
    }
    return lines.join('\n');
  }

  private formatLocation(loc: any): string {
    return `${this.uriToPath(loc.uri)}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
  }

  private formatCallItem(item: any): string {
    const fp = item.uri ? this.uriToPath(item.uri) : '<unknown>';
    const kind = this.symbolKindName(item.kind);
    let result = `${item.name} (${kind}) - ${fp}:${item.range.start.line + 1}`;
    if (item.detail) result += ` [${item.detail}]`;
    return result;
  }

  private uriToPath(uri: string): string {
    if (!uri) return '<unknown location>';
    let fp = uri.replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:/.test(fp)) fp = fp.slice(1);
    try { fp = decodeURIComponent(fp); } catch {}
    return fp;
  }

  private symbolKindName(kind: number): string {
    const names: Record<number, string> = {
      1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
      6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
      11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
      15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object',
      20: 'Key', 21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
      25: 'Operator', 26: 'TypeParameter',
    };
    return names[kind] || 'Unknown';
  }
}
