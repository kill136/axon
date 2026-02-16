/**
 * 文件操作 API 路由
 * 
 * 提供安全的文件系统访问接口：
 * - GET /api/files/tree - 获取目录树
 * - GET /api/files/read - 读取文件内容
 * - PUT /api/files/write - 写入文件内容
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

// 项目根目录
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

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
function validatePath(filePath: string): { valid: boolean; resolvedPath: string; error?: string } {
  try {
    // 解析绝对路径
    const resolvedPath = path.resolve(PROJECT_ROOT, filePath);
    
    // 计算相对路径
    const relativePath = path.relative(PROJECT_ROOT, resolvedPath);
    
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
  maxDepth: number
): Promise<FileTreeNode | null> {
  try {
    const stats = await fs.stat(dirPath);
    const name = path.basename(dirPath);
    const relativePath = path.relative(PROJECT_ROOT, dirPath);
    
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
        const childNode = await getDirectoryTree(entryPath, currentDepth + 1, maxDepth);
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
    const queryPath = (req.query.path as string) || '.';
    const depth = Math.min(Math.max(parseInt(req.query.depth as string) || 3, 1), 5);
    
    // 验证路径
    const validation = validatePath(queryPath);
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
    const tree = await getDirectoryTree(validation.resolvedPath, 0, depth);
    
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
    const queryPath = req.query.path as string;
    
    if (!queryPath) {
      res.status(400).json({
        error: '缺少 path 参数',
      });
      return;
    }
    
    // 验证路径
    const validation = validatePath(queryPath);
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
    const validation = validatePath(filePath);
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

export default router;
