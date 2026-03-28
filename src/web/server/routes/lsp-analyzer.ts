/**
 * LSP + AI 混合代码分析器
 *
 * 架构：
 * 1. TypeScript Compiler API (LSP) - 提取准确的符号信息
 * 2. Claude AI - 理解调用关系和语义
 * 3. 缓存系统 - 提升性能
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import type {
  FunctionNode,
  ClassNode,
  MethodNode,
  LocationInfo,
  InterfaceNode,
  TypeNode,
  PropertySignature,
  MethodSignature,
  ParameterInfo
} from '../../../map/types.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// TypeScript LSP 分析器
// ============================================================================

export class TypeScriptLSPAnalyzer {
  private program: ts.Program | null = null;
  private checker: ts.TypeChecker | null = null;

  /**
   * 初始化 LSP（创建 TypeScript Program）
   */
  initProgram(files: string[], projectRoot: string): void {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      skipLibCheck: true,
    };

    // 如果有 tsconfig.json，读取配置
    if (fs.existsSync(tsconfigPath)) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.config) {
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          projectRoot
        );
        compilerOptions = parsedConfig.options;
      }
    }

    // 创建 Program
    this.program = ts.createProgram(files, compilerOptions);
    this.checker = this.program.getTypeChecker();

    console.log(`[LSP] Program initialized with ${files.length} files`);
  }

  /**
   * 使用 LSP 分析单个文件
   */
  analyzeFile(filePath: string): {
    functions: FunctionNode[];
    classes: ClassNode[];
    interfaces: InterfaceNode[];
    types: TypeNode[];
  } {
    if (!this.program || !this.checker) {
      throw new Error('LSP Program not initialized');
    }

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return { functions: [], classes: [], interfaces: [], types: [] };
    }

    const functions: FunctionNode[] = [];
    const classes: ClassNode[] = [];
    const interfaces: InterfaceNode[] = [];
    const types: TypeNode[] = [];

    const visit = (node: ts.Node) => {
      // 函数声明
      if (ts.isFunctionDeclaration(node) && node.name) {
        const func = this.extractFunction(node, filePath);
        if (func) functions.push(func);
      }

      // 箭头函数（const xxx = () => {}）
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(decl => {
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              const func = this.extractArrowFunction(decl, filePath);
              if (func) functions.push(func);
            }
          }
        });
      }

      // 类声明
      if (ts.isClassDeclaration(node) && node.name) {
        const cls = this.extractClass(node, filePath);
        if (cls) classes.push(cls);
      }

      // 接口声明
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const interfaceNode = this.extractInterface(node, filePath);
        if (interfaceNode) interfaces.push(interfaceNode);
      }

      // 类型别名
      if (ts.isTypeAliasDeclaration(node) && node.name) {
        const typeNode = this.extractTypeAlias(node, filePath);
        if (typeNode) types.push(typeNode);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return { functions, classes, interfaces, types };
  }

  /**
   * 提取函数信息
   */
  private extractFunction(node: ts.FunctionDeclaration, filePath: string): FunctionNode | null {
    if (!node.name || !this.checker) return null;

    const name = node.name.text;
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    const signature = this.getSignature(node);
    const parameters = this.extractParameters(node);

    return {
      id: `${filePath}::${name}`,
      name,
      signature,
      parameters,
      isAsync: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)),
      isGenerator: !!node.asteriskToken,
      isExported: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)),
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
      calls: [], // 稍后由 AI 填充
      calledBy: [],
    };
  }

  /**
   * 提取箭头函数
   */
  private extractArrowFunction(decl: ts.VariableDeclaration, filePath: string): FunctionNode | null {
    if (!ts.isIdentifier(decl.name) || !this.checker) return null;

    const name = decl.name.text;
    const sourceFile = decl.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, decl.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, decl.getEnd());

    const initializer = decl.initializer;
    const isAsync = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ? !!(initializer.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))
      : false;

    return {
      id: `${filePath}::${name}`,
      name,
      signature: name,
      parameters: [],
      isAsync,
      isGenerator: false,
      isExported: false, // 暂时不检测
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
      calls: [],
      calledBy: [],
    };
  }

  /**
   * 提取类信息
   */
  private extractClass(node: ts.ClassDeclaration, filePath: string): ClassNode | null {
    if (!node.name || !this.checker) return null;

    const className = node.name.text;
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    const methods: MethodNode[] = [];

    // 提取方法
    node.members.forEach(member => {
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
        const method = this.extractMethod(member, className, filePath);
        if (method) methods.push(method);
      }

      // 构造函数
      if (ts.isConstructorDeclaration(member)) {
        const constructor = this.extractConstructor(member, className, filePath);
        if (constructor) methods.push(constructor);
      }
    });

    return {
      id: `${filePath}::${className}`,
      name: className,
      isAbstract: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)),
      isExported: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)),
      methods,
      properties: [], // 暂不提取属性
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
    };
  }

  /**
   * 提取方法
   */
  private extractMethod(node: ts.MethodDeclaration, className: string, filePath: string): MethodNode | null {
    if (!ts.isIdentifier(node.name) || !this.checker) return null;

    const name = node.name.text;
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    const visibility = this.getVisibility(node);
    const signature = this.getSignature(node);
    const parameters = this.extractParameters(node);

    return {
      id: `${filePath}::${className}::${name}`,
      name,
      className,
      signature,
      parameters,
      isAsync: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)),
      isGenerator: !!node.asteriskToken,
      isExported: false,
      visibility,
      isStatic: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)),
      isAbstract: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)),
      isOverride: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.OverrideKeyword)),
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
      calls: [],
      calledBy: [],
    };
  }

  /**
   * 提取构造函数
   */
  private extractConstructor(node: ts.ConstructorDeclaration, className: string, filePath: string): MethodNode {
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    const parameters = this.extractParameters(node);

    return {
      id: `${filePath}::${className}::constructor`,
      name: 'constructor',
      className,
      signature: 'constructor',
      parameters,
      isAsync: false,
      isGenerator: false,
      isExported: false,
      visibility: 'public',
      isStatic: false,
      isAbstract: false,
      isOverride: false,
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
      calls: [],
      calledBy: [],
    };
  }

  // Helper methods
  private getVisibility(node: ts.MethodDeclaration): 'public' | 'private' | 'protected' {
    if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
    if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
    return 'public';
  }

  private getSignature(node: ts.SignatureDeclaration): string {
    const text = node.getText();
    return text.substring(0, Math.min(150, text.length));
  }

  private extractParameters(node: ts.SignatureDeclaration): ParameterInfo[] {
    return node.parameters.map(param => ({
      name: param.name.getText(),
      type: param.type ? param.type.getText() : undefined,
      isOptional: !!param.questionToken,
      isRest: !!param.dotDotDotToken,
    }));
  }

  /**
   * 提取接口信息
   */
  private extractInterface(node: ts.InterfaceDeclaration, filePath: string): InterfaceNode | null {
    if (!node.name || !this.checker) return null;

    const interfaceName = node.name.text;
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    const properties: PropertySignature[] = [];
    const methods: MethodSignature[] = [];

    // 提取接口成员（区分属性和方法）
    node.members.forEach(member => {
      // 属性签名
      if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
        const propName = member.name.text;
        const propType = member.type ? member.type.getText() : undefined;

        properties.push({
          name: propName,
          type: propType,
          isOptional: !!member.questionToken,
          isReadonly: !!(member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword)),
        });
      }

      // 方法签名
      if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
        const methodName = member.name.text;
        const parameters = this.extractParameters(member);
        const returnType = member.type ? member.type.getText() : undefined;

        methods.push({
          name: methodName,
          signature: member.getText().substring(0, 150),
          parameters,
          returnType,
          isOptional: !!member.questionToken,
        });
      }
    });

    // 提取继承的接口
    const extendsInterfaces = node.heritageClauses
      ?.filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.flatMap(clause => clause.types.map(type => type.expression.getText()));

    return {
      id: `${filePath}::${interfaceName}`,
      name: interfaceName,
      extends: extendsInterfaces && extendsInterfaces.length > 0 ? extendsInterfaces : undefined,
      isExported: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)),
      properties,
      methods,
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
    };
  }

  /**
   * 提取类型别名信息
   */
  private extractTypeAlias(node: ts.TypeAliasDeclaration, filePath: string): TypeNode | null {
    if (!node.name || !this.checker) return null;

    const typeName = node.name.text;
    const sourceFile = node.getSourceFile();
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

    // 提取类型定义内容
    const definition = node.type.getText();

    return {
      id: `${filePath}::${typeName}`,
      name: typeName,
      definition,
      isExported: !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)),
      location: {
        file: filePath,
        startLine: start.line + 1,
        startColumn: start.character,
        endLine: end.line + 1,
        endColumn: end.character,
      },
    };
  }
}

// ============================================================================
// AI 调用关系分析器（使用 Claude）
// ============================================================================

export class AICallGraphAnalyzer {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * 使用 AI 分析调用关系
   */
  async analyzeCallRelationships(
    fileContent: string,
    filePath: string,
    allSymbols: { functions: FunctionNode[]; classes: ClassNode[] }
  ): Promise<{
    calls: Array<{ from: string; to: string; type: string; reason: string }>;
  }> {
    // 构建符号列表
    const symbolList = [
      ...allSymbols.functions.map(f => `function ${f.name}`),
      ...allSymbols.classes.flatMap(c => [
        `class ${c.name}`,
        ...c.methods.map(m => `${c.name}.${m.name}`)
      ])
    ];

    const prompt = `Analyze the function call relationships in the following TypeScript code.

Code file: ${path.basename(filePath)}

Available symbol list:
${symbolList.join('\n')}

Code content:
\`\`\`typescript
${fileContent}
\`\`\`

Please analyze and return the call relationships in JSON format:
{
  "calls": [
    {
      "from": "FunctionA",
      "to": "FunctionB",
      "type": "direct|callback|async|dynamic",
      "reason": "Reason for the call"
    }
  ]
}

Notes:
1. Only include calls that actually exist in the code
2. type: direct (direct call), callback (callback), async (async), dynamic (dynamic)
3. reason: briefly explain why the call is made (e.g. "initialize configuration", "handle user input")
`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // 提取 JSON
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        return json;
      }

      return { calls: [] };
    } catch (error) {
      console.error('[AI Analysis] Failed:', error);
      return { calls: [] };
    }
  }
}
