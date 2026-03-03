/**
 * 数据流分析器
 *
 * 追踪属性和变量的读取和写入位置
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface LocationInfo {
  file: string;
  line: number;
  column: number;
  code: string; // 代码片段
}

export interface DataFlowResult {
  symbolId: string;
  symbolName: string;
  reads: LocationInfo[]; // 读取位置
  writes: LocationInfo[]; // 写入位置
  dataFlowGraph?: {
    // 数据流图
    nodes: Array<{ id: string; label: string; type: 'read' | 'write' }>;
    edges: Array<{ source: string; target: string }>;
  };
}

export class DataFlowAnalyzer {
  private checker: ts.TypeChecker | null = null;

  /**
   * 分析符号的数据流
   */
  async analyzeDataFlow(symbolId: string): Promise<DataFlowResult> {
    // 解析符号 ID
    const parts = symbolId.split('::');
    const filePath = parts[0];
    const className = parts.length === 3 ? parts[1] : undefined;
    const symbolName = parts[parts.length - 1];

    // 创建 TypeScript 程序
    const program = ts.createProgram([filePath], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    });
    this.checker = program.getTypeChecker();

    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Cannot read file: ${filePath}`);
    }

    const reads: LocationInfo[] = [];
    const writes: LocationInfo[] = [];

    // 如果是类属性，找到类定义范围
    let classNode: ts.ClassDeclaration | undefined;
    if (className) {
      const findClass = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name?.text === className) {
          classNode = node;
        }
        ts.forEachChild(node, findClass);
      };
      findClass(sourceFile);
    }

    // 遍历 AST，查找符号的所有引用
    const visit = (node: ts.Node) => {
      // 如果是类属性，只在类内部搜索
      if (className && classNode && !this.isDescendant(classNode, node)) {
        ts.forEachChild(node, visit);
        return;
      }

      // 检查是否为属性访问或标识符
      if (ts.isPropertyAccessExpression(node)) {
        const propName = node.name.text;
        if (propName === symbolName) {
          const location = this.getLocationInfo(node, sourceFile);
          if (this.isWriteOperation(node)) {
            writes.push(location);
          } else {
            reads.push(location);
          }
        }
      } else if (ts.isIdentifier(node) && node.text === symbolName) {
        // 跳过类型注解和导入语句中的标识符
        if (this.isTypeContext(node) || this.isImportContext(node)) {
          ts.forEachChild(node, visit);
          return;
        }

        const location = this.getLocationInfo(node, sourceFile);
        if (this.isWriteOperation(node)) {
          writes.push(location);
        } else {
          reads.push(location);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      symbolId,
      symbolName,
      reads,
      writes,
      dataFlowGraph: this.buildDataFlowGraph(symbolName, reads, writes),
    };
  }

  /**
   * 判断是否为写操作
   */
  private isWriteOperation(node: ts.Node): boolean {
    const parent = node.parent;

    // 赋值表达式的左侧
    if (ts.isBinaryExpression(parent)) {
      if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return parent.left === node || this.isDescendant(parent.left, node);
      }
      // 复合赋值 (+=, -=, etc.)
      if (
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        return parent.left === node || this.isDescendant(parent.left, node);
      }
    }

    // 自增自减
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      if (
        parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        return true;
      }
    }

    // 对象解构赋值 (const { x } = obj 或 { x } = obj)
    if (ts.isBindingElement(parent) || ts.isShorthandPropertyAssignment(parent)) {
      return true;
    }

    // 变量声明 (const x = ...)
    if (ts.isVariableDeclaration(parent) && parent.name === node) {
      return true;
    }

    // 参数声明（函数参数也算是写入）
    if (ts.isParameter(parent) && parent.name === node) {
      return true;
    }

    // 属性声明（class MyClass { prop = value; }）
    if (ts.isPropertyDeclaration(parent) && parent.name === node) {
      return !!parent.initializer; // 只有有初始值时才算写入
    }

    return false;
  }

  /**
   * 检查是否在类型上下文中（类型注解、泛型等）
   */
  private isTypeContext(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (
        ts.isTypeNode(current) ||
        ts.isTypeReferenceNode(current) ||
        ts.isTypeAliasDeclaration(current) ||
        ts.isInterfaceDeclaration(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * 检查是否在导入语句中
   */
  private isImportContext(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (ts.isImportDeclaration(current) || ts.isImportClause(current)) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * 检查 child 是否是 parent 的后代节点
   */
  private isDescendant(parent: ts.Node, child: ts.Node): boolean {
    let current: ts.Node | undefined = child;
    while (current) {
      if (current === parent) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * 获取位置信息
   */
  private getLocationInfo(node: ts.Node, sourceFile: ts.SourceFile): LocationInfo {
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const text = sourceFile.text;

    // 提取代码片段（当前行）
    const lineStart = text.lastIndexOf('\n', node.getStart()) + 1;
    const lineEnd = text.indexOf('\n', node.getEnd());
    const code = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();

    return {
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      code,
    };
  }

  /**
   * 构建数据流图
   */
  private buildDataFlowGraph(
    symbolName: string,
    reads: LocationInfo[],
    writes: LocationInfo[]
  ): DataFlowResult['dataFlowGraph'] {
    const nodes: Array<{ id: string; label: string; type: 'read' | 'write' }> = [];
    const edges: Array<{ source: string; target: string }> = [];

    // 中心节点
    nodes.push({
      id: 'center',
      label: symbolName,
      type: 'read', // 中性类型
    });

    // 写入节点
    writes.forEach((write, i) => {
      const id = `write-${i}`;
      nodes.push({
        id,
        label: `Write (${write.line}:${write.column})`,
        type: 'write',
      });
      edges.push({ source: id, target: 'center' });
    });

    // 读取节点
    reads.forEach((read, i) => {
      const id = `read-${i}`;
      nodes.push({
        id,
        label: `Read (${read.line}:${read.column})`,
        type: 'read',
      });
      edges.push({ source: 'center', target: id });
    });

    return { nodes, edges };
  }
}
