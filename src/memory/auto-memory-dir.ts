/**
 * Auto-memory 目录管理
 * 管理 ~/.axon/auto-memory/ 目录和 MEMORY.md 索引文件
 *
 * 机制：
 * 1. 存储目录: ~/.axon/auto-memory/
 * 2. 索引文件: MEMORY.md（最多加载200行）
 * 3. 主题文件: 如 debugging.md, patterns.md 等
 * 4. AI 用 Write/Edit 工具直接管理这些文件
 * 5. MEMORY.md 内容在每次对话开始时注入 system prompt
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MEMORY_INDEX_FILE = 'MEMORY.md';
const MAX_MEMORY_LINES = 200;
const MAX_MEMORY_CHAR_COUNT = 40000;

/**
 * 获取 auto-memory 目录路径
 */
export function getAutoMemoryDir(): string {
  return path.join(os.homedir(), '.axon', 'auto-memory');
}

/**
 * 获取项目级 auto-memory 目录路径
 * 使用项目路径的安全化名称作为子目录
 */
export function getProjectAutoMemoryDir(projectDir?: string): string {
  const baseDir = getAutoMemoryDir();
  if (!projectDir) return baseDir;
  const projectHash = sanitizeProjectPath(projectDir);
  return path.join(baseDir, projectHash);
}

/**
 * 确保 auto-memory 目录存在
 */
export function ensureAutoMemoryDir(dir?: string): string {
  const memDir = dir || getAutoMemoryDir();
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
  return memDir;
}

/**
 * 加载 MEMORY.md 内容（最多200行）
 * 超过200行时添加截断警告
 */
export function loadMemoryIndex(memDir?: string): string | null {
  const dir = memDir || getAutoMemoryDir();
  const indexPath = path.join(dir, MEMORY_INDEX_FILE);

  if (!fs.existsSync(indexPath)) return null;

  try {
    const content = fs.readFileSync(indexPath, 'utf-8');

    // 字符数限制检查
    if (content.length > MAX_MEMORY_CHAR_COUNT) {
      const truncated = content.slice(0, MAX_MEMORY_CHAR_COUNT);
      return truncated + `\n\n> WARNING: MEMORY.md exceeds ${MAX_MEMORY_CHAR_COUNT} characters. Only the first ${MAX_MEMORY_CHAR_COUNT} characters were loaded. Move detailed content into separate topic files and keep MEMORY.md as a concise index.`;
    }

    const lines = content.trimEnd().split('\n');

    if (lines.length > MAX_MEMORY_LINES) {
      const truncated = lines.slice(0, MAX_MEMORY_LINES).join('\n');
      return truncated + `\n\n> WARNING: MEMORY.md is ${lines.length} lines (limit: ${MAX_MEMORY_LINES}). Only the first ${MAX_MEMORY_LINES} lines were loaded. Move detailed content into separate topic files and keep MEMORY.md as a concise index.`;
    }

    return content.trim();
  } catch {
    return null;
  }
}

/**
 * 检查文件路径是否在 auto-memory 目录中
 */
export function isAutoMemoryPath(filePath: string): boolean {
  const memDir = getAutoMemoryDir();
  const resolved = path.resolve(filePath);
  return resolved.startsWith(memDir);
}

/**
 * 获取 auto-memory 目录中所有 .md 文件路径
 */
export function getAllMemoryFiles(memDir?: string): string[] {
  const dir = memDir || getAutoMemoryDir();
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

/**
 * 生成项目路径的安全目录名
 * 将路径中的特殊字符替换为安全字符
 */
function sanitizeProjectPath(projectDir: string): string {
  return projectDir
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_.]/g, '_');
}
