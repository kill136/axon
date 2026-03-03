/**
 * 项目地图生成器
 * 生成项目概览信息：模块统计、入口点检测、核心符号分析
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 类型定义
// ============================================================================

export interface EntryPoint {
  id: string;
  name: string;
  moduleId: string;
  type: 'cli' | 'main' | 'index' | 'package-json';
}

export interface CoreSymbols {
  classes: Array<{ name: string; refs: number; moduleId: string }>;
  functions: Array<{ name: string; refs: number; moduleId: string }>;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 统计代码总行数
 */
export async function calculateTotalLines(files: string[]): Promise<number> {
  let totalLines = 0;

  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // 过滤空行和注释行
      const codeLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
      });

      totalLines += codeLines.length;
    } catch (err) {
      // 忽略无法读取的文件
      console.error(`[Project Map] Unable to read file: ${file}`, err);
    }
  }

  return totalLines;
}

/**
 * 按目录分组统计文件数
 */
export function groupByDirectory(files: string[]): Record<string, number> {
  const grouped: Record<string, number> = {};

  for (const file of files) {
    const dir = path.dirname(file);
    const parts = dir.split(path.sep);

    // 提取第一层目录 (例如 src/core -> core)
    if (parts.length > 1) {
      const topDir = parts[1];
      grouped[topDir] = (grouped[topDir] || 0) + 1;
    }
  }

  return grouped;
}

/**
 * 检测项目入口点
 * 检测策略:
 * 1. package.json 的 main 字段
 * 2. cli.ts, main.ts, index.ts
 * 3. Python 的 __main__ 入口
 */
export async function detectEntryPoints(files: string[]): Promise<EntryPoint[]> {
  const entryPoints: EntryPoint[] = [];
  const projectRoot = process.cwd();

  // 1. 检查 package.json
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      if (packageJson.main) {
        const mainPath = path.resolve(projectRoot, packageJson.main);
        const relativePath = path.relative(projectRoot, mainPath);

        entryPoints.push({
          id: `entry:package-json:${relativePath}`,
          name: path.basename(mainPath),
          moduleId: relativePath,
          type: 'package-json',
        });
      }
    }
  } catch (err) {
    console.error('[Project Map] Unable to read package.json', err);
  }

  // 2. 检查常见入口文件
  const entryPatterns = [
    { pattern: /[\/\\]cli\.(ts|js)$/i, type: 'cli' as const },
    { pattern: /[\/\\]main\.(ts|js)$/i, type: 'main' as const },
    { pattern: /[\/\\]index\.(ts|js)$/i, type: 'index' as const },
  ];

  for (const file of files) {
    for (const { pattern, type } of entryPatterns) {
      if (pattern.test(file)) {
        const relativePath = path.relative(projectRoot, file);
        const id = `entry:${type}:${relativePath}`;

        // 避免重复
        if (!entryPoints.find(ep => ep.id === id)) {
          entryPoints.push({
            id,
            name: path.basename(file),
            moduleId: relativePath,
            type,
          });
        }
      }
    }
  }

  // 3. 检查 Python 入口 (__main__)
  const pythonFiles = files.filter(f => f.endsWith('.py'));
  for (const file of pythonFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('if __name__ == \'__main__\'') || content.includes('if __name__ == "__main__"')) {
        const relativePath = path.relative(projectRoot, file);
        entryPoints.push({
          id: `entry:python-main:${relativePath}`,
          name: path.basename(file),
          moduleId: relativePath,
          type: 'main',
        });
      }
    } catch (err) {
      // 忽略
    }
  }

  return entryPoints;
}

/**
 * 分析核心符号（被引用最多的类和函数）
 */
export async function getCoreSymbols(symbols: any[]): Promise<CoreSymbols> {
  // 统计每个符号的引用次数
  const classRefs = new Map<string, { name: string; moduleId: string; count: number }>();
  const funcRefs = new Map<string, { name: string; moduleId: string; count: number }>();

  for (const symbol of symbols) {
    if (!symbol || !symbol.name) continue;

    const key = `${symbol.moduleId || ''}::${symbol.name}`;

    if (symbol.kind === 'class') {
      const existing = classRefs.get(key);
      if (existing) {
        existing.count++;
      } else {
        classRefs.set(key, {
          name: symbol.name,
          moduleId: symbol.moduleId || '',
          count: 1,
        });
      }
    } else if (symbol.kind === 'function' || symbol.kind === 'method') {
      const existing = funcRefs.get(key);
      if (existing) {
        existing.count++;
      } else {
        funcRefs.set(key, {
          name: symbol.name,
          moduleId: symbol.moduleId || '',
          count: 1,
        });
      }
    }
  }

  // 按引用次数排序，取前20
  const topClasses = Array.from(classRefs.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(({ name, moduleId, count }) => ({
      name,
      moduleId,
      refs: count,
    }));

  const topFunctions = Array.from(funcRefs.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(({ name, moduleId, count }) => ({
      name,
      moduleId,
      refs: count,
    }));

  return {
    classes: topClasses,
    functions: topFunctions,
  };
}

// ============================================================================
// Treemap 数据生成
// ============================================================================

export interface TreemapNode {
  name: string;
  path: string;
  value?: number;          // 代码行数（仅叶节点）
  children?: TreemapNode[];
  type: 'directory' | 'file' | 'symbol';
  fileCount?: number;      // 文件数量（仅目录）
  language?: string;       // 编程语言（仅文件）
  symbolType?: 'class' | 'method' | 'function' | 'property' | 'interface' | 'type';  // 符号类型
  signature?: string;      // 符号签名
}

/**
 * 获取文件的代码行数
 */
function getFileLines(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    // 过滤空行
    return lines.filter(line => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * 获取文件的编程语言
 */
function getFileLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.json': 'JSON',
    '.md': 'Markdown',
    '.html': 'HTML',
  };
  return langMap[ext] || 'Other';
}

/**
 * 提取文件内的符号并转换为 TreemapNode
 * @param filePath 文件路径
 * @param rootDir 项目根目录
 * @returns 符号节点数组
 */
async function extractFileSymbols(filePath: string, rootDir: string): Promise<TreemapNode[]> {
  const symbols: TreemapNode[] = [];

  try {
    // 只处理 TypeScript/JavaScript 文件
    const ext = path.extname(filePath).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      return symbols;
    }

    // 动态导入 LSP 分析器
    const { TypeScriptLSPAnalyzer } = await import('./lsp-analyzer.js');
    const lspAnalyzer = new TypeScriptLSPAnalyzer();

    // 初始化程序（只分析当前文件）
    lspAnalyzer.initProgram([filePath], rootDir);

    // 分析文件
    const { functions, classes, interfaces, types } = lspAnalyzer.analyzeFile(filePath);

    // 添加类符号
    for (const cls of classes) {
      const classChildren: TreemapNode[] = [];

      // 添加方法
      for (const method of cls.methods) {
        classChildren.push({
          name: method.name,
          path: `${path.relative(rootDir, filePath)}::${cls.name}::${method.name}`,
          value: 10, // 估算方法行数
          type: 'symbol',
          symbolType: 'method',
          signature: method.signature,
        });
      }

      // 添加属性
      for (const prop of cls.properties) {
        classChildren.push({
          name: prop.name,
          path: `${path.relative(rootDir, filePath)}::${cls.name}::${prop.name}`,
          value: 1, // 属性占 1 行
          type: 'symbol',
          symbolType: 'property',
        });
      }

      symbols.push({
        name: cls.name,
        path: `${path.relative(rootDir, filePath)}::${cls.name}`,
        value: classChildren.reduce((sum, c) => sum + (c.value || 0), 0),
        children: classChildren,
        type: 'symbol',
        symbolType: 'class',
      });
    }

    // 添加函数符号
    for (const func of functions) {
      symbols.push({
        name: func.name,
        path: `${path.relative(rootDir, filePath)}::${func.name}`,
        value: 10, // 估算函数行数
        type: 'symbol',
        symbolType: 'function',
        signature: func.signature,
      });
    }

    // 添加接口符号
    for (const iface of interfaces) {
      const ifaceChildren: TreemapNode[] = [];

      // 添加接口方法签名
      for (const method of iface.methods) {
        ifaceChildren.push({
          name: method.name,
          path: `${path.relative(rootDir, filePath)}::${iface.name}::${method.name}`,
          value: 1,
          type: 'symbol',
          symbolType: 'method',
          signature: method.signature,
        });
      }

      symbols.push({
        name: iface.name,
        path: `${path.relative(rootDir, filePath)}::${iface.name}`,
        value: ifaceChildren.reduce((sum, c) => sum + (c.value || 0), 0) || 5,
        children: ifaceChildren.length > 0 ? ifaceChildren : undefined,
        type: 'symbol',
        symbolType: 'interface',
      });
    }

    // 添加类型别名
    for (const type of types) {
      symbols.push({
        name: type.name,
        path: `${path.relative(rootDir, filePath)}::${type.name}`,
        value: 2,
        type: 'symbol',
        symbolType: 'type',
      });
    }
  } catch (err) {
    console.error(`[Treemap] Failed to extract symbols: ${filePath}`, err);
  }

  return symbols;
}

/**
 * 生成 Treemap 数据结构（异步版本，支持符号级别）
 * @param rootDir 根目录
 * @param maxDepth 最大深度
 * @param excludePatterns 排除的目录/文件模式
 * @param includeSymbols 是否包含符号级别数据
 */
export async function generateTreemapDataAsync(
  rootDir: string,
  maxDepth: number = 4,
  excludePatterns: string[] = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'],
  includeSymbols: boolean = false
): Promise<TreemapNode> {
  const rootName = path.basename(rootDir) || rootDir;

  async function buildTree(dirPath: string, depth: number): Promise<TreemapNode | null> {
    const relativePath = path.relative(rootDir, dirPath);
    const name = path.basename(dirPath) || rootName;

    // 检查是否应该排除
    if (excludePatterns.some(pattern => name === pattern || name.startsWith('.'))) {
      return null;
    }

    try {
      const stat = fs.statSync(dirPath);

      if (stat.isFile()) {
        // 只处理代码文件
        const ext = path.extname(dirPath).toLowerCase();
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.css', '.scss', '.html'];
        if (!codeExtensions.includes(ext)) {
          return null;
        }

        const lines = getFileLines(dirPath);
        if (lines === 0) return null;

        // 提取符号（如果启用）
        let symbolChildren: TreemapNode[] | undefined = undefined;
        if (includeSymbols && ['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          symbolChildren = await extractFileSymbols(dirPath, rootDir);
        }

        return {
          name,
          path: relativePath || name,
          value: lines,
          type: 'file',
          language: getFileLanguage(dirPath),
          children: symbolChildren,
        };
      }

      if (stat.isDirectory()) {
        // 达到最大深度时，聚合统计
        if (depth >= maxDepth) {
          const files = getAllFiles(dirPath, excludePatterns);
          const totalLines = files.reduce((sum, f) => sum + getFileLines(f), 0);
          if (totalLines === 0) return null;

          return {
            name,
            path: relativePath || name,
            value: totalLines,
            type: 'directory',
            fileCount: files.length,
          };
        }

        // 递归处理子目录
        const entries = fs.readdirSync(dirPath);
        const children: TreemapNode[] = [];

        for (const entry of entries) {
          const childPath = path.join(dirPath, entry);
          const childNode = await buildTree(childPath, depth + 1);
          if (childNode) {
            children.push(childNode);
          }
        }

        if (children.length === 0) return null;

        // 计算目录的总行数和文件数
        const totalValue = children.reduce((sum, child) => {
          if (child.value) return sum + child.value;
          if (child.children) {
            return sum + child.children.reduce((s, c) => s + (c.value || 0), 0);
          }
          return sum;
        }, 0);

        const fileCount = children.reduce((sum, child) => {
          if (child.type === 'file') return sum + 1;
          return sum + (child.fileCount || 0);
        }, 0);

        return {
          name,
          path: relativePath || name,
          children,
          type: 'directory',
          fileCount,
        };
      }
    } catch (err) {
      console.error(`[Treemap] Unable to process: ${dirPath}`, err);
    }

    return null;
  }

  const result = await buildTree(rootDir, 0);
  return result || {
    name: rootName,
    path: '',
    children: [],
    type: 'directory',
    fileCount: 0,
  };
}

/**
 * 获取目录下所有文件（递归）
 */
function getAllFiles(dirPath: string, excludePatterns: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (excludePatterns.some(p => entry === p || entry.startsWith('.'))) {
          continue;
        }

        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.css', '.scss', '.html'];
          if (codeExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // 忽略无法访问的目录
    }
  }

  walk(dirPath);
  return files;
}

// ============================================================================
// 分层加载 API - 地图模式
// ============================================================================

/**
 * 缩放级别枚举
 */
export enum ZoomLevel {
  PROJECT = 0,   // 0-20%: 项目级
  MODULE = 1,    // 20-40%: 模块级
  FILE = 2,      // 40-60%: 文件级
  SYMBOL = 3,    // 60-80%: 符号级
  CODE = 4       // 80-100%: 代码级
}

/**
 * 分层节点数据结构
 */
export interface LayeredNode {
  id: string;
  name: string;
  path: string;
  level: ZoomLevel;
  value: number;
  type: 'directory' | 'file' | 'symbol' | 'code';
  hasChildren: boolean;
  childrenLoaded: boolean;
  children?: LayeredNode[];
  metadata?: {
    language?: string;
    complexity?: number;
    fileCount?: number;
    symbolType?: string;
    signature?: string;
  };
}

/**
 * 分层加载响应结构
 */
export interface LayeredTreemapResponse {
  node: LayeredNode;
  breadcrumb: Array<{ id: string; name: string; level: ZoomLevel }>;
  stats: {
    totalValue: number;
    childCount: number;
    currentLevel: ZoomLevel;
  };
}

/**
 * 根据缩放级别计算最大深度
 */
function getMaxDepthForLevel(level: ZoomLevel): number {
  switch (level) {
    case ZoomLevel.PROJECT: return 1;  // 只显示顶级模块
    case ZoomLevel.MODULE: return 2;   // 显示模块内目录
    case ZoomLevel.FILE: return 3;     // 显示文件
    case ZoomLevel.SYMBOL: return 4;   // 显示符号
    case ZoomLevel.CODE: return 5;     // 显示代码细节
    default: return 2;
  }
}

/**
 * 生成节点 ID
 */
function generateNodeId(relativePath: string, type: string): string {
  return `${type}:${relativePath || 'root'}`;
}

/**
 * 获取文件复杂度（基于行数和符号数量的简单估算）
 */
function estimateComplexity(lines: number): number {
  if (lines < 50) return 1;
  if (lines < 100) return 2;
  if (lines < 200) return 3;
  if (lines < 500) return 4;
  return 5;
}

/**
 * 分层加载数据生成器
 *
 * @param rootDir 项目根目录
 * @param level 当前缩放级别
 * @param focusPath 聚焦路径（可选，用于进入某个节点）
 * @param loadDepth 加载深度，默认1
 */
export async function generateLayeredTreemapData(
  rootDir: string,
  level: ZoomLevel = ZoomLevel.PROJECT,
  focusPath: string = '',
  loadDepth: number = 1,
  excludePatterns: string[] = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']
): Promise<LayeredTreemapResponse> {
  const rootName = path.basename(rootDir) || rootDir;
  const maxDepth = getMaxDepthForLevel(level) + loadDepth - 1;
  // 符号级别采用懒加载，不在这里一次性加载所有文件的符号
  // 符号只通过 loadNodeChildren API 在用户点击进入文件时加载
  const includeSymbols = false;

  // 计算起始目录
  const startDir = focusPath ? path.join(rootDir, focusPath) : rootDir;

  // 验证路径存在
  if (!fs.existsSync(startDir)) {
    throw new Error(`Path not found: ${focusPath}`);
  }

  // 构建面包屑导航
  const breadcrumb: Array<{ id: string; name: string; level: ZoomLevel }> = [];
  if (focusPath) {
    const parts = focusPath.split(path.sep).filter(Boolean);
    let currentPath = '';

    // 添加根节点
    breadcrumb.push({
      id: generateNodeId('', 'directory'),
      name: rootName,
      level: ZoomLevel.PROJECT
    });

    // 添加路径中的各级节点
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? path.join(currentPath, parts[i]) : parts[i];
      const fullPath = path.join(rootDir, currentPath);
      const stat = fs.statSync(fullPath);
      const nodeType = stat.isDirectory() ? 'directory' : 'file';

      // 根据深度计算层级
      let nodeLevel: ZoomLevel;
      if (i === 0) nodeLevel = ZoomLevel.MODULE;
      else if (stat.isFile()) nodeLevel = ZoomLevel.FILE;
      else nodeLevel = ZoomLevel.MODULE;

      breadcrumb.push({
        id: generateNodeId(currentPath, nodeType),
        name: parts[i],
        level: nodeLevel
      });
    }
  } else {
    breadcrumb.push({
      id: generateNodeId('', 'directory'),
      name: rootName,
      level: ZoomLevel.PROJECT
    });
  }

  /**
   * 递归构建分层树
   */
  async function buildLayeredNode(
    dirPath: string,
    currentDepth: number,
    parentLevel: ZoomLevel
  ): Promise<LayeredNode | null> {
    const relativePath = path.relative(rootDir, dirPath);
    const name = path.basename(dirPath) || rootName;

    // 检查是否应该排除
    if (excludePatterns.some(pattern => name === pattern || name.startsWith('.'))) {
      return null;
    }

    try {
      const stat = fs.statSync(dirPath);

      if (stat.isFile()) {
        // 只处理代码文件
        const ext = path.extname(dirPath).toLowerCase();
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.css', '.scss', '.html'];
        if (!codeExtensions.includes(ext)) {
          return null;
        }

        const lines = getFileLines(dirPath);
        if (lines === 0) return null;

        const language = getFileLanguage(dirPath);
        const complexity = estimateComplexity(lines);

        // TS/JS 文件可以包含符号，标记为可展开（懒加载）
        // 符号只在用户点击进入文件时通过 loadNodeChildren API 加载
        const canHaveSymbols = ['.ts', '.tsx', '.js', '.jsx'].includes(ext);

        return {
          id: generateNodeId(relativePath, 'file'),
          name,
          path: relativePath,
          level: ZoomLevel.FILE,
          value: lines,
          type: 'file',
          hasChildren: canHaveSymbols,
          childrenLoaded: false,  // 符号采用懒加载，初始未加载
          children: undefined,
          metadata: {
            language,
            complexity
          }
        };
      }

      if (stat.isDirectory()) {
        // 达到最大深度时，不再展开子节点
        if (currentDepth >= maxDepth) {
          const files = getAllFiles(dirPath, excludePatterns);
          const totalLines = files.reduce((sum, f) => sum + getFileLines(f), 0);
          if (totalLines === 0) return null;

          return {
            id: generateNodeId(relativePath, 'directory'),
            name,
            path: relativePath,
            level: parentLevel,
            value: totalLines,
            type: 'directory',
            hasChildren: true,
            childrenLoaded: false,
            metadata: {
              fileCount: files.length
            }
          };
        }

        // 递归处理子目录
        const entries = fs.readdirSync(dirPath);
        const children: LayeredNode[] = [];

        for (const entry of entries) {
          const childPath = path.join(dirPath, entry);
          const childNode = await buildLayeredNode(
            childPath,
            currentDepth + 1,
            currentDepth === 0 ? ZoomLevel.MODULE : ZoomLevel.FILE
          );
          if (childNode) {
            children.push(childNode);
          }
        }

        // 按 value 排序（大的在前）
        children.sort((a, b) => b.value - a.value);

        if (children.length === 0) {
          const files = getAllFiles(dirPath, excludePatterns);
          if (files.length === 0) return null;
        }

        // 计算目录的总行数和文件数
        const totalValue = children.reduce((sum, child) => sum + child.value, 0);
        const fileCount = children.reduce((sum, child) => {
          if (child.type === 'file') return sum + 1;
          return sum + (child.metadata?.fileCount || 0);
        }, 0);

        // 确定当前层级
        const nodeLevel = currentDepth === 0 ? ZoomLevel.PROJECT :
                         currentDepth === 1 ? ZoomLevel.MODULE : ZoomLevel.FILE;

        return {
          id: generateNodeId(relativePath, 'directory'),
          name,
          path: relativePath,
          level: nodeLevel,
          value: totalValue,
          type: 'directory',
          hasChildren: children.length > 0,
          childrenLoaded: true,
          children: children.length > 0 ? children : undefined,
          metadata: {
            fileCount
          }
        };
      }
    } catch (err) {
      console.error(`[LayeredTreemap] Unable to process: ${dirPath}`, err);
    }

    return null;
  }

  // 构建节点树
  const node = await buildLayeredNode(startDir, 0, level);

  if (!node) {
    throw new Error(`Failed to build layered treemap for: ${startDir}`);
  }

  // 计算统计信息
  const childCount = node.children?.length || 0;

  return {
    node,
    breadcrumb,
    stats: {
      totalValue: node.value,
      childCount,
      currentLevel: level
    }
  };
}

/**
 * 加载特定节点的子节点（懒加载）
 *
 * @param rootDir 项目根目录
 * @param nodePath 节点路径
 * @param level 当前缩放级别
 */
export async function loadNodeChildren(
  rootDir: string,
  nodePath: string,
  level: ZoomLevel = ZoomLevel.MODULE,
  excludePatterns: string[] = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']
): Promise<LayeredNode[]> {
  const fullPath = path.join(rootDir, nodePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Path not found: ${nodePath}`);
  }

  const stat = fs.statSync(fullPath);
  const children: LayeredNode[] = [];

  if (stat.isDirectory()) {
    const entries = fs.readdirSync(fullPath);

    for (const entry of entries) {
      if (excludePatterns.some(p => entry === p || entry.startsWith('.'))) {
        continue;
      }

      const childPath = path.join(fullPath, entry);
      const childRelativePath = path.relative(rootDir, childPath);
      const childStat = fs.statSync(childPath);

      if (childStat.isDirectory()) {
        const files = getAllFiles(childPath, excludePatterns);
        const totalLines = files.reduce((sum, f) => sum + getFileLines(f), 0);
        if (totalLines === 0) continue;

        children.push({
          id: generateNodeId(childRelativePath, 'directory'),
          name: entry,
          path: childRelativePath,
          level: level + 1 as ZoomLevel,
          value: totalLines,
          type: 'directory',
          hasChildren: true,
          childrenLoaded: false,
          metadata: {
            fileCount: files.length
          }
        });
      } else if (childStat.isFile()) {
        const ext = path.extname(childPath).toLowerCase();
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.css', '.scss', '.html'];
        if (!codeExtensions.includes(ext)) continue;

        const lines = getFileLines(childPath);
        if (lines === 0) continue;

        // 支持符号解析的文件类型
        const symbolExtensions = ['.ts', '.tsx', '.js', '.jsx'];
        const canHaveSymbols = symbolExtensions.includes(ext);

        children.push({
          id: generateNodeId(childRelativePath, 'file'),
          name: entry,
          path: childRelativePath,
          level: ZoomLevel.FILE,
          value: lines,
          type: 'file',
          hasChildren: canHaveSymbols, // 只要是支持符号解析的文件就有子节点
          childrenLoaded: false,
          metadata: {
            language: getFileLanguage(childPath),
            complexity: estimateComplexity(lines)
          }
        });
      }
    }

    // 按 value 排序
    children.sort((a, b) => b.value - a.value);
  } else if (stat.isFile()) {
    // 加载文件内的符号（懒加载模式 - 只在用户点击进入文件时加载）
    const ext = path.extname(fullPath).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      console.log(`[loadNodeChildren] Lazy loading file symbols: ${nodePath}`);
      const symbols = await extractFileSymbols(fullPath, rootDir);
      for (const sym of symbols) {
        children.push({
          id: generateNodeId(sym.path, 'symbol'),
          name: sym.name,
          path: sym.path,
          level: ZoomLevel.SYMBOL,
          value: sym.value || 10,
          type: 'symbol',
          hasChildren: !!(sym.children && sym.children.length > 0),
          childrenLoaded: false,
          metadata: {
            symbolType: sym.symbolType,
            signature: sym.signature
          }
        });
      }
      console.log(`[loadNodeChildren] Loaded ${children.length} symbols`);
    }
  }

  return children;
}
