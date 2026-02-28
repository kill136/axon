/**
 * 统一输出持久化模块
 * 用于处理工具输出过大时的磁盘持久化
 *
 * 对应官方 2.1.2 版本的输出管理机制
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * 输出持久化选项
 */
export interface OutputPersistenceOptions {
  /** 最大输出长度（字节），超过则持久化。默认 30000 */
  maxLength?: number;
  /** 工具名称，用于文件命名 */
  toolName: string;
  /** 可选的时间戳 */
  timestamp?: string;
  /** 可选的会话 ID */
  sessionId?: string;
  /** 是否保留头尾内容（默认 true） */
  keepHeadTail?: boolean;
  /** 保留头部字符数（默认 1000） */
  headChars?: number;
  /** 保留尾部字符数（默认 1000） */
  tailChars?: number;
}

/**
 * 持久化结果
 */
export interface PersistenceResult {
  /** 返回给 Claude 的内容（可能是截断的） */
  content: string;
  /** 如果持久化了，这是文件路径 */
  filePath?: string;
  /** 原始内容的长度 */
  originalLength: number;
  /** 是否被持久化 */
  persisted: boolean;
}

// 默认配置
const DEFAULT_MAX_LENGTH = parseInt(process.env.TOOL_OUTPUT_MAX_LENGTH || '30000', 10);
const DEFAULT_HEAD_CHARS = 1000;
const DEFAULT_TAIL_CHARS = 1000;
const OUTPUT_DIR_NAME = 'tasks'; // 使用与 Bash 一致的目录名
const MAX_FILE_AGE_DAYS = 7; // 文件最大保留天数

/**
 * 获取输出目录路径
 */
export function getOutputDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const outputDir = path.join(homeDir, '.axon', OUTPUT_DIR_NAME);

  // 确保目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return outputDir;
}

/**
 * 生成输出文件路径
 */
function generateOutputFilePath(toolName: string): string {
  const outputDir = getOutputDir();
  const uuid = uuidv4();
  const sanitizedToolName = toolName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = `${sanitizedToolName}-${uuid}.txt`;
  return path.join(outputDir, filename);
}

/**
 * 清理过期的输出文件
 * 删除超过 MAX_FILE_AGE_DAYS 天的文件
 */
export function cleanupOldOutputFiles(): number {
  try {
    const outputDir = getOutputDir();
    const files = fs.readdirSync(outputDir);
    const now = Date.now();
    const maxAge = MAX_FILE_AGE_DAYS * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const file of files) {
      // 跳过 .log 文件（这些是 Bash 后台任务的输出）
      if (file.endsWith('.log')) {
        continue;
      }

      const filePath = path.join(outputDir, file);
      try {
        const stat = fs.statSync(filePath);

        // 跳过目录，只清理文件
        if (stat.isDirectory()) {
          continue;
        }

        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (err) {
        // 忽略单个文件的错误
        console.error(`Failed to clean up file ${file}:`, err);
      }
    }

    return cleaned;
  } catch (err) {
    console.error('Failed to cleanup old output files:', err);
    return 0;
  }
}

/**
 * 将输出保存到文件
 */
async function saveOutputToFile(output: string, toolName: string): Promise<string> {
  const filePath = generateOutputFilePath(toolName);

  await fs.promises.writeFile(filePath, output, 'utf-8');

  return filePath;
}

/**
 * 生成截断的内容，保留头尾
 */
function createTruncatedContent(
  output: string,
  filePath: string,
  headChars: number,
  tailChars: number
): string {
  const head = output.substring(0, headChars);
  const tail = output.substring(output.length - tailChars);
  const omittedChars = output.length - headChars - tailChars;
  const omittedLines = output.substring(headChars, output.length - tailChars).split('\n').length;

  return `${head}

... [Output saved to disk: ${filePath}]
... [${omittedChars} characters (approximately ${omittedLines} lines) omitted]
... [Use the file path above to access the full output if needed]

${tail}`;
}

/**
 * 持久化大输出
 *
 * @param output 原始输出内容
 * @param options 持久化选项
 * @returns 持久化结果，包含返回内容和文件路径
 */
export async function persistLargeOutput(
  output: string,
  options: OutputPersistenceOptions
): Promise<PersistenceResult> {
  const {
    maxLength = DEFAULT_MAX_LENGTH,
    toolName,
    keepHeadTail = true,
    headChars = DEFAULT_HEAD_CHARS,
    tailChars = DEFAULT_TAIL_CHARS,
  } = options;

  const originalLength = output.length;

  // 如果输出小于阈值，直接返回
  if (originalLength <= maxLength) {
    return {
      content: output,
      originalLength,
      persisted: false,
    };
  }

  try {
    // 清理旧文件（异步执行，不阻塞）
    cleanupOldOutputFiles();

    // 保存到磁盘
    const filePath = await saveOutputToFile(output, toolName);

    // 生成截断的内容
    let content: string;
    if (keepHeadTail) {
      content = createTruncatedContent(output, filePath, headChars, tailChars);
    } else {
      // 简单截断
      content = output.substring(0, maxLength) + `\n\n... [Output truncated and saved to: ${filePath}]`;
    }

    return {
      content,
      filePath,
      originalLength,
      persisted: true,
    };
  } catch (err) {
    // 如果持久化失败，降级到简单截断
    console.error(`Failed to persist output for tool ${toolName}:`, err);
    return {
      content: output.substring(0, maxLength) + '\n\n... [Output truncated due to size]',
      originalLength,
      persisted: false,
    };
  }
}

/**
 * 同步版本的持久化（用于无法使用 async 的场景）
 */
export function persistLargeOutputSync(
  output: string,
  options: OutputPersistenceOptions
): PersistenceResult {
  const {
    maxLength = DEFAULT_MAX_LENGTH,
    toolName,
    keepHeadTail = true,
    headChars = DEFAULT_HEAD_CHARS,
    tailChars = DEFAULT_TAIL_CHARS,
  } = options;

  const originalLength = output.length;

  // 如果输出小于阈值，直接返回
  if (originalLength <= maxLength) {
    return {
      content: output,
      originalLength,
      persisted: false,
    };
  }

  try {
    // 清理旧文件（同步版本）
    cleanupOldOutputFiles();

    // 保存到磁盘（同步）
    const filePath = generateOutputFilePath(toolName);
    fs.writeFileSync(filePath, output, 'utf-8');

    // 生成截断的内容
    let content: string;
    if (keepHeadTail) {
      content = createTruncatedContent(output, filePath, headChars, tailChars);
    } else {
      // 简单截断
      content = output.substring(0, maxLength) + `\n\n... [Output truncated and saved to: ${filePath}]`;
    }

    return {
      content,
      filePath,
      originalLength,
      persisted: true,
    };
  } catch (err) {
    // 如果持久化失败，降级到简单截断
    console.error(`Failed to persist output for tool ${toolName}:`, err);
    return {
      content: output.substring(0, maxLength) + '\n\n... [Output truncated due to size]',
      originalLength,
      persisted: false,
    };
  }
}

/**
 * 读取已持久化的输出文件
 */
export async function readPersistedOutput(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read persisted output from ${filePath}: ${err}`);
  }
}

/**
 * 获取输出目录的统计信息
 */
export function getOutputDirStats(): {
  totalFiles: number;
  totalSize: number;
  oldestFile: string | null;
  newestFile: string | null;
} {
  try {
    const outputDir = getOutputDir();
    const files = fs.readdirSync(outputDir);

    let totalSize = 0;
    let oldestTime = Infinity;
    let newestTime = 0;
    let oldestFile: string | null = null;
    let newestFile: string | null = null;

    for (const file of files) {
      // 跳过 .log 文件
      if (file.endsWith('.log')) {
        continue;
      }

      const filePath = path.join(outputDir, file);
      try {
        const stat = fs.statSync(filePath);
        totalSize += stat.size;

        if (stat.mtimeMs < oldestTime) {
          oldestTime = stat.mtimeMs;
          oldestFile = file;
        }
        if (stat.mtimeMs > newestTime) {
          newestTime = stat.mtimeMs;
          newestFile = file;
        }
      } catch (err) {
        // 忽略单个文件的错误
      }
    }

    return {
      totalFiles: files.filter(f => !f.endsWith('.log')).length,
      totalSize,
      oldestFile,
      newestFile,
    };
  } catch (err) {
    return {
      totalFiles: 0,
      totalSize: 0,
      oldestFile: null,
      newestFile: null,
    };
  }
}
