/**
 * 配置展示和管理命令
 *
 * 提供 /config 命令用于展示和管理配置
 */

import type { ConfigManager, UserConfig, ConfigSource } from './index.js';
import { AxonMdParser } from './axon-md-parser.js';
import * as fs from 'fs';

export interface ConfigDisplayOptions {
  showSecrets?: boolean;
  showSources?: boolean;
  showBackups?: boolean;
  format?: 'json' | 'yaml' | 'table';
}

export class ConfigCommand {
  constructor(private configManager: ConfigManager) {}

  /**
   * 展示当前配置
   */
  display(options: ConfigDisplayOptions = {}): string {
    const {
      showSecrets = false,
      showSources = true,
      showBackups = false,
      format = 'json',
    } = options;

    let output = '';

    // 标题
    output += '='.repeat(60) + '\n';
    output += 'Claude Code Configuration\n';
    output += '='.repeat(60) + '\n\n';

    // 配置内容
    const config = showSecrets
      ? JSON.stringify(this.configManager.getAll(), null, 2)
      : this.configManager.export(true);

    output += '**Current Configuration:**\n';
    output += '```json\n';
    output += config;
    output += '\n```\n\n';

    // 配置来源
    if (showSources) {
      output += this.displaySources();
    }

    // 备份信息
    if (showBackups) {
      output += this.displayBackups();
    }

    // CLAUDE.md 信息
    output += this.displayClaudeMd();

    output += '\n' + '='.repeat(60) + '\n';

    return output;
  }

  /**
   * 展示配置来源
   */
  private displaySources(): string {
    let output = '**Configuration Sources:**\n\n';

    const sources = this.configManager.getConfigSourceInfo();

    output += '| Priority | Source | Path | Status |\n';
    output += '|----------|--------|------|--------|\n';

    for (const { source, path: filePath, priority } of sources) {
      const status = this.getSourceStatus(source, filePath);
      const displayPath = filePath || 'N/A';

      output += `| ${priority} | ${source} | ${displayPath} | ${status} |\n`;
    }

    output += '\n';

    // 显示每个配置项的来源
    output += '**Configuration Item Sources:**\n\n';

    const config = this.configManager.getAll();
    const configSources = this.configManager.getAllConfigSources();

    output += '| Config Key | Value | Source |\n';
    output += '|------------|-------|--------|\n';

    const importantKeys: Array<keyof UserConfig> = [
      'apiKey',
      'model',
      'maxTokens',
      'apiProvider',
      'theme',
      'enableTelemetry',
    ];

    for (const key of importantKeys) {
      const value = this.formatValue(config[key]);
      const source = configSources.get(String(key)) || 'default';

      output += `| ${key} | ${value} | ${source} |\n`;
    }

    output += '\n';

    return output;
  }

  /**
   * 获取配置源状态
   */
  private getSourceStatus(source: ConfigSource, filePath?: string): string {
    if (!filePath) {
      return source === 'envSettings' ? 'Active' : 'N/A';
    }

    return fs.existsSync(filePath) ? 'Active' : 'Not Found';
  }

  /**
   * 格式化配置值
   */
  private formatValue(value: any): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string' && value.length > 30) {
      return value.substring(0, 27) + '...';
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * 展示备份信息
   */
  private displayBackups(): string {
    let output = '**Available Backups:**\n\n';

    const userBackups = this.configManager.listBackups('user');
    const projectBackups = this.configManager.listBackups('project');
    const localBackups = this.configManager.listBackups('local');

    output += `User Config Backups: ${userBackups.length}\n`;
    if (userBackups.length > 0) {
      output += `  Latest: ${userBackups[0]}\n`;
    }

    output += `Project Config Backups: ${projectBackups.length}\n`;
    if (projectBackups.length > 0) {
      output += `  Latest: ${projectBackups[0]}\n`;
    }

    output += `Local Config Backups: ${localBackups.length}\n`;
    if (localBackups.length > 0) {
      output += `  Latest: ${localBackups[0]}\n`;
    }

    output += '\n';

    return output;
  }

  /**
   * 展示 CLAUDE.md 信息
   */
  private displayClaudeMd(): string {
    const parser = new AxonMdParser();
    const info = parser.parse();

    let output = '**CLAUDE.md Status:**\n\n';

    if (info.exists) {
      const stats = parser.getStats();
      const validation = parser.validate();

      output += `Path: ${info.path}\n`;
      output += `Status: Found ✓\n`;
      output += `Last Modified: ${info.lastModified?.toISOString() || 'Unknown'}\n`;

      if (stats) {
        output += `Size: ${stats.size} bytes (${stats.lines} lines, ${stats.chars} chars)\n`;
      }

      if (validation.warnings.length > 0) {
        output += '\nWarnings:\n';
        validation.warnings.forEach(w => {
          output += `  - ${w}\n`;
        });
      }
    } else {
      output += `Path: ${info.path}\n`;
      output += `Status: Not Found ✗\n`;
      output += '\nTip: Create a CLAUDE.md file to provide project-specific guidance to Claude.\n';
    }

    output += '\n';

    return output;
  }

  /**
   * 获取特定配置项
   */
  get<K extends keyof UserConfig>(key: K): string {
    const { value, source } = this.configManager.getWithSource(key);

    return `${key} = ${JSON.stringify(value, null, 2)} (from ${source})`;
  }

  /**
   * 设置配置项
   */
  set<K extends keyof UserConfig>(
    key: K,
    value: UserConfig[K],
    target: 'user' | 'project' | 'local' = 'user'
  ): string {
    const config: Partial<UserConfig> = {};
    config[key] = value;

    if (target === 'local') {
      this.configManager.saveLocal(config);
    } else if (target === 'project') {
      this.configManager.saveProject(config);
    } else {
      this.configManager.save(config);
    }

    return `Set ${key} = ${JSON.stringify(value)} in ${target} config`;
  }

  /**
   * 验证配置
   */
  validate(): string {
    const result = this.configManager.validate();

    if (result.valid) {
      return 'Configuration is valid ✓';
    }

    let output = 'Configuration validation failed ✗\n\n';

    if (result.errors) {
      output += 'Errors:\n';
      result.errors.errors.forEach(error => {
        output += `  - ${error.path.join('.')}: ${error.message}\n`;
      });
    }

    return output;
  }

  /**
   * 列出备份
   */
  listBackups(configType: 'user' | 'project' | 'local' = 'user'): string {
    const backups = this.configManager.listBackups(configType);

    if (backups.length === 0) {
      return `No backups found for ${configType} config`;
    }

    let output = `Backups for ${configType} config:\n\n`;

    backups.forEach((backup, index) => {
      output += `${index + 1}. ${backup}\n`;
    });

    return output;
  }

  /**
   * 恢复备份
   */
  restore(
    backupFilename: string,
    configType: 'user' | 'project' | 'local' = 'user'
  ): string {
    const success = this.configManager.restoreFromBackup(backupFilename, configType);

    if (success) {
      return `Successfully restored ${configType} config from ${backupFilename}`;
    } else {
      return `Failed to restore ${configType} config from ${backupFilename}`;
    }
  }

  /**
   * 重置配置
   */
  reset(): string {
    this.configManager.reset();
    return 'Configuration reset to defaults';
  }

  /**
   * 导出配置
   */
  exportConfig(maskSecrets = true): string {
    return this.configManager.export(maskSecrets);
  }

  /**
   * 导入配置
   */
  importConfig(configJson: string): string {
    const success = this.configManager.import(configJson);

    if (success) {
      return 'Configuration imported successfully';
    } else {
      return 'Failed to import configuration';
    }
  }

  /**
   * 获取帮助信息
   */
  help(): string {
    return `
Claude Code Configuration Commands

Usage:
  /config                   - Display current configuration
  /config get <key>         - Get specific configuration value
  /config set <key> <value> - Set configuration value
  /config validate          - Validate configuration
  /config backups [type]    - List available backups (user/project/local)
  /config restore <file>    - Restore configuration from backup
  /config reset             - Reset to default configuration
  /config export            - Export configuration (secrets masked)
  /config import <json>     - Import configuration from JSON
  /config help              - Show this help message

Examples:
  /config get model
  /config set theme dark
  /config backups user
  /config restore settings.2024-01-01T12-00-00.json

Configuration Sources (priority order):
  1. default              - Built-in defaults
  2. policySettings       - Organization policies (~/.claude/policy.json)
  3. userSettings         - User global config (~/.claude/settings.json)
  4. projectSettings      - Project config (./.claude/settings.json)
  5. localSettings        - Machine-specific (./.claude/local.json)
  6. envSettings          - Environment variables (CLAUDE_CODE_*)
  7. flagSettings         - Command-line flags (--settings)
`;
  }
}

/**
 * 创建配置命令实例
 */
export function createConfigCommand(configManager: ConfigManager): ConfigCommand {
  return new ConfigCommand(configManager);
}
