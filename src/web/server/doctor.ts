/**
 * WebUI 诊断工具 (Doctor)
 * 用于检查系统状态和配置
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { detectProvider, validateProviderConfig } from '../../providers/index.js';
import {
  permissionRuleManager,
  formatRule,
  formatRuleSource,
} from '../../permissions/rule-parser.js';

/**
 * 单个诊断检查结果
 */
export interface DiagnosticResult {
  category: string;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
  fix?: string;
}

/**
 * 完整诊断报告
 */
export interface DoctorReport {
  timestamp: Date;
  results: DiagnosticResult[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
  };
  systemInfo?: {
    version: string;
    platform: string;
    nodeVersion: string;
    memory: {
      total: string;
      free: string;
      used: string;
      percentUsed: number;
    };
    cpu: {
      model: string;
      cores: number;
      loadAverage: number[];
    };
  };
}

/**
 * 诊断选项
 */
export interface DiagnosticsOptions {
  verbose?: boolean;
  includeSystemInfo?: boolean;
}

/**
 * 运行所有诊断检查
 */
export async function runDiagnostics(options: DiagnosticsOptions = {}): Promise<DoctorReport> {
  const results: DiagnosticResult[] = [];

  // 环境检查
  results.push(await checkNodeVersion());
  results.push(await checkNpmVersion());
  results.push(await checkGitAvailability());

  // 认证和API检查
  results.push(await checkApiKey());
  results.push(await checkApiConnectivity());

  // 文件系统检查
  results.push(await checkWorkingDirectory());
  results.push(await checkSessionDirectory());
  results.push(await checkFilePermissions());

  // 配置检查
  results.push(await checkConfigurationFiles());

  // 权限规则检查
  results.push(await checkPermissionRules());

  // 网络检查
  results.push(await checkNetworkConnectivity());

  // 性能检查
  if (options.verbose) {
    results.push(await checkMemoryUsage());
    results.push(await checkDiskSpace());
  }

  // 计算摘要
  const summary = {
    passed: results.filter(r => r.status === 'pass').length,
    warnings: results.filter(r => r.status === 'warn').length,
    failed: results.filter(r => r.status === 'fail').length,
  };

  // 系统信息
  const systemInfo = options.includeSystemInfo || options.verbose ? {
    version: getVersion(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    memory: getMemoryInfo(),
    cpu: getCPUInfo(),
  } : undefined;

  return {
    timestamp: new Date(),
    results,
    summary,
    systemInfo,
  };
}

/**
 * 检查 Node.js 版本
 */
async function checkNodeVersion(): Promise<DiagnosticResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);

  if (major >= 20) {
    return {
      category: 'Environment',
      name: 'Node.js Version',
      status: 'pass',
      message: `Node.js ${version} installed`,
    };
  } else if (major >= 18) {
    return {
      category: 'Environment',
      name: 'Node.js Version',
      status: 'warn',
      message: `Node.js ${version} available, but 20+ is recommended`,
      fix: 'Upgrade to Node.js 20+: nvm install 20 && nvm use 20',
    };
  } else {
    return {
      category: 'Environment',
      name: 'Node.js Version',
      status: 'fail',
      message: `Node.js ${version} is too old`,
      details: 'Please upgrade to Node.js 20 or higher',
      fix: 'Install Node.js 20+: https://nodejs.org/',
    };
  }
}

/**
 * 检查 npm 版本
 */
async function checkNpmVersion(): Promise<DiagnosticResult> {
  return new Promise((resolve) => {
    child_process.exec('npm --version', (error, stdout) => {
      if (error) {
        resolve({
          category: 'Environment',
          name: 'npm',
          status: 'warn',
          message: 'npm not found',
          details: 'npm is usually installed with Node.js',
          fix: 'Reinstall Node.js from https://nodejs.org/',
        });
      } else {
        const version = stdout.trim();
        resolve({
          category: 'Environment',
          name: 'npm',
          status: 'pass',
          message: `npm ${version}`,
        });
      }
    });
  });
}

/**
 * 检查 Git 可用性
 */
async function checkGitAvailability(): Promise<DiagnosticResult> {
  return new Promise((resolve) => {
    child_process.exec('git --version', (error, stdout) => {
      if (error) {
        resolve({
          category: 'Environment',
          name: 'Git',
          status: 'warn',
          message: 'Git not found',
          details: 'Some features may not work',
          fix: 'Install Git: https://git-scm.com/',
        });
      } else {
        resolve({
          category: 'Environment',
          name: 'Git',
          status: 'pass',
          message: stdout.trim(),
        });
      }
    });
  });
}

/**
 * 检查 API 密钥配置
 */
async function checkApiKey(): Promise<DiagnosticResult> {
  const provider = detectProvider();
  const validation = validateProviderConfig(provider);

  if (validation.valid) {
    return {
      category: 'API',
      name: 'API Key',
      status: 'pass',
      message: `${provider.type} authentication configured`,
    };
  } else {
    return {
      category: 'API',
      name: 'API Key',
      status: 'fail',
      message: 'Authentication not configured',
      details: validation.errors.join('; '),
      fix: 'Set environment variable ANTHROPIC_API_KEY or AXON_API_KEY',
    };
  }
}

/**
 * 检查 API 连接性
 */
async function checkApiConnectivity(): Promise<DiagnosticResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'OPTIONS',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok || response.status === 405) {
      return {
        category: 'API',
        name: 'API Connection',
        status: 'pass',
        message: 'Anthropic API is accessible',
      };
    } else {
      return {
        category: 'API',
        name: 'API Connection',
        status: 'warn',
        message: `API response status ${response.status}`,
      };
    }
  } catch (err: any) {
    return {
      category: 'API',
      name: 'API Connection',
      status: 'fail',
      message: 'Unable to access Anthropic API',
      details: err.message || String(err),
      fix: 'Check network connection and firewall settings',
    };
  }
}

/**
 * 检查工作目录权限
 */
async function checkWorkingDirectory(): Promise<DiagnosticResult> {
  try {
    const cwd = process.cwd();

    // 检查可读性
    fs.accessSync(cwd, fs.constants.R_OK);

    // 尝试写入测试文件
    const testFile = path.join(cwd, '.claude-write-test');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      return {
        category: 'Filesystem',
        name: 'Working Directory',
        status: 'pass',
        message: `Directory is readable and writable: ${cwd}`,
      };
    } catch {
      return {
        category: 'Filesystem',
        name: 'Working Directory',
        status: 'warn',
        message: 'Directory is readable but not writable',
        details: `Path: ${cwd}`,
      };
    }
  } catch (err) {
    return {
      category: 'Filesystem',
      name: 'Working Directory',
      status: 'fail',
      message: 'Unable to access working directory',
      details: String(err),
    };
  }
}

/**
 * 检查会话目录
 */
async function checkSessionDirectory(): Promise<DiagnosticResult> {
  const sessionDir = path.join(os.homedir(), '.axon', 'sessions');

  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // 统计会话文件
    const files = fs.readdirSync(sessionDir);
    const sessionFiles = files.filter(f => f.endsWith('.jsonl'));

    // 计算总大小
    let totalSize = 0;
    for (const file of files) {
      const stats = fs.statSync(path.join(sessionDir, file));
      totalSize += stats.size;
    }

    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    return {
      category: 'Filesystem',
      name: 'Session Directory',
      status: 'pass',
      message: `${sessionFiles.length} sessions, ${sizeMB} MB`,
      details: `Path: ${sessionDir}`,
    };
  } catch (err) {
    return {
      category: 'Filesystem',
      name: 'Session Directory',
      status: 'fail',
      message: 'Unable to access session directory',
      details: String(err),
      fix: `Ensure ${sessionDir} directory is writable`,
    };
  }
}

/**
 * 检查文件权限
 */
async function checkFilePermissions(): Promise<DiagnosticResult> {
  const claudeDir = path.join(os.homedir(), '.axon');
  const issues: string[] = [];

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // 尝试写入测试文件
    const testFile = path.join(claudeDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err) {
    issues.push(`Cannot write to ${claudeDir}: ${err}`);
  }

  if (issues.length === 0) {
    return {
      category: 'Filesystem',
      name: 'File Permissions',
      status: 'pass',
      message: 'File permissions are normal',
    };
  } else {
    return {
      category: 'Filesystem',
      name: 'File Permissions',
      status: 'fail',
      message: 'Permission issues detected',
      details: issues.join('; '),
    };
  }
}

/**
 * 检查配置文件
 */
async function checkConfigurationFiles(): Promise<DiagnosticResult> {
  const files: { path: string; name: string; required: boolean }[] = [
    {
      path: path.join(os.homedir(), '.axon', 'settings.json'),
      name: 'Global Config',
      required: false
    },
    {
      path: path.join(process.cwd(), '.axon', 'settings.local.json'),
      name: 'Local Config',
      required: false
    },
    {
      path: path.join(process.cwd(), 'AXON.md'),
      name: 'Project Instructions',
      required: false
    },
  ];

  const found: string[] = [];
  const issues: string[] = [];

  for (const file of files) {
    if (fs.existsSync(file.path)) {
      try {
        if (file.path.endsWith('.json')) {
          JSON.parse(fs.readFileSync(file.path, 'utf-8'));
        }
        found.push(file.name);
      } catch (err) {
        issues.push(`${file.name} has invalid format`);
      }
    } else if (file.required) {
      issues.push(`${file.name} not found`);
    }
  }

  if (issues.length > 0) {
    return {
      category: 'Configuration',
      name: 'Config Files',
      status: 'warn',
      message: 'Configuration issues detected',
      details: issues.join('; '),
    };
  } else if (found.length > 0) {
    return {
      category: 'Configuration',
      name: 'Config Files',
      status: 'pass',
      message: `Found: ${found.join(', ')}`,
    };
  } else {
    return {
      category: 'Configuration',
      name: 'Config Files',
      status: 'pass',
      message: 'Using default configuration',
    };
  }
}

/**
 * 检查权限规则配置
 */
async function checkPermissionRules(): Promise<DiagnosticResult> {
  try {
    const stats = permissionRuleManager.getStats();
    const result = permissionRuleManager.detectUnreachable();

    // 如果没有配置规则
    if (stats.totalRules === 0) {
      return {
        category: 'Configuration',
        name: 'Permission Rules',
        status: 'pass',
        message: 'Using default permission settings',
      };
    }

    // 如果发现不可达规则
    if (result.hasUnreachable) {
      const unreachableCount = result.unreachableRules.length;
      const details = result.unreachableRules.map(ur => {
        return `${formatRule(ur.rule)} (${ur.rule.type}) blocked by ${formatRule(ur.blockedBy)} from ${formatRuleSource(ur.blockedBy.source)}`;
      }).join('; ');

      const fixes = result.unreachableRules.map(ur => ur.fixSuggestion).join('; ');

      return {
        category: 'Configuration',
        name: 'Permission Rules',
        status: 'warn',
        message: `Found ${unreachableCount} unreachable rules`,
        details: details,
        fix: fixes,
      };
    }

    // 规则配置正常
    return {
      category: 'Configuration',
      name: 'Permission Rules',
      status: 'pass',
      message: `${stats.totalRules} rules (${stats.allowRules} allow, ${stats.denyRules} deny)`,
    };
  } catch (err) {
    return {
      category: 'Configuration',
      name: 'Permission Rules',
      status: 'warn',
      message: 'Unable to check permission rules',
      details: String(err),
    };
  }
}

/**
 * 检查网络连接
 */
async function checkNetworkConnectivity(): Promise<DiagnosticResult> {
  const endpoints = [
    { url: 'https://www.google.com', name: 'Internet' },
    { url: 'https://registry.npmjs.org', name: 'NPM' },
  ];

  const results: string[] = [];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      await fetch(endpoint.url, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      results.push(endpoint.name);
    } catch {
      failures.push(endpoint.name);
    }
  }

  if (failures.length === 0) {
    return {
      category: 'Network',
      name: 'Network Connection',
      status: 'pass',
      message: 'Network connection is normal',
    };
  } else if (results.length > 0) {
    return {
      category: 'Network',
      name: 'Network Connection',
      status: 'warn',
      message: `Some endpoints unreachable: ${failures.join(', ')}`,
    };
  } else {
    return {
      category: 'Network',
      name: 'Network Connection',
      status: 'fail',
      message: 'No network connection',
    };
  }
}

/**
 * 检查内存使用
 */
async function checkMemoryUsage(): Promise<DiagnosticResult> {
  const memInfo = getMemoryInfo();
  const percentUsed = memInfo.percentUsed;

  if (percentUsed >= 90) {
    return {
      category: 'Performance',
      name: 'Memory Usage',
      status: 'warn',
      message: `Memory usage is high: ${percentUsed.toFixed(1)}%`,
      details: `${memInfo.used} / ${memInfo.total} used`,
      fix: 'Close some applications to free up memory',
    };
  } else if (percentUsed >= 75) {
    return {
      category: 'Performance',
      name: 'Memory Usage',
      status: 'warn',
      message: `Memory usage is moderate: ${percentUsed.toFixed(1)}%`,
      details: `${memInfo.used} / ${memInfo.total} used`,
    };
  } else {
    return {
      category: 'Performance',
      name: 'Memory Usage',
      status: 'pass',
      message: `${percentUsed.toFixed(1)}% (${memInfo.used} / ${memInfo.total})`,
    };
  }
}

/**
 * 检查磁盘空间
 */
async function checkDiskSpace(): Promise<DiagnosticResult> {
  try {
    const homeDir = os.homedir();
    const stats = fs.statfsSync(homeDir);
    const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);

    if (freeGB >= 1) {
      return {
        category: 'Performance',
        name: 'Disk Space',
        status: 'pass',
        message: `${freeGB.toFixed(1)} GB available`,
      };
    } else if (freeGB >= 0.1) {
      return {
        category: 'Performance',
        name: 'Disk Space',
        status: 'warn',
        message: `Only ${freeGB.toFixed(1)} GB remaining`,
        details: 'Consider freeing up disk space',
      };
    } else {
      return {
        category: 'Performance',
        name: 'Disk Space',
        status: 'fail',
        message: 'Disk space is critically low',
        details: 'Available space is less than 100MB',
      };
    }
  } catch {
    return {
      category: 'Performance',
      name: 'Disk Space',
      status: 'warn',
      message: 'Unable to check disk space',
    };
  }
}

/**
 * 获取版本号
 */
function getVersion(): string {
  try {
    const packagePath = path.join(__dirname, '../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return packageJson.version;
  } catch {
    return 'unknown';
  }
}

/**
 * 获取内存信息
 */
function getMemoryInfo(): {
  total: string;
  free: string;
  used: string;
  percentUsed: number;
} {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const percentUsed = (usedMem / totalMem) * 100;

  const formatBytes = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  return {
    total: formatBytes(totalMem),
    free: formatBytes(freeMem),
    used: formatBytes(usedMem),
    percentUsed,
  };
}

/**
 * 获取 CPU 信息
 */
function getCPUInfo(): {
  model: string;
  cores: number;
  loadAverage: number[];
} {
  const cpus = os.cpus();
  return {
    model: cpus[0]?.model || 'Unknown',
    cores: cpus.length,
    loadAverage: os.loadavg(),
  };
}

/**
 * 格式化诊断报告为文本
 */
export function formatDoctorReport(report: DoctorReport, verbose: boolean = false): string {
  const lines: string[] = [];

  lines.push('╭─────────────────────────────────────────────╮');
  lines.push('│      Axon WebUI Diagnostic Report          │');
  lines.push('╰─────────────────────────────────────────────╯');
  lines.push('');

  if (report.systemInfo) {
    lines.push(`  Version:  ${report.systemInfo.version}`);
    lines.push(`  Platform: ${report.systemInfo.platform}`);
    lines.push(`  Node:     ${report.systemInfo.nodeVersion}`);

    if (verbose) {
      lines.push('');
      lines.push('  System Info:');
      lines.push(`    Memory: ${report.systemInfo.memory.used} / ${report.systemInfo.memory.total} (${report.systemInfo.memory.percentUsed.toFixed(1)}% used)`);
      lines.push(`    CPU:    ${report.systemInfo.cpu.model}`);
      lines.push(`    Cores:  ${report.systemInfo.cpu.cores}`);
      lines.push(`    Load:   ${report.systemInfo.cpu.loadAverage.map(l => l.toFixed(2)).join(', ')}`);
    }
  }

  lines.push('');
  lines.push('─────────────────────────────────────────────');
  lines.push('');

  // 按类别分组显示
  const categories = Array.from(new Set(report.results.map(r => r.category)));

  for (const category of categories) {
    const categoryResults = report.results.filter(r => r.category === category);

    lines.push(`${category}`);
    lines.push(`${'-'.repeat(category.length)}`);

    for (const check of categoryResults) {
      const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      lines.push(`  ${icon} ${check.name}: ${check.message}`);

      if (verbose && check.details) {
        lines.push(`    └─ ${check.details}`);
      }

      if (verbose && check.fix) {
        lines.push(`    💡 Fix: ${check.fix}`);
      }
    }

    lines.push('');
  }

  lines.push('─────────────────────────────────────────────');
  lines.push('');
  lines.push(`  Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed`);
  lines.push('');

  if (report.summary.warnings > 0 || report.summary.failed > 0) {
    lines.push('  💡 Use /doctor verbose to see details and fix suggestions');
    lines.push('');
  }

  return lines.join('\n');
}
