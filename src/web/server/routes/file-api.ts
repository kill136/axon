/**
 * 文件操作 API 路由
 * 
 * 提供安全的文件系统访问接口：
 * - GET /api/files/tree - 获取目录树
 * - GET /api/files/read - 读取文件内容
 * - PUT /api/files/write - 写入文件内容
 * - POST /api/files/rename - 重命名文件/目录
 * - POST /api/files/delete - 删除文件/目录
 * - POST /api/files/create - 新建文件
 * - POST /api/files/mkdir - 新建目录
 * - POST /api/files/copy - 复制文件/目录
 * - POST /api/files/move - 移动文件/目录
 * - POST /api/files/reveal - 在系统资源管理器中打开
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getRgPath } from '../../../search/ripgrep.js';
import { spawnSync } from 'child_process';

const execPromise = promisify(exec);

const router = Router();

// 默认项目根目录（仅在请求未指定 root 时使用）
const DEFAULT_PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

/**
 * 从请求中获取项目根目录
 * 优先使用 query/body 中的 root 参数，否则使用默认值
 */
function getProjectRoot(req: Request): string {
  const root = (req.query.root as string) || (req.body?.root as string);
  if (root && path.isAbsolute(root)) {
    const normalized = path.normalize(root);
    // 防止路径遍历：normalize 后不应包含 ..
    if (normalized.includes('..')) {
      return DEFAULT_PROJECT_ROOT;
    }
    return normalized;
  }
  return DEFAULT_PROJECT_ROOT;
}

// 自动排除的目录
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.cache',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  'coverage',
  '.vscode',
  '.idea',
]);

// 文件扩展名到语言映射
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.md': 'markdown',
  '.txt': 'plaintext',
  '.html': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.rs': 'rust',
  '.go': 'go',
  '.php': 'php',
  '.rb': 'ruby',
  '.sh': 'shell',
  '.bash': 'shell',
  '.sql': 'sql',
};

/**
 * 验证路径安全性
 * 防止路径遍历攻击，确保路径在项目根目录下
 */
function validatePath(filePath: string, projectRoot: string): { valid: boolean; resolvedPath: string; error?: string } {
  try {
    // 解析绝对路径
    const resolvedPath = path.resolve(projectRoot, filePath);
    
    // 计算相对路径
    const relativePath = path.relative(projectRoot, resolvedPath);
    
    // 检查是否在项目目录下（不能以 '..' 开头）
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return {
        valid: false,
        resolvedPath,
        error: '路径必须在项目目录下',
      };
    }
    
    return {
      valid: true,
      resolvedPath,
    };
  } catch (error) {
    return {
      valid: false,
      resolvedPath: '',
      error: error instanceof Error ? error.message : '路径解析失败',
    };
  }
}

/**
 * 递归获取目录树结构
 */
async function getDirectoryTree(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  projectRoot: string
): Promise<FileTreeNode | null> {
  try {
    const stats = await fs.stat(dirPath);
    const name = path.basename(dirPath);
    const relativePath = path.relative(projectRoot, dirPath);
    
    // 如果是文件，直接返回
    if (stats.isFile()) {
      return {
        name,
        path: relativePath || '.',
        type: 'file',
      };
    }
    
    // 如果是目录
    if (stats.isDirectory()) {
      // 排除特定目录
      if (EXCLUDED_DIRS.has(name)) {
        return null;
      }
      
      const node: FileTreeNode = {
        name,
        path: relativePath || '.',
        type: 'directory',
      };
      
      // 如果达到最大深度，不再递归
      if (currentDepth >= maxDepth) {
        return node;
      }
      
      // 读取子目录
      const entries = await fs.readdir(dirPath);
      const children: FileTreeNode[] = [];
      
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const childNode = await getDirectoryTree(entryPath, currentDepth + 1, maxDepth, projectRoot);
        if (childNode) {
          children.push(childNode);
        }
      }
      
      // 排序：目录在前，文件在后，同类按名称排序
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
      if (children.length > 0) {
        node.children = children;
      }
      
      return node;
    }
    
    return null;
  } catch (error) {
    console.error(`[File API] 读取目录树失败: ${dirPath}`, error);
    return null;
  }
}

/**
 * 类型定义
 */
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

interface ReadFileResponse {
  content: string;
  language: string;
}

interface WriteFileRequest {
  path: string;
  content: string;
}

interface WriteFileResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// API 路由
// ============================================================================

/**
 * GET /api/files/tree
 * 获取目录树结构
 * 
 * Query 参数:
 * - path: 相对路径（默认 '.'）
 * - depth: 递归深度（默认 3，最大 5）
 */
router.get('/tree', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const queryPath = (req.query.path as string) || '.';
    const depth = Math.min(Math.max(parseInt(req.query.depth as string) || 3, 1), 5);
    
    // 验证路径
    const validation = validatePath(queryPath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
      });
      return;
    }
    
    // 检查路径是否存在
    try {
      await fs.access(validation.resolvedPath);
    } catch {
      res.status(404).json({
        error: '路径不存在',
      });
      return;
    }
    
    // 获取目录树
    const tree = await getDirectoryTree(validation.resolvedPath, 0, depth, projectRoot);
    
    if (!tree) {
      res.status(404).json({
        error: '无法读取目录',
      });
      return;
    }
    
    res.json(tree);
  } catch (error) {
    console.error('[File API] 获取目录树失败:', error);
    res.status(500).json({
      error: '获取目录树失败',
      message: error instanceof Error ? error.message : '未知错误',
    });
  }
});

/**
 * GET /api/files/read
 * 读取文件内容
 * 
 * Query 参数:
 * - path: 文件相对路径
 */
router.get('/read', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const queryPath = req.query.path as string;
    
    if (!queryPath) {
      res.status(400).json({
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(queryPath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
      });
      return;
    }
    
    // 检查文件是否存在
    try {
      const stats = await fs.stat(validation.resolvedPath);
      if (!stats.isFile()) {
        res.status(400).json({
          error: '路径不是文件',
        });
        return;
      }
    } catch {
      res.status(404).json({
        error: '文件不存在',
      });
      return;
    }
    
    // 读取文件内容
    const content = await fs.readFile(validation.resolvedPath, 'utf-8');
    
    // 推断语言
    const ext = path.extname(validation.resolvedPath).toLowerCase();
    const language = EXT_TO_LANGUAGE[ext] || 'plaintext';
    
    const response: ReadFileResponse = {
      content,
      language,
    };
    
    res.json(response);
  } catch (error) {
    console.error('[File API] 读取文件失败:', error);
    res.status(500).json({
      error: '读取文件失败',
      message: error instanceof Error ? error.message : '未知错误',
    });
  }
});

/**
 * PUT /api/files/write
 * 写入文件内容
 * 
 * Body:
 * - path: 文件相对路径
 * - content: 文件内容
 */
router.put('/write', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { path: filePath, content } = req.body as WriteFileRequest;
    
    if (!filePath) {
      res.status(400).json({
        success: false,
        message: '缺少 path 参数',
      });
      return;
    }
    
    if (typeof content !== 'string') {
      res.status(400).json({
        success: false,
        message: 'content 必须是字符串',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(filePath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: validation.error,
      });
      return;
    }
    
    // 确保目录存在
    const dirPath = path.dirname(validation.resolvedPath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // 写入文件
    await fs.writeFile(validation.resolvedPath, content, 'utf-8');
    
    const response: WriteFileResponse = {
      success: true,
      message: '文件写入成功',
    };
    
    res.json(response);
  } catch (error) {
    console.error('[File API] 写入文件失败:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '未知错误',
    });
  }
});

/**
 * POST /api/files/rename
 * 重命名文件/目录
 * 
 * Body:
 * - oldPath: 原路径（相对）
 * - newPath: 新路径（相对）
 */
router.post('/rename', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { oldPath, newPath } = req.body;
    
    if (!oldPath || !newPath) {
      res.status(400).json({
        success: false,
        error: '缺少 oldPath 或 newPath 参数',
      });
      return;
    }
    
    // 验证路径
    const oldValidation = validatePath(oldPath, projectRoot);
    const newValidation = validatePath(newPath, projectRoot);
    
    if (!oldValidation.valid) {
      res.status(400).json({
        success: false,
        error: `源路径无效: ${oldValidation.error}`,
      });
      return;
    }
    
    if (!newValidation.valid) {
      res.status(400).json({
        success: false,
        error: `目标路径无效: ${newValidation.error}`,
      });
      return;
    }
    
    // 检查源路径是否存在
    try {
      await fs.access(oldValidation.resolvedPath);
    } catch {
      res.status(404).json({
        success: false,
        error: '源路径不存在',
      });
      return;
    }
    
    // 检查目标路径是否已存在
    try {
      await fs.access(newValidation.resolvedPath);
      res.status(400).json({
        success: false,
        error: '目标路径已存在',
      });
      return;
    } catch {
      // 目标不存在，可以继续
    }
    
    // 确保目标目录存在
    const newDir = path.dirname(newValidation.resolvedPath);
    await fs.mkdir(newDir, { recursive: true });
    
    // 重命名
    await fs.rename(oldValidation.resolvedPath, newValidation.resolvedPath);
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 重命名失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '重命名失败',
    });
  }
});

/**
 * POST /api/files/delete
 * 删除文件/目录
 * 
 * Body:
 * - path: 文件或目录路径（相对）
 */
router.post('/delete', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { path: filePath } = req.body;
    
    if (!filePath) {
      res.status(400).json({
        success: false,
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(filePath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }
    
    // 检查路径是否存在
    try {
      await fs.access(validation.resolvedPath);
    } catch {
      res.status(404).json({
        success: false,
        error: '路径不存在',
      });
      return;
    }
    
    // 检查是否是目录
    const stats = await fs.stat(validation.resolvedPath);
    
    // 删除（目录使用 recursive）
    if (stats.isDirectory()) {
      await fs.rm(validation.resolvedPath, { recursive: true, force: true });
    } else {
      await fs.unlink(validation.resolvedPath);
    }
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 删除失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '删除失败',
    });
  }
});

/**
 * POST /api/files/create
 * 新建文件
 * 
 * Body:
 * - path: 文件路径（相对）
 * - content: 文件内容（可选，默认为空字符串）
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { path: filePath, content = '' } = req.body;
    
    if (!filePath) {
      res.status(400).json({
        success: false,
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(filePath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }
    
    // 检查文件是否已存在
    try {
      await fs.access(validation.resolvedPath);
      res.status(400).json({
        success: false,
        error: '文件已存在',
      });
      return;
    } catch {
      // 文件不存在，可以继续
    }
    
    // 确保目录存在
    const dirPath = path.dirname(validation.resolvedPath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // 创建文件
    await fs.writeFile(validation.resolvedPath, content, 'utf-8');
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 创建文件失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '创建文件失败',
    });
  }
});

/**
 * POST /api/files/mkdir
 * 新建目录
 * 
 * Body:
 * - path: 目录路径（相对）
 */
router.post('/mkdir', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { path: dirPath } = req.body;
    
    if (!dirPath) {
      res.status(400).json({
        success: false,
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(dirPath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }
    
    // 检查目录是否已存在
    try {
      await fs.access(validation.resolvedPath);
      res.status(400).json({
        success: false,
        error: '目录已存在',
      });
      return;
    } catch {
      // 目录不存在，可以继续
    }
    
    // 创建目录
    await fs.mkdir(validation.resolvedPath, { recursive: true });
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 创建目录失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '创建目录失败',
    });
  }
});

/**
 * POST /api/files/copy
 * 复制文件/目录
 * 
 * Body:
 * - sourcePath: 源路径（相对）
 * - destPath: 目标路径（相对）
 */
router.post('/copy', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { sourcePath, destPath } = req.body;
    
    if (!sourcePath || !destPath) {
      res.status(400).json({
        success: false,
        error: '缺少 sourcePath 或 destPath 参数',
      });
      return;
    }
    
    // 验证路径
    const sourceValidation = validatePath(sourcePath, projectRoot);
    const destValidation = validatePath(destPath, projectRoot);
    
    if (!sourceValidation.valid) {
      res.status(400).json({
        success: false,
        error: `源路径无效: ${sourceValidation.error}`,
      });
      return;
    }
    
    if (!destValidation.valid) {
      res.status(400).json({
        success: false,
        error: `目标路径无效: ${destValidation.error}`,
      });
      return;
    }
    
    // 检查源路径是否存在
    try {
      await fs.access(sourceValidation.resolvedPath);
    } catch {
      res.status(404).json({
        success: false,
        error: '源路径不存在',
      });
      return;
    }
    
    // 确保目标目录存在
    const destDir = path.dirname(destValidation.resolvedPath);
    await fs.mkdir(destDir, { recursive: true });
    
    // 复制文件/目录
    await fs.cp(sourceValidation.resolvedPath, destValidation.resolvedPath, { 
      recursive: true,
      force: false,
    });
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 复制失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '复制失败',
    });
  }
});

/**
 * POST /api/files/move
 * 移动文件/目录（剪切粘贴）
 * 
 * Body:
 * - sourcePath: 源路径（相对）
 * - destPath: 目标路径（相对）
 */
router.post('/move', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { sourcePath, destPath } = req.body;
    
    if (!sourcePath || !destPath) {
      res.status(400).json({
        success: false,
        error: '缺少 sourcePath 或 destPath 参数',
      });
      return;
    }
    
    // 验证路径
    const sourceValidation = validatePath(sourcePath, projectRoot);
    const destValidation = validatePath(destPath, projectRoot);
    
    if (!sourceValidation.valid) {
      res.status(400).json({
        success: false,
        error: `源路径无效: ${sourceValidation.error}`,
      });
      return;
    }
    
    if (!destValidation.valid) {
      res.status(400).json({
        success: false,
        error: `目标路径无效: ${destValidation.error}`,
      });
      return;
    }
    
    // 检查源路径是否存在
    try {
      await fs.access(sourceValidation.resolvedPath);
    } catch {
      res.status(404).json({
        success: false,
        error: '源路径不存在',
      });
      return;
    }
    
    // 确保目标目录存在
    const destDir = path.dirname(destValidation.resolvedPath);
    await fs.mkdir(destDir, { recursive: true });
    
    // 移动文件/目录
    await fs.rename(sourceValidation.resolvedPath, destValidation.resolvedPath);
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 移动失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '移动失败',
    });
  }
});

/**
 * POST /api/files/reveal
 * 在系统资源管理器中打开文件/目录
 * 
 * Body:
 * - path: 文件或目录路径（相对）
 */
router.post('/reveal', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { path: filePath } = req.body;
    
    if (!filePath) {
      res.status(400).json({
        success: false,
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(filePath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }
    
    // 检查路径是否存在
    try {
      await fs.access(validation.resolvedPath);
    } catch {
      res.status(404).json({
        success: false,
        error: '路径不存在',
      });
      return;
    }
    
    // 根据操作系统执行不同的命令
    const platform = process.platform;
    let command: string;
    
    if (platform === 'win32') {
      // Windows: 使用 explorer 并选中文件
      command = `explorer /select,"${validation.resolvedPath}"`;
    } else if (platform === 'darwin') {
      // macOS: 使用 open -R
      command = `open -R "${validation.resolvedPath}"`;
    } else {
      // Linux: 使用 xdg-open 打开所在目录
      const dirPath = path.dirname(validation.resolvedPath);
      command = `xdg-open "${dirPath}"`;
    }
    
    await execPromise(command);
    
    res.json({
      success: true,
    });
  } catch (error) {
    console.error('[File API] 打开资源管理器失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '打开资源管理器失败',
    });
  }
});

/**
 * GET /api/files/preview
 * 以原始内容返回 HTML 文件，用于 iframe 预览
 * 
 * Query 参数:
 * - path: 文件绝对路径或相对路径
 * - root: 项目根目录（可选）
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const queryPath = req.query.path as string;
    
    if (!queryPath) {
      res.status(400).send('缺少 path 参数');
      return;
    }

    // 只允许 .html / .htm 文件
    const ext = path.extname(queryPath).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      res.status(400).send('仅支持预览 .html / .htm 文件');
      return;
    }

    // 解析文件路径：支持绝对路径和相对路径
    let resolvedPath: string;
    if (path.isAbsolute(queryPath)) {
      resolvedPath = path.normalize(queryPath);
    } else {
      const projectRoot = getProjectRoot(req);
      const validation = validatePath(queryPath, projectRoot);
      if (!validation.valid) {
        res.status(400).send(validation.error || '路径无效');
        return;
      }
      resolvedPath = validation.resolvedPath;
    }

    // 检查文件是否存在
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        res.status(400).send('路径不是文件');
        return;
      }
    } catch {
      res.status(404).send('文件不存在');
      return;
    }

    // 读取并返回原始 HTML 内容
    const content = await fs.readFile(resolvedPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error('[File API] 预览文件失败:', error);
    res.status(500).send('预览文件失败');
  }
});

/**
 * 检查文件是否为二进制文件
 * 通过检查文件前 512 字节是否包含 \0 来判断
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = Buffer.alloc(512);
    const fd = await fs.open(filePath, 'r');
    try {
      const { bytesRead } = await fd.read(buffer, 0, 512, 0);
      const content = buffer.slice(0, bytesRead);
      // 检查是否包含空字节
      return content.includes(0);
    } finally {
      await fd.close();
    }
  } catch {
    return true; // 读取失败时视为二进制文件
  }
}

/**
 * 递归搜索文件内容
 */
async function searchInDirectory(
  dirPath: string,
  query: string,
  options: {
    isRegex: boolean;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
    includePattern?: string;
    excludePattern?: string;
  },
  projectRoot: string,
  results: SearchResult[],
  maxResults: number
): Promise<void> {
  if (results.length >= maxResults) {
    return;
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) {
        break;
      }

      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(projectRoot, entryPath);

      if (entry.isDirectory()) {
        // 跳过排除的目录
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        // 递归搜索子目录
        await searchInDirectory(entryPath, query, options, projectRoot, results, maxResults);
      } else if (entry.isFile()) {
        // 检查是否匹配 include/exclude 模式
        if (options.includePattern) {
          const includeRegex = new RegExp(options.includePattern);
          if (!includeRegex.test(relativePath)) {
            continue;
          }
        }
        if (options.excludePattern) {
          const excludeRegex = new RegExp(options.excludePattern);
          if (excludeRegex.test(relativePath)) {
            continue;
          }
        }

        // 跳过二进制文件
        if (await isBinaryFile(entryPath)) {
          continue;
        }

        // 搜索文件内容
        const matches = await searchInFile(entryPath, query, options);
        if (matches.length > 0) {
          results.push({
            file: relativePath,
            matches,
          });
        }
      }
    }
  } catch (error) {
    console.error(`[Search] 搜索目录失败: ${dirPath}`, error);
  }
}

/**
 * 在单个文件中搜索
 */
async function searchInFile(
  filePath: string,
  query: string,
  options: {
    isRegex: boolean;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
  }
): Promise<SearchMatch[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const matches: SearchMatch[] = [];

    // 构建搜索正则表达式
    let searchRegex: RegExp;
    if (options.isRegex) {
      try {
        searchRegex = new RegExp(
          query,
          options.isCaseSensitive ? 'g' : 'gi'
        );
      } catch {
        // 无效的正则表达式，返回空结果
        return [];
      }
    } else {
      // 转义特殊字符
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = options.isWholeWord
        ? `\\b${escapedQuery}\\b`
        : escapedQuery;
      searchRegex = new RegExp(
        pattern,
        options.isCaseSensitive ? 'g' : 'gi'
      );
    }

    // 逐行搜索
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineMatches = [...line.matchAll(searchRegex)];

      for (const match of lineMatches) {
        if (match.index === undefined) continue;

        const column = match.index;
        const matchText = match[0];
        const previewBefore = line.slice(Math.max(0, column - 50), column);
        const previewAfter = line.slice(column + matchText.length, column + matchText.length + 50);

        matches.push({
          line: i + 1, // 1-based line number
          column: column + 1, // 1-based column number
          length: matchText.length,
          lineContent: line,
          previewBefore,
          matchText,
          previewAfter,
        });
      }
    }

    return matches;
  } catch (error) {
    console.error(`[Search] 搜索文件失败: ${filePath}`, error);
    return [];
  }
}

/**
 * 类型定义
 */
interface SearchMatch {
  line: number;
  column: number;
  length: number;
  lineContent: string;
  previewBefore: string;
  matchText: string;
  previewAfter: string;
}

interface SearchResult {
  file: string;
  matches: SearchMatch[];
}

interface SearchRequest {
  query: string;
  root?: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  isWholeWord?: boolean;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}

interface SearchResponse {
  results: SearchResult[];
  totalMatches: number;
  truncated: boolean;
}

interface ReplaceRequest {
  file: string;
  root?: string;
  replacements: Array<{
    line: number;
    column: number;
    length: number;
    newText: string;
  }>;
}

interface ReplaceResponse {
  success: boolean;
  replacedCount: number;
}

/**
 * 使用 ripgrep 执行搜索（同步调用，避免异步开销）
 */
function searchWithRipgrep(
  rgPath: string,
  projectRoot: string,
  query: string,
  options: {
    isRegex: boolean;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
    includePattern?: string;
    excludePattern?: string;
    maxResults: number;
  }
): SearchResponse {
  const args: string[] = [
    '--json',           // JSON 输出，方便解析
    '--max-columns', '500', // 限制单行长度
  ];

  // 大小写
  if (!options.isCaseSensitive) {
    args.push('-i');
  }

  // 全词匹配
  if (options.isWholeWord) {
    args.push('-w');
  }

  // 正则 vs 固定字符串
  if (!options.isRegex) {
    args.push('-F'); // 固定字符串模式，不解析正则
  }

  // include/exclude glob 模式
  if (options.includePattern) {
    args.push('--glob', options.includePattern);
  }
  if (options.excludePattern) {
    args.push('--glob', `!${options.excludePattern}`);
  }

  // 搜索模式和路径
  args.push('--', query, '.');

  const result = spawnSync(rgPath, args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024, // 50MB
    timeout: 30000, // 30 秒超时
    windowsHide: true,
  });

  // ripgrep: 0=有匹配, 1=无匹配, 2+=错误
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`ripgrep exited with code ${result.status}: ${result.stderr}`);
  }

  if (!result.stdout || result.status === 1) {
    return { results: [], totalMatches: 0, truncated: false };
  }

  // 解析 ripgrep JSON 输出，转换为前端格式
  const fileMap = new Map<string, SearchMatch[]>();
  let totalMatches = 0;
  let truncated = false;
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    if (!line) continue;
    if (totalMatches >= options.maxResults) {
      truncated = true;
      break;
    }

    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'match') continue;

      const data = obj.data;
      const filePath = data.path.text;
      // ripgrep 用 ./ 前缀，需要去掉
      const relativePath = filePath.startsWith('./') ? filePath.slice(2) : filePath;
      // 将 posix 路径分隔符统一为系统路径
      const normalizedPath = relativePath.replace(/\//g, path.sep);
      const lineContent = (data.lines.text || '').replace(/\r?\n$/, '');
      const lineNumber = data.line_number;

      for (const sub of data.submatches || []) {
        if (totalMatches >= options.maxResults) {
          truncated = true;
          break;
        }

        const matchStart = sub.start;
        const matchEnd = sub.end;
        const matchText = lineContent.slice(matchStart, matchEnd);
        const previewBefore = lineContent.slice(Math.max(0, matchStart - 50), matchStart);
        const previewAfter = lineContent.slice(matchEnd, matchEnd + 50);

        if (!fileMap.has(normalizedPath)) {
          fileMap.set(normalizedPath, []);
        }
        fileMap.get(normalizedPath)!.push({
          line: lineNumber,
          column: matchStart + 1, // 1-based
          length: matchEnd - matchStart,
          lineContent,
          previewBefore,
          matchText,
          previewAfter,
        });
        totalMatches++;
      }
    } catch {
      // 忽略解析失败的行
    }
  }

  const results: SearchResult[] = [];
  for (const [file, matches] of fileMap) {
    results.push({ file, matches });
  }

  return { results, totalMatches, truncated };
}

/**
 * POST /api/files/search
 * 在项目中搜索文本
 * 
 * Body:
 * - query: 搜索查询字符串
 * - root: 项目根目录（可选）
 * - isRegex: 是否使用正则表达式（默认 false）
 * - isCaseSensitive: 是否区分大小写（默认 false）
 * - isWholeWord: 是否全词匹配（默认 false）
 * - includePattern: 包含文件模式（可选，正则）
 * - excludePattern: 排除文件模式（可选，正则）
 * - maxResults: 最大结果数（默认 500）
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const {
      query,
      isRegex = false,
      isCaseSensitive = false,
      isWholeWord = false,
      includePattern,
      excludePattern,
      maxResults = 500,
    } = req.body as SearchRequest;

    if (!query) {
      res.status(400).json({
        error: '缺少 query 参数',
      });
      return;
    }

    // 检查项目根目录是否存在
    try {
      await fs.access(projectRoot);
    } catch {
      res.status(404).json({
        error: '项目根目录不存在',
      });
      return;
    }

    // 尝试使用 ripgrep 加速搜索
    const rgPath = getRgPath();
    if (rgPath) {
      try {
        const rgResult = searchWithRipgrep(rgPath, projectRoot, query, {
          isRegex,
          isCaseSensitive,
          isWholeWord,
          includePattern,
          excludePattern,
          maxResults,
        });
        res.json(rgResult);
        return;
      } catch (err) {
        console.warn('[File API] ripgrep 搜索失败，降级为 JS 搜索:', err);
      }
    }

    // Fallback: 纯 JS 搜索
    const results: SearchResult[] = [];
    await searchInDirectory(
      projectRoot,
      query,
      {
        isRegex,
        isCaseSensitive,
        isWholeWord,
        includePattern,
        excludePattern,
      },
      projectRoot,
      results,
      maxResults
    );

    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
    const truncated = results.length >= maxResults;

    const response: SearchResponse = {
      results,
      totalMatches,
      truncated,
    };

    res.json(response);
  } catch (error) {
    console.error('[File API] 搜索失败:', error);
    res.status(500).json({
      error: '搜索失败',
      message: error instanceof Error ? error.message : '未知错误',
    });
  }
});

/**
 * POST /api/files/replace
 * 替换文件中的文本
 * 
 * Body:
 * - file: 文件路径（相对）
 * - root: 项目根目录（可选）
 * - replacements: 替换项数组（按行号从大到小排序）
 */
router.post('/replace', async (req: Request, res: Response) => {
  try {
    const projectRoot = getProjectRoot(req);
    const { file: filePath, replacements } = req.body as ReplaceRequest;

    if (!filePath) {
      res.status(400).json({
        success: false,
        message: '缺少 file 参数',
      });
      return;
    }

    if (!Array.isArray(replacements) || replacements.length === 0) {
      res.status(400).json({
        success: false,
        message: '缺少 replacements 参数',
      });
      return;
    }

    // 验证路径
    const validation = validatePath(filePath, projectRoot);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: validation.error,
      });
      return;
    }

    // 检查文件是否存在
    try {
      const stats = await fs.stat(validation.resolvedPath);
      if (!stats.isFile()) {
        res.status(400).json({
          success: false,
          message: '路径不是文件',
        });
        return;
      }
    } catch {
      res.status(404).json({
        success: false,
        message: '文件不存在',
      });
      return;
    }

    // 读取文件内容
    const content = await fs.readFile(validation.resolvedPath, 'utf-8');
    const lines = content.split('\n');

    // 按行号从大到小排序（避免偏移问题）
    const sortedReplacements = [...replacements].sort((a, b) => {
      if (b.line !== a.line) {
        return b.line - a.line;
      }
      return b.column - a.column;
    });

    let replacedCount = 0;

    // 执行替换
    for (const replacement of sortedReplacements) {
      const { line, column, length, newText } = replacement;
      const lineIndex = line - 1; // 转换为 0-based

      if (lineIndex < 0 || lineIndex >= lines.length) {
        continue; // 行号无效，跳过
      }

      const originalLine = lines[lineIndex];
      const columnIndex = column - 1; // 转换为 0-based

      if (columnIndex < 0 || columnIndex + length > originalLine.length) {
        continue; // 列号无效，跳过
      }

      // 执行替换
      const before = originalLine.slice(0, columnIndex);
      const after = originalLine.slice(columnIndex + length);
      lines[lineIndex] = before + newText + after;
      replacedCount++;
    }

    // 写回文件
    const newContent = lines.join('\n');
    await fs.writeFile(validation.resolvedPath, newContent, 'utf-8');

    const response: ReplaceResponse = {
      success: true,
      replacedCount,
    };

    res.json(response);
  } catch (error) {
    console.error('[File API] 替换失败:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '未知错误',
    });
  }
});

/**
 * GET /api/files/preview
 * 以原始内容返回 HTML 文件，用于 iframe 预览
 *
 * Query 参数:
 * - path: 文件绝对路径或相对路径
 * - root: 项目根目录（可选）
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const queryPath = req.query.path as string;

    if (!queryPath) {
      res.status(400).send('缺少 path 参数');
      return;
    }

    // 只允许 .html / .htm 文件
    const ext = path.extname(queryPath).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      res.status(400).send('仅支持预览 .html / .htm 文件');
      return;
    }

    // 解析文件路径：支持绝对路径和相对路径
    let resolvedPath: string;
    if (path.isAbsolute(queryPath)) {
      resolvedPath = path.normalize(queryPath);
    } else {
      const projectRoot = getProjectRoot(req);
      const validation = validatePath(queryPath, projectRoot);
      if (!validation.valid) {
        res.status(400).send(validation.error || '路径无效');
        return;
      }
      resolvedPath = validation.resolvedPath;
    }

    // 检查文件是否存在
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        res.status(400).send('路径不是文件');
        return;
      }
    } catch {
      res.status(404).send('文件不存在');
      return;
    }

    // 读取并返回原始 HTML 内容
    const content = await fs.readFile(resolvedPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error('[File API] 预览文件失败:', error);
    res.status(500).send('预览文件失败');
  }
});

/**
 * GET /api/files/download - 下载文件（二进制流）
 *
 * 支持任意文件类型的下载，返回正确的 MIME 类型和 Content-Disposition 头。
 * 可选 inline 参数控制浏览器是预览还是下载。
 *
 * Query 参数:
 * - path: 文件绝对路径或相对路径
 * - root: 项目根目录（可选）
 * - inline: 设为 "1" 时使用 inline 预览而非下载（可选）
 */
router.get('/download', async (req: Request, res: Response) => {
  try {
    const queryPath = req.query.path as string;

    if (!queryPath) {
      res.status(400).json({ error: '缺少 path 参数' });
      return;
    }

    // 解析文件路径：支持绝对路径和相对路径
    let resolvedPath: string;
    if (path.isAbsolute(queryPath)) {
      resolvedPath = path.normalize(queryPath);
    } else {
      const projectRoot = getProjectRoot(req);
      const validation = validatePath(queryPath, projectRoot);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error || '路径无效' });
        return;
      }
      resolvedPath = validation.resolvedPath;
    }

    // 检查文件是否存在
    let stats: import('fs').Stats;
    try {
      stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        res.status(400).json({ error: '路径不是文件' });
        return;
      }
    } catch {
      res.status(404).json({ error: '文件不存在' });
      return;
    }

    // MIME 类型映射
    const MIME_TYPES: Record<string, string> = {
      // 文档
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.csv': 'text/csv',
      // 图片
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      // 视频
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      // 音频
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      // 压缩包
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.7z': 'application/x-7z-compressed',
      '.rar': 'application/vnd.rar',
      // 代码/文本
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.ts': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.log': 'text/plain',
    };

    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileName = path.basename(resolvedPath);
    const isInline = req.query.inline === '1';

    // 设置响应头
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader(
      'Content-Disposition',
      isInline
        ? `inline; filename="${encodeURIComponent(fileName)}"`
        : `attachment; filename="${encodeURIComponent(fileName)}"`
    );

    // 使用流式传输
    const { createReadStream } = await import('fs');
    const stream = createReadStream(resolvedPath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[File API] 下载文件流错误:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '读取文件失败' });
      }
    });
  } catch (error) {
    console.error('[File API] 下载文件失败:', error);
    res.status(500).json({ error: '下载文件失败' });
  }
});

export default router;
