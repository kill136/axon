/**
 * Vendored Ripgrep 支持
 * 提供内置的 ripgrep 二进制文件支持
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawn, SpawnOptions } from 'child_process';
import { escapePathForShell, isWindows } from '../utils/platform.js';

// ES module 兼容性：获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ripgrep 版本
const RG_VERSION = '14.1.0';

// 平台到 vendor 子目录的映射（对齐官方目录结构：vendor/ripgrep/{arch}-{platform}/rg[.exe]）
const PLATFORM_VENDOR_DIR: Record<string, string> = {
  'darwin-x64': 'x64-darwin',
  'darwin-arm64': 'arm64-darwin',
  'linux-x64': 'x64-linux',
  'linux-arm64': 'arm64-linux',
  'win32-x64': 'x64-win32',
};

// 下载 URL 模板
const DOWNLOAD_BASE = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}`;

export interface RipgrepOptions {
  cwd?: string;
  pattern: string;
  paths?: string[];
  glob?: string;
  type?: string;
  ignoreCase?: boolean;
  fixedStrings?: boolean;
  maxCount?: number;
  context?: number;
  beforeContext?: number;
  afterContext?: number;
  filesWithMatches?: boolean;
  count?: boolean;
  json?: boolean;
  noIgnore?: boolean;
  hidden?: boolean;
  multiline?: boolean;
  timeout?: number;
}

export interface RipgrepMatch {
  path: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  filesSearched: number;
  matchCount: number;
  truncated: boolean;
}

/**
 * 获取 vendored ripgrep 路径
 * 对齐官方 or1 函数的路径解析逻辑
 */
export function getVendoredRgPath(): string | null {
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;

  const vendorSubDir = PLATFORM_VENDOR_DIR[key];
  if (!vendorSubDir) {
    return null;
  }

  // 官方逻辑：path.resolve(__dirname, "../", "vendor", "ripgrep")
  // 然后 Windows: path.resolve(vendorDir, "x64-win32", "rg.exe")
  // 其他:         path.resolve(vendorDir, `${arch}-${platform}`, "rg")
  const rgBinary = platform === 'win32' ? 'rg.exe' : 'rg';

  // 检查多个可能的位置
  const possiblePaths = [
    // 官方 vendor 目录结构（从 dist/search/ 往上两级到项目根，再到 node_modules 中的官方包）
    path.resolve(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'vendor', 'ripgrep', vendorSubDir, rgBinary),
    // 项目自身的 vendor 目录（如果将来自己打包 rg）
    path.resolve(__dirname, '..', '..', 'vendor', 'ripgrep', vendorSubDir, rgBinary),
    // 全局安装目录
    path.join(os.homedir(), '.claude', 'bin', rgBinary),
  ];

  for (const rgPath of possiblePaths) {
    if (fs.existsSync(rgPath)) {
      return rgPath;
    }
  }

  return null;
}

/**
 * 获取系统 ripgrep 路径
 */
export function getSystemRgPath(): string | null {
  try {
    const result = execSync('which rg 2>/dev/null || where rg 2>/dev/null', {
      encoding: 'utf-8',
    });
    return result.trim().split('\n')[0];
  } catch {
    return null;
  }
}

/**
 * 检查是否应该使用系统 ripgrep
 * 当 USE_BUILTIN_RIPGREP 环境变量设置为真值时，使用系统 ripgrep
 */
function shouldUseSystemRipgrep(): boolean {
  const env = process.env.USE_BUILTIN_RIPGREP;
  if (!env) return false;

  // 检查是否为真值（'1', 'true', 'yes' 等）
  const truthyValues = ['1', 'true', 'yes', 'on'];
  return truthyValues.includes(env.toLowerCase());
}

/**
 * 获取可用的 ripgrep 路径
 * 根据 USE_BUILTIN_RIPGREP 环境变量决定使用系统还是内置版本
 */
export function getRgPath(): string | null {
  // 如果设置了 USE_BUILTIN_RIPGREP 环境变量，优先使用系统版本
  if (shouldUseSystemRipgrep()) {
    const system = getSystemRgPath();
    if (system) return system;

    // 如果系统版本不可用，回退到 vendored 版本
    return getVendoredRgPath();
  }

  // 默认优先使用 vendored 版本
  const vendored = getVendoredRgPath();
  if (vendored) return vendored;

  // 回退到系统版本
  return getSystemRgPath();
}

/**
 * 检查 ripgrep 是否可用
 */
export function isRipgrepAvailable(): boolean {
  return getRgPath() !== null;
}

/**
 * 获取 ripgrep 版本
 */
export function getRipgrepVersion(): string | null {
  const rgPath = getRgPath();
  if (!rgPath) return null;

  try {
    const result = execSync(`"${rgPath}" --version`, { encoding: 'utf-8' });
    const match = result.match(/ripgrep\s+([\d.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 构建 ripgrep 命令参数
 */
function buildRgArgs(options: RipgrepOptions): string[] {
  const args: string[] = [];

  // 基本模式
  if (options.fixedStrings) {
    args.push('-F');
  }

  if (options.ignoreCase) {
    args.push('-i');
  }

  if (options.multiline) {
    args.push('-U', '--multiline-dotall');
  }

  // 输出格式
  if (options.json) {
    args.push('--json');
  } else {
    args.push('--line-number', '--column');
  }

  // 过滤
  if (options.glob) {
    args.push('--glob', options.glob);
  }

  if (options.type) {
    args.push('--type', options.type);
  }

  if (options.noIgnore) {
    args.push('--no-ignore');
  }

  if (options.hidden) {
    args.push('--hidden');
  }

  // 输出限制
  if (options.maxCount) {
    args.push('--max-count', String(options.maxCount));
  }

  if (options.filesWithMatches) {
    args.push('--files-with-matches');
  }

  if (options.count) {
    args.push('--count');
  }

  // 上下文
  if (options.context) {
    args.push('-C', String(options.context));
  } else {
    if (options.beforeContext) {
      args.push('-B', String(options.beforeContext));
    }
    if (options.afterContext) {
      args.push('-A', String(options.afterContext));
    }
  }

  // 搜索模式
  args.push('--', options.pattern);

  // 搜索路径
  if (options.paths && options.paths.length > 0) {
    args.push(...options.paths);
  } else {
    args.push('.');
  }

  return args;
}

/**
 * 执行 ripgrep 搜索
 */
export async function search(options: RipgrepOptions): Promise<RipgrepResult> {
  const rgPath = getRgPath();
  if (!rgPath) {
    throw new Error('ripgrep is not available');
  }

  const args = buildRgArgs({ ...options, json: true });

  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 60000,
    };

    const child = spawn(rgPath, args, spawnOptions);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // ripgrep 返回 1 表示没有匹配，这不是错误
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = parseJsonOutput(stdout);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 解析 JSON 输出
 */
function parseJsonOutput(output: string): RipgrepResult {
  const matches: RipgrepMatch[] = [];
  const files = new Set<string>();
  let matchCount = 0;

  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'match') {
        const data = obj.data;
        files.add(data.path.text);

        for (const subMatch of data.submatches || []) {
          matches.push({
            path: data.path.text,
            lineNumber: data.line_number,
            lineContent: data.lines.text.replace(/\n$/, ''),
            matchStart: subMatch.start,
            matchEnd: subMatch.end,
          });
          matchCount++;
        }
      }
    } catch {
      // 忽略解析错误的行
    }
  }

  return {
    matches,
    filesSearched: files.size,
    matchCount,
    truncated: false,
  };
}

/**
 * 同步搜索（简化版）
 */
export function searchSync(options: RipgrepOptions): string {
  const rgPath = getRgPath();
  if (!rgPath) {
    throw new Error('ripgrep is not available');
  }

  const args = buildRgArgs(options);

  try {
    const result = execSync(`"${rgPath}" ${args.map(a => `"${a}"`).join(' ')}`, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: options.timeout || 60000,
    });
    return result;
  } catch (err: any) {
    // ripgrep 返回 1 表示没有匹配
    if (err.status === 1) {
      return '';
    }
    throw err;
  }
}

/**
 * 列出文件（使用 rg --files）
 */
export async function listFiles(options: {
  cwd?: string;
  glob?: string;
  type?: string;
  hidden?: boolean;
  noIgnore?: boolean;
}): Promise<string[]> {
  const rgPath = getRgPath();
  if (!rgPath) {
    throw new Error('ripgrep is not available');
  }

  const args: string[] = ['--files'];

  if (options.glob) {
    args.push('--glob', options.glob);
  }

  if (options.type) {
    args.push('--type', options.type);
  }

  if (options.hidden) {
    args.push('--hidden');
  }

  if (options.noIgnore) {
    args.push('--no-ignore');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, {
      cwd: options.cwd || process.cwd(),
    });

    let stdout = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep failed with code ${code}`));
        return;
      }

      const files = stdout.trim().split('\n').filter(Boolean);
      resolve(files);
    });

    child.on('error', reject);
  });
}

/**
 * 下载 vendored ripgrep（供安装脚本使用）
 */
export async function downloadVendoredRg(targetDir: string): Promise<string> {
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;

  const vendorSubDir = PLATFORM_VENDOR_DIR[key];
  if (!vendorSubDir) {
    throw new Error(`Unsupported platform: ${key}`);
  }

  const rgBinary = platform === 'win32' ? 'rg.exe' : 'rg';

  // 构建下载 URL
  let archiveName: string;
  if (platform === 'win32') {
    archiveName = `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`;
  } else if (platform === 'darwin') {
    archiveName = `ripgrep-${RG_VERSION}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`;
  } else {
    archiveName = `ripgrep-${RG_VERSION}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl.tar.gz`;
  }

  const downloadUrl = `${DOWNLOAD_BASE}/${archiveName}`;
  const rgDir = path.join(targetDir, vendorSubDir);
  const targetPath = path.join(rgDir, rgBinary);

  // 确保目录存在
  if (!fs.existsSync(rgDir)) {
    fs.mkdirSync(rgDir, { recursive: true });
  }

  console.log(`Downloading ripgrep from ${downloadUrl}...`);

  // 使用 curl 或 wget 下载
  try {
    if (platform === 'win32') {
      // Windows: 使用 PowerShell
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${targetPath}.zip'"`,
        { encoding: 'utf-8' }
      );
      execSync(
        `powershell -Command "Expand-Archive -Path '${targetPath}.zip' -DestinationPath '${targetDir}'"`,
        { encoding: 'utf-8' }
      );
    } else {
      // Unix: 使用 curl + tar
      // 使用 escapePathForShell 确保路径在 shell 中是安全的（尽管 Unix 上通常没问题）
      const tempFile = path.join(os.tmpdir(), archiveName);
      const safeTempFile = escapePathForShell(tempFile);
      const safeTargetDir = escapePathForShell(targetDir);
      execSync(`curl -L -o "${safeTempFile}" "${downloadUrl}"`, { encoding: 'utf-8' });
      execSync(`tar -xzf "${safeTempFile}" -C "${safeTargetDir}" --strip-components=1`, { encoding: 'utf-8' });
      fs.unlinkSync(tempFile);

      // 重命名并设置权限
      const extractedBinary = path.join(targetDir, 'rg');
      if (fs.existsSync(extractedBinary)) {
        fs.renameSync(extractedBinary, targetPath);
        fs.chmodSync(targetPath, 0o755);
      }
    }

    console.log(`Ripgrep installed to ${targetPath}`);
    return targetPath;
  } catch (err) {
    throw new Error(`Failed to download ripgrep: ${err}`);
  }
}
