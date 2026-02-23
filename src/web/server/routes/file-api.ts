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
    return path.normalize(root);
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

export default router;
