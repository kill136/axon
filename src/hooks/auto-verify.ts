/**
 * Auto-Verify 系统
 *
 * 追踪对话中的文件修改，在工具结果中注入精确的测试命令，
 * 引导模型主动验证变更。不自动执行测试（避免副作用）。
 *
 * 设计原则：
 * - 只追踪代码文件（.ts/.js/.py/.go/.rs/.java 等）
 * - 只在有未验证变更时注入提示
 * - 给出精确的测试命令（不是模糊建议）
 * - 每轮 API 调用最多注入一次（避免噪音）
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 常量
// ============================================================================

/** 需要追踪的代码文件扩展名 */
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java', '.kt', '.kts',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs',
  '.rb',
  '.swift',
  '.dart',
  '.vue', '.svelte',
]);

/** 测试命令检测正则（与 blueprint/autonomous-worker.ts 一致） */
const TEST_COMMAND_RE = /\b(npm\s+test|npm\s+run\s+test|npx\s+vitest|vitest|jest|pytest|go\s+test|cargo\s+test|ruby\s+-Itest|rspec|phpunit|dotnet\s+test)\b/i;

/** 测试文件名模式 */
const TEST_FILE_PATTERNS = [
  // foo.ts → foo.test.ts, foo.spec.ts (same directory)
  (name: string, ext: string, dir: string) => path.join(dir, `${name}.test${ext}`),
  (name: string, ext: string, dir: string) => path.join(dir, `${name}.spec${ext}`),
  // foo.ts → __tests__/foo.test.ts
  (name: string, ext: string, dir: string) => path.join(dir, '__tests__', `${name}.test${ext}`),
  (name: string, ext: string, dir: string) => path.join(dir, '__tests__', `${name}.spec${ext}`),
];

/** 常见项目结构：src/x.ts → tests/x.test.ts */
const MIRROR_TEST_DIRS: Array<[string, string]> = [
  ['src', 'tests'],
  ['src', 'test'],
  ['lib', 'tests'],
  ['lib', 'test'],
];

// ============================================================================
// 测试框架检测（缓存结果）
// ============================================================================

interface TestFramework {
  command: string;
  framework: string;
}

const frameworkCache = new Map<string, TestFramework | null>();

/**
 * 从 package.json / 项目配置推断测试框架和命令
 */
export function detectTestFramework(cwd: string): TestFramework | null {
  const cached = frameworkCache.get(cwd);
  if (cached !== undefined) return cached;

  let result: TestFramework | null = null;

  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };

      if (deps.vitest || scripts.test?.includes('vitest')) {
        result = { command: 'npx vitest', framework: 'vitest' };
      } else if (deps.jest || scripts.test?.includes('jest')) {
        result = { command: 'npx jest', framework: 'jest' };
      } else if (scripts.test) {
        result = { command: 'npm test', framework: 'npm' };
      }
    }
  } catch { /* ignore */ }

  // Python
  if (!result) {
    try {
      if (fs.existsSync(path.join(cwd, 'pytest.ini')) ||
          fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
          fs.existsSync(path.join(cwd, 'setup.cfg'))) {
        result = { command: 'pytest', framework: 'pytest' };
      }
    } catch { /* ignore */ }
  }

  // Go
  if (!result) {
    try {
      if (fs.existsSync(path.join(cwd, 'go.mod'))) {
        result = { command: 'go test ./...', framework: 'go' };
      }
    } catch { /* ignore */ }
  }

  // Rust
  if (!result) {
    try {
      if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
        result = { command: 'cargo test', framework: 'cargo' };
      }
    } catch { /* ignore */ }
  }

  frameworkCache.set(cwd, result);
  return result;
}

// ============================================================================
// 测试文件发现
// ============================================================================

/**
 * 找到与源文件对应的测试文件
 */
export function findRelatedTests(filePath: string, cwd: string): string[] {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const found: string[] = [];

  // 如果文件本身就是测试文件，返回自身
  if (base.endsWith('.test') || base.endsWith('.spec') || dir.includes('__tests__')) {
    return [filePath];
  }

  // 同目录模式
  for (const pattern of TEST_FILE_PATTERNS) {
    const candidate = pattern(base, ext, dir);
    if (fs.existsSync(candidate)) {
      found.push(path.relative(cwd, candidate));
    }
  }

  // 镜像目录模式：src/foo/bar.ts → tests/foo/bar.test.ts
  const relPath = path.relative(cwd, filePath);
  const parts = relPath.split(path.sep);
  for (const [srcDir, testDir] of MIRROR_TEST_DIRS) {
    if (parts[0] === srcDir) {
      const testRelParts = [testDir, ...parts.slice(1)];
      const testBase = path.basename(testRelParts[testRelParts.length - 1], ext);
      testRelParts[testRelParts.length - 1] = `${testBase}.test${ext}`;
      const candidate = path.join(cwd, ...testRelParts);
      if (fs.existsSync(candidate)) {
        found.push(path.join(...testRelParts));
      }
    }
  }

  return found;
}

// ============================================================================
// ChangeTracker
// ============================================================================

interface FileChange {
  tool: 'Edit' | 'Write';
  timestamp: number;
}

/**
 * 变更追踪器
 * 
 * 每个会话实例持有一个 tracker，记录当前对话中修改了哪些代码文件，
 * 以及哪些文件已通过测试验证。
 */
export class ChangeTracker {
  /** 被修改的代码文件 → 修改信息 */
  private modifiedFiles = new Map<string, FileChange>();

  /** 已验证的文件集合（运行过相关测试的文件） */
  private verifiedFiles = new Set<string>();

  /** 本轮 API 调用是否已注入过提示（避免重复注入） */
  private hintInjectedThisTurn = false;

  /**
   * 记录文件变更
   * 只追踪代码文件扩展名
   */
  trackChange(filePath: string, tool: 'Edit' | 'Write'): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) return;

    this.modifiedFiles.set(path.resolve(filePath), {
      tool,
      timestamp: Date.now(),
    });
  }

  /**
   * 记录验证（检测到 Bash 执行了测试命令）
   */
  trackVerification(command: string): void {
    if (TEST_COMMAND_RE.test(command)) {
      // 测试命令执行 = 所有当前变更视为已验证
      for (const filePath of this.modifiedFiles.keys()) {
        this.verifiedFiles.add(filePath);
      }
    }
  }

  /**
   * 获取未验证的变更文件列表
   */
  getUnverifiedChanges(): string[] {
    const unverified: string[] = [];
    for (const filePath of this.modifiedFiles.keys()) {
      if (!this.verifiedFiles.has(filePath)) {
        unverified.push(filePath);
      }
    }
    return unverified;
  }

  /**
   * 生成验证提示
   * 返回 null 表示不需要注入
   */
  generateHint(cwd: string): string | null {
    // 已经注入过本轮提示
    if (this.hintInjectedThisTurn) return null;

    const unverified = this.getUnverifiedChanges();
    // 少于 2 个未验证文件不提示（单文件修改通常是小改动）
    if (unverified.length < 2) return null;

    const framework = detectTestFramework(cwd);
    if (!framework) return null;

    // 找到相关测试文件
    const testFiles: string[] = [];
    for (const file of unverified) {
      const related = findRelatedTests(file, cwd);
      for (const t of related) {
        if (!testFiles.includes(t)) testFiles.push(t);
      }
    }

    // 构建精确命令
    let command: string;
    if (testFiles.length > 0 && framework.framework === 'vitest') {
      command = `npx vitest ${testFiles.join(' ')} --run`;
    } else if (testFiles.length > 0 && framework.framework === 'jest') {
      command = `npx jest ${testFiles.join(' ')}`;
    } else {
      command = framework.command;
    }

    const fileList = unverified
      .map(f => path.relative(cwd, f))
      .join(', ');

    this.hintInjectedThisTurn = true;

    const parts = [
      `You have ${unverified.length} unverified code changes: ${fileList}.`,
    ];

    if (testFiles.length > 0) {
      parts.push(`Related tests: ${testFiles.join(', ')}.`);
    }

    parts.push(`Verify: \`${command}\``);

    return parts.join(' ');
  }

  /**
   * 重置本轮注入标记（每轮 API 调用开始时调用）
   */
  resetTurnFlag(): void {
    this.hintInjectedThisTurn = false;
  }

  /**
   * 获取统计
   */
  getStats(): { modified: number; verified: number; unverified: number } {
    const unverified = this.getUnverifiedChanges();
    return {
      modified: this.modifiedFiles.size,
      verified: this.verifiedFiles.size,
      unverified: unverified.length,
    };
  }

  /**
   * 完全重置（会话结束时）
   */
  reset(): void {
    this.modifiedFiles.clear();
    this.verifiedFiles.clear();
    this.hintInjectedThisTurn = false;
  }
}

// ============================================================================
// 全局单例（按会话隔离）
// ============================================================================

const trackers = new Map<string, ChangeTracker>();

/**
 * 获取或创建会话级的 ChangeTracker
 */
export function getChangeTracker(sessionId: string): ChangeTracker {
  let tracker = trackers.get(sessionId);
  if (!tracker) {
    tracker = new ChangeTracker();
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

/**
 * 清理会话 tracker
 */
export function removeChangeTracker(sessionId: string): void {
  trackers.delete(sessionId);
}

/**
 * 清空框架检测缓存（测试用）
 */
export function clearFrameworkCache(): void {
  frameworkCache.clear();
}
