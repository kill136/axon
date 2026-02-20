/**
 * Diagnostics and Health Check System
 * For /doctor command and troubleshooting
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { exec } = child_process;
import { detectProvider, validateProviderConfig } from '../providers/index.js';
import {
  getPackageManagerInfo,
  getUpdateInstructions,
  formatPackageManagerDiagnostics,
  type PackageManagerInfo,
} from '../utils/package-manager.js';

export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
  fix?: string; // Suggested fix for the issue
}

export interface DiagnosticReport {
  timestamp: number;
  version: string;
  platform: string;
  nodeVersion: string;
  checks: DiagnosticCheck[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
  };
  systemInfo?: {
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

export interface DiagnosticOptions {
  verbose?: boolean;
  json?: boolean;
  fix?: boolean;
}

/**
 * Run all diagnostic checks
 */
export async function runDiagnostics(options: DiagnosticOptions = {}): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];

  // Get version from package.json
  let version = 'unknown';
  try {
    const packagePath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    version = packageJson.version;
  } catch {
    // Ignore
  }

  // Environment checks
  checks.push(await checkNodeVersion());
  checks.push(await checkNpmVersion());
  checks.push(await checkYarnVersion());
  checks.push(await checkGitAvailability());
  checks.push(await checkRipgrepAvailability());
  checks.push(await checkLSPAvailability());

  // Configuration checks
  checks.push(await checkAuthConfiguration());
  checks.push(await checkConfigurationFiles());
  checks.push(await checkMCPServers());
  checks.push(await checkEnvironmentVariables());
  checks.push(await checkPermissionSettings());

  // Network checks
  checks.push(await checkApiConnectivity());
  checks.push(await checkNetworkConnectivity());
  checks.push(await checkProxyConfiguration());
  checks.push(await checkSSLCertificates());

  // File system checks
  checks.push(await checkFilePermissions());
  checks.push(await checkDiskSpace());
  checks.push(await checkSessionDirectory());
  checks.push(await checkCacheDirectory());

  // Performance checks
  checks.push(await checkMemoryUsage());
  checks.push(await checkCPULoad());

  // Package manager check
  checks.push(await checkPackageManager());

  // Calculate summary
  const summary = {
    passed: checks.filter((c) => c.status === 'pass').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    failed: checks.filter((c) => c.status === 'fail').length,
  };

  // Collect system info
  const systemInfo = options.verbose ? {
    memory: getMemoryInfo(),
    cpu: getCPUInfo(),
  } : undefined;

  return {
    timestamp: Date.now(),
    version,
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    checks,
    summary,
    systemInfo,
  };
}

/**
 * Check Node.js version
 */
async function checkNodeVersion(): Promise<DiagnosticCheck> {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);

  if (major >= 20) {
    return {
      name: 'Node.js Version',
      status: 'pass',
      message: `Node.js ${version} is installed`,
    };
  } else if (major >= 18) {
    return {
      name: 'Node.js Version',
      status: 'warn',
      message: `Node.js ${version} works but 20+ recommended`,
      fix: 'Upgrade to Node.js 20+ using nvm: nvm install 20 && nvm use 20',
    };
  } else {
    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `Node.js ${version} is too old`,
      details: 'Please upgrade to Node.js 20 or later',
      fix: 'Install Node.js 20+: https://nodejs.org/ or use nvm',
    };
  }
}

/**
 * Check npm version
 */
async function checkNpmVersion(): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    child_process.exec('npm --version', (error, stdout) => {
      if (error) {
        resolve({
          name: 'npm',
          status: 'warn',
          message: 'npm not found',
          details: 'npm is typically included with Node.js',
          fix: 'Reinstall Node.js from https://nodejs.org/',
        });
      } else {
        const version = stdout.trim();
        resolve({
          name: 'npm',
          status: 'pass',
          message: `npm ${version}`,
        });
      }
    });
  });
}

/**
 * Check yarn version
 */
async function checkYarnVersion(): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    child_process.exec('yarn --version', (error, stdout) => {
      if (error) {
        resolve({
          name: 'Yarn',
          status: 'pass',
          message: 'Yarn not installed (optional)',
          details: 'Yarn is optional, npm is sufficient',
        });
      } else {
        const version = stdout.trim();
        resolve({
          name: 'Yarn',
          status: 'pass',
          message: `Yarn ${version}`,
        });
      }
    });
  });
}

/**
 * Check ripgrep availability
 */
async function checkRipgrepAvailability(): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    child_process.exec('rg --version', (error, stdout) => {
      if (error) {
        resolve({
          name: 'Ripgrep',
          status: 'warn',
          message: 'Ripgrep not found in PATH',
          details: 'Ripgrep provides faster file searching',
          fix: 'Install ripgrep: https://github.com/BurntSushi/ripgrep#installation',
        });
      } else {
        const version = stdout.split('\n')[0];
        resolve({
          name: 'Ripgrep',
          status: 'pass',
          message: version,
        });
      }
    });
  });
}

/**
 * Check LSP availability (TypeScript Language Server)
 */
async function checkLSPAvailability(): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    exec('typescript-language-server --version', { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve({
          name: 'LSP',
          status: 'warn',
          message: 'TypeScript Language Server not found',
          details: 'Code parsing will use fallback regex mode',
          fix: 'Run: npm install -g typescript-language-server typescript',
        });
      } else {
        resolve({
          name: 'LSP',
          status: 'pass',
          message: `typescript-language-server ${stdout.trim()}`,
        });
      }
    });
  });
}

/**
 * Check authentication configuration
 */
async function checkAuthConfiguration(): Promise<DiagnosticCheck> {
  const provider = detectProvider();
  const validation = validateProviderConfig(provider);

  if (validation.valid) {
    return {
      name: 'Authentication',
      status: 'pass',
      message: `${provider.type} credentials configured`,
    };
  } else {
    return {
      name: 'Authentication',
      status: 'fail',
      message: 'Authentication not configured',
      details: validation.errors.join('; '),
    };
  }
}

/**
 * Check API connectivity
 */
async function checkApiConnectivity(): Promise<DiagnosticCheck> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok || response.status === 405) {
      return {
        name: 'API Connectivity',
        status: 'pass',
        message: 'Can reach Anthropic API',
      };
    } else {
      return {
        name: 'API Connectivity',
        status: 'warn',
        message: `API responded with status ${response.status}`,
      };
    }
  } catch (err) {
    return {
      name: 'API Connectivity',
      status: 'fail',
      message: 'Cannot reach Anthropic API',
      details: String(err),
    };
  }
}

/**
 * Check file permissions
 */
async function checkFilePermissions(): Promise<DiagnosticCheck> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const issues: string[] = [];

  // Check if .claude directory exists and is writable
  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Try to write a test file
    const testFile = path.join(claudeDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err) {
    issues.push(`Cannot write to ${claudeDir}: ${err}`);
  }

  // Check current directory permissions
  try {
    const cwd = process.cwd();
    fs.accessSync(cwd, fs.constants.R_OK);
  } catch {
    issues.push('Cannot read current directory');
  }

  if (issues.length === 0) {
    return {
      name: 'File Permissions',
      status: 'pass',
      message: 'File permissions OK',
    };
  } else {
    return {
      name: 'File Permissions',
      status: 'fail',
      message: 'Permission issues detected',
      details: issues.join('; '),
    };
  }
}

/**
 * Check Git availability
 */
async function checkGitAvailability(): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    child_process.exec('git --version', (error, stdout) => {
      if (error) {
        resolve({
          name: 'Git',
          status: 'warn',
          message: 'Git not found',
          details: 'Some features may not work without Git',
        });
      } else {
        resolve({
          name: 'Git',
          status: 'pass',
          message: stdout.trim(),
        });
      }
    });
  });
}

/**
 * Check disk space
 */
async function checkDiskSpace(): Promise<DiagnosticCheck> {
  try {
    const homeDir = os.homedir();
    const stats = fs.statfsSync(homeDir);
    const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);

    if (freeGB >= 1) {
      return {
        name: 'Disk Space',
        status: 'pass',
        message: `${freeGB.toFixed(1)} GB available`,
      };
    } else if (freeGB >= 0.1) {
      return {
        name: 'Disk Space',
        status: 'warn',
        message: `Only ${freeGB.toFixed(1)} GB available`,
        details: 'Consider freeing up disk space',
      };
    } else {
      return {
        name: 'Disk Space',
        status: 'fail',
        message: 'Very low disk space',
        details: 'Less than 100MB available',
      };
    }
  } catch {
    return {
      name: 'Disk Space',
      status: 'warn',
      message: 'Could not check disk space',
    };
  }
}

/**
 * Check configuration files
 */
async function checkConfigurationFiles(): Promise<DiagnosticCheck> {
  const files: { path: string; name: string; required: boolean }[] = [
    { path: path.join(os.homedir(), '.claude', 'settings.json'), name: 'Global settings', required: false },
    { path: path.join(process.cwd(), '.claude', 'settings.local.json'), name: 'Local settings', required: false },
    { path: path.join(process.cwd(), 'CLAUDE.md'), name: 'Project instructions', required: false },
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
      name: 'Configuration Files',
      status: 'warn',
      message: 'Some config issues detected',
      details: issues.join('; '),
    };
  } else if (found.length > 0) {
    return {
      name: 'Configuration Files',
      status: 'pass',
      message: `Found: ${found.join(', ')}`,
    };
  } else {
    return {
      name: 'Configuration Files',
      status: 'pass',
      message: 'Using default configuration',
    };
  }
}

/**
 * Check MCP servers
 */
async function checkMCPServers(): Promise<DiagnosticCheck> {
  const mcpConfigPath = path.join(os.homedir(), '.claude', 'mcp.json');

  if (!fs.existsSync(mcpConfigPath)) {
    return {
      name: 'MCP Servers',
      status: 'pass',
      message: 'No MCP servers configured',
    };
  }

  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    const servers = Object.keys(config.mcpServers || {});

    if (servers.length === 0) {
      return {
        name: 'MCP Servers',
        status: 'pass',
        message: 'No MCP servers configured',
      };
    }

    return {
      name: 'MCP Servers',
      status: 'pass',
      message: `${servers.length} server(s): ${servers.join(', ')}`,
    };
  } catch (err) {
    return {
      name: 'MCP Servers',
      status: 'warn',
      message: 'MCP config has issues',
      details: String(err),
    };
  }
}

/**
 * Check network connectivity
 */
async function checkNetworkConnectivity(): Promise<DiagnosticCheck> {
  const endpoints = [
    { url: 'https://www.google.com', name: 'Internet' },
    { url: 'https://registry.npmjs.org', name: 'NPM' },
  ];

  const results: string[] = [];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      await fetch(endpoint.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      results.push(endpoint.name);
    } catch {
      failures.push(endpoint.name);
    }
  }

  if (failures.length === 0) {
    return {
      name: 'Network',
      status: 'pass',
      message: 'Network connectivity OK',
    };
  } else if (results.length > 0) {
    return {
      name: 'Network',
      status: 'warn',
      message: `Some endpoints unreachable: ${failures.join(', ')}`,
    };
  } else {
    return {
      name: 'Network',
      status: 'fail',
      message: 'No network connectivity',
    };
  }
}

/**
 * Check environment variables
 */
async function checkEnvironmentVariables(): Promise<DiagnosticCheck> {
  const relevantVars = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'ANTHROPIC_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CONFIG_DIR',
  ];

  const set = relevantVars.filter((v) => process.env[v]);
  const masked = set.map((v) => {
    const value = process.env[v] || '';
    if (v.includes('KEY') || v.includes('TOKEN')) {
      return `${v}=***${value.slice(-4)}`;
    }
    return `${v}=${value}`;
  });

  return {
    name: 'Environment',
    status: 'pass',
    message: set.length > 0 ? `${set.length} Claude vars set` : 'Using defaults',
    details: masked.length > 0 ? masked.join(', ') : undefined,
  };
}

/**
 * Format diagnostic report for display
 */
export function formatDiagnosticReport(report: DiagnosticReport, options: DiagnosticOptions = {}): string {
  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];

  lines.push('╭─────────────────────────────────────────────╮');
  lines.push('│           Claude Code Diagnostics          │');
  lines.push('╰─────────────────────────────────────────────╯');
  lines.push('');
  lines.push(`  Version:  ${report.version}`);
  lines.push(`  Platform: ${report.platform}`);
  lines.push(`  Node:     ${report.nodeVersion}`);

  // Add system info in verbose mode
  if (options.verbose && report.systemInfo) {
    lines.push('');
    lines.push('  System Information:');
    lines.push(`    Memory:   ${report.systemInfo.memory.used} / ${report.systemInfo.memory.total} (${report.systemInfo.memory.percentUsed.toFixed(1)}% used)`);
    lines.push(`    CPU:      ${report.systemInfo.cpu.model}`);
    lines.push(`    Cores:    ${report.systemInfo.cpu.cores}`);
    lines.push(`    Load Avg: ${report.systemInfo.cpu.loadAverage.map((l) => l.toFixed(2)).join(', ')}`);
  }

  lines.push('');
  lines.push('─────────────────────────────────────────────');
  lines.push('');

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    lines.push(`  ${icon} ${check.name}: ${check.message}`);

    if (options.verbose && check.details) {
      lines.push(`    └─ ${check.details}`);
    }

    if (options.verbose && check.fix) {
      lines.push(`    💡 Fix: ${check.fix}`);
    }
  }

  lines.push('');
  lines.push('─────────────────────────────────────────────');
  lines.push('');
  lines.push(`  Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed`);
  lines.push('');

  // Add recommendations
  if (report.summary.warnings > 0 || report.summary.failed > 0) {
    lines.push('  💡 Run with --verbose flag for more details and suggested fixes');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check permission settings
 */
async function checkPermissionSettings(): Promise<DiagnosticCheck> {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      return {
        name: 'Permission Settings',
        status: 'pass',
        message: 'Using default permissions',
      };
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hasPermissions = settings.permissions !== undefined;

    if (hasPermissions) {
      return {
        name: 'Permission Settings',
        status: 'pass',
        message: 'Custom permissions configured',
        details: JSON.stringify(settings.permissions),
      };
    } else {
      return {
        name: 'Permission Settings',
        status: 'pass',
        message: 'Using default permissions',
      };
    }
  } catch (err) {
    return {
      name: 'Permission Settings',
      status: 'warn',
      message: 'Could not read permission settings',
      details: String(err),
    };
  }
}

/**
 * Check proxy configuration
 */
async function checkProxyConfiguration(): Promise<DiagnosticCheck> {
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const setProxies = proxyVars.filter((v) => process.env[v]);

  if (setProxies.length === 0) {
    return {
      name: 'Proxy Configuration',
      status: 'pass',
      message: 'No proxy configured',
    };
  }

  const proxyDetails = setProxies
    .map((v) => {
      const value = process.env[v] || '';
      // Mask credentials in proxy URL
      const masked = value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
      return `${v}=${masked}`;
    })
    .join(', ');

  return {
    name: 'Proxy Configuration',
    status: 'pass',
    message: `Proxy configured: ${setProxies.length} variable(s)`,
    details: proxyDetails,
  };
}

/**
 * Check SSL certificates
 */
async function checkSSLCertificates(): Promise<DiagnosticCheck> {
  // Check if NODE_TLS_REJECT_UNAUTHORIZED is set (bad practice)
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return {
      name: 'SSL Certificates',
      status: 'warn',
      message: 'SSL verification is disabled',
      details: 'NODE_TLS_REJECT_UNAUTHORIZED=0 is set (security risk)',
      fix: 'Remove NODE_TLS_REJECT_UNAUTHORIZED=0 and use proper SSL certificates',
    };
  }

  // Check custom CA certificates
  const customCA = process.env.NODE_EXTRA_CA_CERTS;
  if (customCA) {
    if (fs.existsSync(customCA)) {
      return {
        name: 'SSL Certificates',
        status: 'pass',
        message: 'Custom CA certificates configured',
        details: `Using: ${customCA}`,
      };
    } else {
      return {
        name: 'SSL Certificates',
        status: 'warn',
        message: 'Custom CA file not found',
        details: `NODE_EXTRA_CA_CERTS points to missing file: ${customCA}`,
        fix: `Verify the path or remove NODE_EXTRA_CA_CERTS`,
      };
    }
  }

  return {
    name: 'SSL Certificates',
    status: 'pass',
    message: 'Using system SSL certificates',
  };
}

/**
 * Check session directory
 */
async function checkSessionDirectory(): Promise<DiagnosticCheck> {
  const sessionDir = path.join(os.homedir(), '.claude', 'sessions');

  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Count session files
    const files = fs.readdirSync(sessionDir);
    const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

    // Calculate total size
    let totalSize = 0;
    for (const file of files) {
      const stats = fs.statSync(path.join(sessionDir, file));
      totalSize += stats.size;
    }

    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    return {
      name: 'Session Directory',
      status: 'pass',
      message: `${sessionFiles.length} session(s), ${sizeMB} MB`,
      details: `Path: ${sessionDir}`,
    };
  } catch (err) {
    return {
      name: 'Session Directory',
      status: 'fail',
      message: 'Cannot access session directory',
      details: String(err),
      fix: `Ensure ${sessionDir} is writable`,
    };
  }
}

/**
 * Check cache directory
 */
async function checkCacheDirectory(): Promise<DiagnosticCheck> {
  const cacheDir = path.join(os.homedir(), '.claude', 'cache');

  try {
    if (!fs.existsSync(cacheDir)) {
      return {
        name: 'Cache Directory',
        status: 'pass',
        message: 'No cache directory (will be created as needed)',
      };
    }

    // Calculate cache size
    const calculateDirSize = (dirPath: string): number => {
      let size = 0;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          size += calculateDirSize(filePath);
        } else {
          size += stats.size;
        }
      }
      return size;
    };

    const totalSize = calculateDirSize(cacheDir);
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    if (totalSize > 500 * 1024 * 1024) {
      // > 500MB
      return {
        name: 'Cache Directory',
        status: 'warn',
        message: `Cache is large: ${sizeMB} MB`,
        details: `Path: ${cacheDir}`,
        fix: `Consider clearing cache: rm -rf ${cacheDir}`,
      };
    }

    return {
      name: 'Cache Directory',
      status: 'pass',
      message: `Cache: ${sizeMB} MB`,
      details: `Path: ${cacheDir}`,
    };
  } catch (err) {
    return {
      name: 'Cache Directory',
      status: 'warn',
      message: 'Could not check cache',
      details: String(err),
    };
  }
}

/**
 * Check memory usage
 */
async function checkMemoryUsage(): Promise<DiagnosticCheck> {
  const memInfo = getMemoryInfo();
  const percentUsed = memInfo.percentUsed;

  if (percentUsed >= 90) {
    return {
      name: 'Memory Usage',
      status: 'warn',
      message: `High memory usage: ${percentUsed.toFixed(1)}%`,
      details: `${memInfo.used} / ${memInfo.total} used`,
      fix: 'Close some applications to free up memory',
    };
  } else if (percentUsed >= 75) {
    return {
      name: 'Memory Usage',
      status: 'warn',
      message: `Moderate memory usage: ${percentUsed.toFixed(1)}%`,
      details: `${memInfo.used} / ${memInfo.total} used`,
    };
  } else {
    return {
      name: 'Memory Usage',
      status: 'pass',
      message: `${percentUsed.toFixed(1)}% (${memInfo.used} / ${memInfo.total})`,
    };
  }
}

/**
 * Check package manager and installation type
 * 检测安装方式（homebrew/winget/npm）并显示更新命令
 */
async function checkPackageManager(): Promise<DiagnosticCheck> {
  try {
    const info = getPackageManagerInfo();
    const instructions = getUpdateInstructions(info.packageManager);

    // 构建详细信息
    const details = [
      `Installation Type: ${info.installationType}`,
      `Exec Path: ${info.execPath}`,
      `Update Command: ${info.updateCommand}`,
    ].join('\n    ');

    return {
      name: 'Package Manager',
      status: 'pass',
      message: `Installed via ${instructions.managerName}`,
      details: details,
      fix: info.canAutoUpdate
        ? 'Run "claude update" to update automatically'
        : `Run "${info.updateCommand}" to update`,
    };
  } catch (err) {
    return {
      name: 'Package Manager',
      status: 'warn',
      message: 'Could not detect package manager',
      details: String(err),
    };
  }
}

/**
 * Check CPU load
 */
async function checkCPULoad(): Promise<DiagnosticCheck> {
  const cpuInfo = getCPUInfo();
  const loadAvg = cpuInfo.loadAverage[0]; // 1-minute average
  const cores = cpuInfo.cores;
  const loadPerCore = loadAvg / cores;

  if (loadPerCore >= 2.0) {
    return {
      name: 'CPU Load',
      status: 'warn',
      message: `High CPU load: ${loadAvg.toFixed(2)} (${cores} cores)`,
      details: `Load per core: ${loadPerCore.toFixed(2)}`,
      fix: 'System is under heavy load, performance may be affected',
    };
  } else if (loadPerCore >= 1.0) {
    return {
      name: 'CPU Load',
      status: 'warn',
      message: `Moderate CPU load: ${loadAvg.toFixed(2)} (${cores} cores)`,
      details: `Load per core: ${loadPerCore.toFixed(2)}`,
    };
  } else {
    return {
      name: 'CPU Load',
      status: 'pass',
      message: `Load: ${loadAvg.toFixed(2)} (${cores} cores)`,
    };
  }
}

/**
 * Get memory information
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
 * Get CPU information
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
 * Attempt to auto-fix common issues
 */
export async function autoFixIssues(report: DiagnosticReport): Promise<{
  fixed: string[];
  failed: string[];
}> {
  const fixed: string[] = [];
  const failed: string[] = [];

  for (const check of report.checks) {
    if (check.status === 'fail' || check.status === 'warn') {
      try {
        // Attempt to fix specific issues
        if (check.name === 'File Permissions') {
          // Create .claude directory if missing
          const claudeDir = path.join(os.homedir(), '.claude');
          if (!fs.existsSync(claudeDir)) {
            fs.mkdirSync(claudeDir, { recursive: true, mode: 0o755 });
            fixed.push(`Created ${claudeDir} directory`);
          }
        } else if (check.name === 'Session Directory') {
          // Create session directory
          const sessionDir = path.join(os.homedir(), '.claude', 'sessions');
          if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true, mode: 0o755 });
            fixed.push(`Created ${sessionDir} directory`);
          }
        } else if (check.name === 'Cache Directory' && check.message.includes('large')) {
          // Note: We don't auto-delete cache, just notify
          failed.push(`${check.name}: Please manually clear cache`);
        } else {
          // For other issues, we can't auto-fix
          if (check.fix) {
            failed.push(`${check.name}: ${check.fix}`);
          }
        }
      } catch (err) {
        failed.push(`${check.name}: ${err}`);
      }
    }
  }

  return { fixed, failed };
}

/**
 * Quick health check (minimal checks)
 */
export async function quickHealthCheck(): Promise<{
  healthy: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check auth
  const provider = detectProvider();
  const validation = validateProviderConfig(provider);
  if (!validation.valid) {
    issues.push('Authentication not configured');
  }

  // Check basic connectivity
  try {
    await fetch('https://api.anthropic.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    issues.push('Cannot reach API');
  }

  return {
    healthy: issues.length === 0,
    issues,
  };
}

/**
 * Get a summary of system health
 */
export async function getSystemHealthSummary(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;
  criticalIssues: string[];
}> {
  const report = await runDiagnostics();

  const criticalIssues: string[] = [];
  const totalChecks = report.checks.length;
  const failedChecks = report.summary.failed;
  const warnings = report.summary.warnings;

  // Calculate health score (0-100)
  const score = Math.round(((totalChecks - failedChecks - warnings * 0.5) / totalChecks) * 100);

  // Identify critical issues
  for (const check of report.checks) {
    if (check.status === 'fail') {
      criticalIssues.push(`${check.name}: ${check.message}`);
    }
  }

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (score >= 90) {
    status = 'healthy';
  } else if (score >= 70) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  return {
    status,
    score,
    criticalIssues,
  };
}
