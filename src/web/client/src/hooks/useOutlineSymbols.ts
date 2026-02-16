/**
 * useOutlineSymbols Hook
 * 客户端正则解析，从文件内容提取符号树，用于 Outline 面板
 */

import { useMemo } from 'react';

// ============================================================================
// 类型定义
// ============================================================================

export type OutlineSymbolKind =
  | 'import'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'property'
  | 'constant'
  | 'component'
  | 'variable';

export interface OutlineSymbol {
  name: string;
  kind: OutlineSymbolKind;
  line: number;           // 1-based
  endLine?: number;       // 1-based
  children?: OutlineSymbol[];
  exported?: boolean;
  detail?: string;        // e.g. "extends BaseTool", "React.FC<Props>"
}

export interface UseOutlineSymbolsOptions {
  content: string;
  language: string;
  filePath: string | null;
}

export interface UseOutlineSymbolsReturn {
  symbols: OutlineSymbol[];
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从指定行开始，使用大括号计数找到闭合行
 */
function findClosingBraceLine(lines: string[], startLineIndex: number): number {
  let braceCount = 0;
  let started = false;

  for (let i = startLineIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceCount++; started = true; }
      if (ch === '}') braceCount--;
    }
    if (started && braceCount <= 0) {
      return i + 1; // 转为 1-based
    }
  }

  return lines.length;
}

/**
 * 提取类/接口内部的方法和属性
 */
function extractClassMembers(
  lines: string[],
  startLineIndex: number,
  endLineIndex: number,
  parentKind: 'class' | 'interface'
): OutlineSymbol[] {
  const members: OutlineSymbol[] = [];
  let braceDepth = 0;
  let started = false;

  for (let i = startLineIndex; i < endLineIndex; i++) {
    const line = lines[i];

    // 跟踪大括号深度
    for (const ch of line) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') braceDepth--;
    }

    // 只解析第一层深度的成员（depth=1 表示类体内部顶层）
    if (!started || braceDepth < 1) continue;
    if (braceDepth > 1) continue; // 跳过嵌套块内部

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    if (parentKind === 'class') {
      // 类方法: [修饰符] [static] [async] name(
      const methodMatch = trimmed.match(
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/
      );
      if (methodMatch && methodMatch[1] !== 'constructor') {
        members.push({
          name: methodMatch[1],
          kind: 'method',
          line: i + 1,
        });
        continue;
      }

      // constructor
      if (trimmed.match(/^(?:public|private|protected)?\s*constructor\s*\(/)) {
        members.push({
          name: 'constructor',
          kind: 'method',
          line: i + 1,
        });
        continue;
      }

      // 类属性: [修饰符] [static] [readonly] name[?]: 或 name =
      const propMatch = trimmed.match(
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?(\w+)\s*[?!]?\s*[:=]/
      );
      if (propMatch && !trimmed.includes('(')) {
        members.push({
          name: propMatch[1],
          kind: 'property',
          line: i + 1,
        });
        continue;
      }
    }

    if (parentKind === 'interface') {
      // 接口方法签名: name(
      const methodSigMatch = trimmed.match(/^(\w+)\s*(?:<[^>]*>)?\s*\(/);
      if (methodSigMatch) {
        members.push({
          name: methodSigMatch[1],
          kind: 'method',
          line: i + 1,
        });
        continue;
      }

      // 接口属性签名: name[?]:
      const propSigMatch = trimmed.match(/^(\w+)\s*[?]?\s*:/);
      if (propSigMatch) {
        members.push({
          name: propSigMatch[1],
          kind: 'property',
          line: i + 1,
        });
        continue;
      }
    }
  }

  return members;
}

/**
 * 解析 TypeScript/JavaScript 文件的符号
 */
function parseTypeScriptSymbols(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const lines = content.split('\n');

  // 记录已匹配的行号，避免重复
  const matchedLines = new Set<number>();

  // 1. 解析 import 块
  let importStartLine = 0;
  let importEndLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ') || (importStartLine > 0 && (trimmed.startsWith('} from') || trimmed === ''))) {
      if (importStartLine === 0) importStartLine = i + 1;
      if (trimmed.startsWith('import ')) importEndLine = i + 1;
    } else if (importStartLine > 0 && trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      break;
    }
  }
  if (importStartLine > 0 && importEndLine > 0) {
    symbols.push({
      name: 'Imports',
      kind: 'import',
      line: importStartLine,
      endLine: importEndLine,
    });
    for (let i = importStartLine; i <= importEndLine; i++) matchedLines.add(i);
  }

  // 2. 解析 interface
  const interfaceRegex = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w\s,<>]+))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const startIdx = lineNum - 1;
    const endLine = findClosingBraceLine(lines, startIdx);
    const children = extractClassMembers(lines, startIdx, endLine - 1, 'interface');
    const isExported = match[0].startsWith('export');
    const extendsInfo = match[2] ? match[2].trim() : undefined;

    symbols.push({
      name: match[1],
      kind: 'interface',
      line: lineNum,
      endLine,
      children: children.length > 0 ? children : undefined,
      exported: isExported,
      detail: extendsInfo ? `extends ${extendsInfo}` : undefined,
    });
    matchedLines.add(lineNum);
  }

  // 3. 解析 type alias
  const typeRegex = /(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/g;
  while ((match = typeRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    symbols.push({
      name: match[1],
      kind: 'type',
      line: lineNum,
      exported: match[0].startsWith('export'),
    });
    matchedLines.add(lineNum);
  }

  // 4. 解析 enum
  const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g;
  while ((match = enumRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const endLine = findClosingBraceLine(lines, lineNum - 1);
    symbols.push({
      name: match[1],
      kind: 'enum',
      line: lineNum,
      endLine,
      exported: match[0].startsWith('export'),
    });
    matchedLines.add(lineNum);
  }

  // 5. 解析 class
  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?\s*\{/g;
  while ((match = classRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const startIdx = lineNum - 1;
    const endLine = findClosingBraceLine(lines, startIdx);
    const children = extractClassMembers(lines, startIdx, endLine - 1, 'class');
    const isExported = match[0].startsWith('export');

    const details: string[] = [];
    if (match[2]) details.push(`extends ${match[2]}`);
    if (match[3]) details.push(`implements ${match[3].trim()}`);

    symbols.push({
      name: match[1],
      kind: 'class',
      line: lineNum,
      endLine,
      children: children.length > 0 ? children : undefined,
      exported: isExported,
      detail: details.length > 0 ? details.join(', ') : undefined,
    });
    matchedLines.add(lineNum);
  }

  // 6. 解析 function 声明
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const endLine = findClosingBraceLine(lines, lineNum - 1);
    symbols.push({
      name: match[1],
      kind: 'function',
      line: lineNum,
      endLine,
      exported: match[0].startsWith('export'),
    });
    matchedLines.add(lineNum);
  }

  // 7. 解析 const 箭头函数 / React 组件
  const constFuncRegex = /(?:export\s+)?const\s+(\w+)(?:\s*:\s*(React\.FC|React\.ForwardRefRenderFunction)(?:<[^>]*>)?)?\s*=\s*(?:(?:React\.)?(?:memo|forwardRef)\s*\()?\s*(?:\([^)]*\)|[^=])\s*=>/g;
  while ((match = constFuncRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const isComponent = !!match[2] || /^[A-Z]/.test(match[1]);
    const endLine = findClosingBraceLine(lines, lineNum - 1);

    symbols.push({
      name: match[1],
      kind: isComponent ? 'component' : 'function',
      line: lineNum,
      endLine,
      exported: match[0].startsWith('export'),
      detail: match[2] || undefined,
    });
    matchedLines.add(lineNum);
  }

  // 8. 解析 const function 表达式
  const constFuncExprRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*function/g;
  while ((match = constFuncExprRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (matchedLines.has(lineNum)) continue;

    const endLine = findClosingBraceLine(lines, lineNum - 1);
    symbols.push({
      name: match[1],
      kind: 'function',
      line: lineNum,
      endLine,
      exported: match[0].startsWith('export'),
    });
    matchedLines.add(lineNum);
  }

  // 按行号排序
  symbols.sort((a, b) => a.line - b.line);

  return symbols;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useOutlineSymbols(options: UseOutlineSymbolsOptions): UseOutlineSymbolsReturn {
  const { content, language } = options;

  const symbols = useMemo(() => {
    if (!content) return [];

    // 目前只支持 TypeScript/JavaScript
    const tsLangs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'tsx', 'jsx', 'ts', 'js'];
    if (tsLangs.includes(language)) {
      return parseTypeScriptSymbols(content);
    }

    return [];
  }, [content, language]);

  return { symbols };
}
