/**
 * 自动更新系统
 * 检查和安装更新
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as child_process from 'child_process';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import {
  getPackageManagerInfo,
  getUpdateInstructions,
  detectPackageManager,
  detectInstallationType,
  type PackageManagerType,
  type InstallationType,
} from '../utils/package-manager.js';

// 版本信息
export interface VersionInfo {
  version: string;
  releaseDate: string;
  changelog?: string;
  downloadUrl?: string;
  minimumNodeVersion?: string;
  description?: string;
  dependencies?: Record<string, string>;
}

// 更新配置
export interface UpdateConfig {
  checkInterval?: number; // 检查间隔（毫秒）
  autoDownload?: boolean;
  autoInstall?: boolean;
  channel?: 'stable' | 'beta' | 'canary' | 'latest';
  registryUrl?: string;
  packageName?: string;
}

// 更新状态
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

// 更新检查结果
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  versionInfo?: VersionInfo;
  changelog?: string[];
  packageManager?: PackageManagerType;
  installationType?: InstallationType;
  updateCommand?: string;
}

// 更新选项
export interface UpdateOptions {
  version?: string;
  force?: boolean;
  beta?: boolean;
  canary?: boolean;
  dryRun?: boolean;
  showProgress?: boolean;
}

// 更新信息（用于导出函数）
export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  changelog?: string[];
  versionInfo?: VersionInfo;
  packageManager?: PackageManagerType;
  installationType?: InstallationType;
  updateCommand?: string;
}

// 自动更新管理器
export class UpdateManager extends EventEmitter {
  private config: Required<UpdateConfig>;
  private status: UpdateStatus = 'idle';
  private lastCheck: number = 0;
  private checkTimer: NodeJS.Timeout | null = null;
  private currentVersion: string;
  private packageName: string;

  constructor(config: UpdateConfig = {}) {
    super();
    this.config = {
      checkInterval: config.checkInterval || 24 * 60 * 60 * 1000, // 24 hours
      autoDownload: config.autoDownload ?? false,
      autoInstall: config.autoInstall ?? false,
      channel: config.channel || 'stable',
      registryUrl: config.registryUrl || 'https://registry.npmjs.org',
      packageName: config.packageName || 'axon',
    };

    // 从 package.json 读取当前版本
    this.currentVersion = this.readCurrentVersion();
    this.packageName = this.config.packageName;
  }

  // 读取当前版本
  private readCurrentVersion(): string {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const packagePath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      return packageJson.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  // 获取当前状态
  getStatus(): UpdateStatus {
    return this.status;
  }

  // 获取当前版本
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  // 获取配置
  getConfig(): Required<UpdateConfig> {
    return this.config;
  }

  // 检查更新
  async checkForUpdates(): Promise<UpdateCheckResult> {
    this.status = 'checking';
    this.emit('checking');

    try {
      const latestVersion = await this.fetchLatestVersion();
      const hasUpdate = this.compareVersions(latestVersion, this.currentVersion) > 0;

      this.lastCheck = Date.now();

      let versionInfo: VersionInfo | undefined;
      let changelog: string[] | undefined;

      if (hasUpdate) {
        // 获取版本详细信息
        versionInfo = await this.fetchVersionInfo(latestVersion);

        // 获取变更日志
        changelog = await this.getChangelog(this.currentVersion);

        this.status = 'available';
        this.emit('update-available', {
          currentVersion: this.currentVersion,
          latestVersion,
          versionInfo,
          changelog,
        });

        if (this.config.autoDownload) {
          this.download(latestVersion);
        }
      } else {
        this.status = 'idle';
        this.emit('update-not-available');
      }

      // 获取包管理器信息
      const pmInfo = getPackageManagerInfo();

      return {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        versionInfo,
        changelog,
        packageManager: pmInfo.packageManager,
        installationType: pmInfo.installationType,
        updateCommand: pmInfo.updateCommand,
      };
    } catch (err) {
      this.status = 'error';
      this.emit('error', err);
      throw err;
    }
  }

  // 从 npm 获取最新版本
  private async fetchLatestVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.registryUrl}/${this.packageName}`;

      const req = https.get(url, { timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const packageInfo = JSON.parse(data);
            const distTags = packageInfo['dist-tags'] || {};

            let version: string;
            switch (this.config.channel) {
              case 'canary':
                version = distTags.canary || distTags.next || distTags.latest;
                break;
              case 'beta':
                version = distTags.beta || distTags.latest;
                break;
              case 'latest':
                version = distTags.latest;
                break;
              case 'stable':
              default:
                version = distTags.latest;
            }

            resolve(version);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Update check timed out')); });
      req.on('error', reject);
    });
  }

  // 获取特定版本的详细信息
  private async fetchVersionInfo(version: string): Promise<VersionInfo> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.registryUrl}/${this.packageName}/${version}`;

      const req = https.get(url, { timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const versionData = JSON.parse(data);

            const info: VersionInfo = {
              version: versionData.version,
              releaseDate: versionData.time || new Date().toISOString(),
              description: versionData.description,
              minimumNodeVersion: versionData.engines?.node,
              dependencies: versionData.dependencies,
            };

            resolve(info);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Update check timed out')); });
      req.on('error', reject);
    });
  }

  // 比较版本号
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
    const parts2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  // 下载更新
  async download(version?: string, options: UpdateOptions = {}): Promise<void> {
    this.status = 'downloading';
    this.emit('downloading');

    try {
      const targetVersion = version || await this.fetchLatestVersion();

      if (options.dryRun) {
        this.emit('dry-run', { action: 'download', version: targetVersion });
        return;
      }

      if (options.showProgress) {
        this.emit('progress', { phase: 'downloading', percent: 0 });
      }

      // 使用 npm pack 下载
      const result = await this.executeNpm(['pack', `${this.packageName}@${targetVersion}`]);

      if (options.showProgress) {
        this.emit('progress', { phase: 'downloading', percent: 100 });
      }

      if (result.success) {
        this.status = 'ready';
        this.emit('downloaded', { version: targetVersion });

        if (this.config.autoInstall) {
          await this.install(targetVersion, options);
        }
      } else {
        throw new Error(result.error || 'Download failed');
      }
    } catch (err) {
      this.status = 'error';
      this.emit('error', err);
      throw err;
    }
  }

  // 安装更新
  async install(version?: string, options: UpdateOptions = {}): Promise<void> {
    this.status = 'installing';
    this.emit('installing');

    try {
      const targetVersion = version || 'latest';

      if (options.dryRun) {
        this.emit('dry-run', { action: 'install', version: targetVersion });
        return;
      }

      if (options.showProgress) {
        this.emit('progress', { phase: 'installing', percent: 0 });
      }

      const args = [
        'install',
        '-g',
        `${this.packageName}@${targetVersion}`,
      ];

      if (options.force) {
        args.push('--force');
      }

      const result = await this.executeNpm(args);

      if (options.showProgress) {
        this.emit('progress', { phase: 'installing', percent: 100 });
      }

      if (result.success) {
        this.emit('installed', { version: targetVersion });
        this.status = 'idle';
      } else {
        throw new Error(result.error || 'Installation failed');
      }
    } catch (err) {
      this.status = 'error';
      this.emit('error', err);
      throw err;
    }
  }

  // 回滚到指定版本
  async rollback(version: string, options: UpdateOptions = {}): Promise<void> {
    this.status = 'installing';
    this.emit('rollback', { version });

    try {
      if (options.dryRun) {
        this.emit('dry-run', { action: 'rollback', version });
        return;
      }

      // 验证版本是否存在
      const availableVersions = await this.listAvailableVersions();
      if (!availableVersions.includes(version)) {
        throw new Error(`Version ${version} not found`);
      }

      // 卸载当前版本并安装指定版本
      await this.install(version, options);

      this.emit('rollback-complete', { version });
    } catch (err) {
      this.status = 'error';
      this.emit('error', err);
      throw err;
    }
  }

  // 列出可用版本
  async listAvailableVersions(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.registryUrl}/${this.packageName}`;

      const req = https.get(url, { timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const packageInfo = JSON.parse(data);
            const versions = Object.keys(packageInfo.versions || {});
            resolve(versions.sort((a, b) => this.compareVersions(b, a)));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Update check timed out')); });
      req.on('error', reject);
    });
  }

  // 执行 npm 命令 (v2.1.14 修复：添加流清理)
  private executeNpm(args: string[]): Promise<{ success: boolean; output?: string; error?: string }> {
    return new Promise((resolve) => {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

      const proc = child_process.spawn(npm, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      // 保存监听器引用以便清理
      const stdoutHandler = (data: Buffer) => {
        stdout += data.toString();
      };

      const stderrHandler = (data: Buffer) => {
        stderr += data.toString();
      };

      const closeHandler = (code: number | null) => {
        // v2.1.14: 清理所有流监听器
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.removeAllListeners();

        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
        });
      };

      const errorHandler = (err: Error) => {
        // v2.1.14: 清理所有流监听器
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.removeAllListeners();

        resolve({
          success: false,
          error: String(err),
        });
      };

      proc.stdout.on('data', stdoutHandler);
      proc.stderr.on('data', stderrHandler);
      proc.on('close', closeHandler);
      proc.on('error', errorHandler);
    });
  }

  // 启动自动检查
  startAutoCheck(): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, this.config.checkInterval);

    // 立即检查一次
    this.checkForUpdates().catch(() => {});
  }

  // 停止自动检查
  stopAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  // 获取更新历史（changelog）
  async getChangelog(fromVersion?: string): Promise<string[]> {
    try {
      const url = `${this.config.registryUrl}/${this.packageName}`;
      const response = await this.fetchJson(url);

      const versions = Object.keys(response.versions || {});
      const startIdx = fromVersion
        ? versions.findIndex(v => this.compareVersions(v, fromVersion) > 0)
        : 0;

      return versions.slice(startIdx).reverse();
    } catch {
      return [];
    }
  }

  // 辅助方法：获取 JSON
  private fetchJson(url: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Update check timed out')); });
      req.on('error', reject);
    });
  }
}

// 检查更新（导出函数）
export async function checkForUpdates(options: UpdateConfig = {}): Promise<UpdateInfo> {
  const manager = new UpdateManager(options);
  const result = await manager.checkForUpdates();

  return {
    current: result.currentVersion,
    latest: result.latestVersion,
    hasUpdate: result.hasUpdate,
    changelog: result.changelog,
    versionInfo: result.versionInfo,
    packageManager: result.packageManager,
    installationType: result.installationType,
    updateCommand: result.updateCommand,
  };
}

// 执行更新（导出函数）
export async function performUpdate(options: UpdateOptions = {}): Promise<boolean> {
  const manager = new UpdateManager({
    channel: options.beta ? 'beta' : options.canary ? 'canary' : 'stable',
  });

  try {
    // 显示进度事件
    if (options.showProgress) {
      manager.on('progress', ({ phase, percent }) => {
        console.log(`[${phase}] ${percent}%`);
      });
    }

    // Dry-run 模式
    if (options.dryRun) {
      manager.on('dry-run', ({ action, version }) => {
        console.log(`[DRY-RUN] Would ${action} version ${version}`);
      });
    }

    // 检查更新
    const updateInfo = await manager.checkForUpdates();

    if (!updateInfo.hasUpdate) {
      console.log('Already up to date!');
      return true;
    }

    // 下载并安装
    await manager.download(options.version, options);

    if (!options.dryRun && !manager.getConfig().autoInstall) {
      await manager.install(options.version, options);
    }

    return true;
  } catch (error) {
    console.error('Update failed:', error);
    return false;
  }
}

// 回滚版本（导出函数）
export async function rollbackVersion(version: string, options: UpdateOptions = {}): Promise<boolean> {
  const manager = new UpdateManager();

  try {
    // 显示进度事件
    if (options.showProgress) {
      manager.on('progress', ({ phase, percent }) => {
        console.log(`[${phase}] ${percent}%`);
      });
    }

    await manager.rollback(version, options);
    return true;
  } catch (error) {
    console.error('Rollback failed:', error);
    return false;
  }
}

// 列出可用版本
export async function listVersions(options: UpdateConfig = {}): Promise<string[]> {
  const manager = new UpdateManager(options);
  return manager.listAvailableVersions();
}

// 版本检查器（简化版，向后兼容）
export async function checkVersion(): Promise<{
  current: string;
  latest: string;
  hasUpdate: boolean;
}> {
  const manager = new UpdateManager();
  const result = await manager.checkForUpdates();

  return {
    current: result.currentVersion,
    latest: result.latestVersion,
    hasUpdate: result.hasUpdate,
  };
}

// 安装特定版本（简化版，向后兼容）
export async function installVersion(version: string): Promise<boolean> {
  const manager = new UpdateManager();

  try {
    await manager.install(version);
    return true;
  } catch {
    return false;
  }
}

// 默认实例
export const updateManager = new UpdateManager();

// ============================================================================
// 包管理器相关导出
// ============================================================================

/**
 * 获取当前安装的包管理器信息
 * 对应官方的 UHA() 函数
 */
export function getInstallationInfo(): {
  packageManager: PackageManagerType;
  installationType: InstallationType;
  updateCommand: string;
  canAutoUpdate: boolean;
} {
  const info = getPackageManagerInfo();
  return {
    packageManager: info.packageManager,
    installationType: info.installationType,
    updateCommand: info.updateCommand,
    canAutoUpdate: info.canAutoUpdate,
  };
}

/**
 * 检查是否为包管理器安装（homebrew/winget）
 * 如果是，则不支持自动更新
 */
export function isPackageManagerInstall(): boolean {
  const installationType = detectInstallationType();
  return installationType === 'package-manager';
}

/**
 * 获取适合当前安装方式的更新命令
 * @deprecated 使用 getPackageManagerInfo().updateCommand 替代
 */
export function getUpdateCommandForInstallation(): string {
  const info = getPackageManagerInfo();
  return info.updateCommand;
}

/**
 * 显示更新说明（用于 update 命令输出）
 */
export function showUpdateInstructions(): void {
  const pmInfo = getPackageManagerInfo();
  const instructions = getUpdateInstructions(pmInfo.packageManager);

  console.log('');
  console.log(`Claude is managed by ${instructions.managerName}.`);
  console.log(instructions.description);
  console.log('');
  console.log('To update, run:');
  console.log(`  ${instructions.command}`);
  console.log('');
}

// 重新导出包管理器类型
export type { PackageManagerType, InstallationType };
