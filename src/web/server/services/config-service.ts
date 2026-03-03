/**
 * WebUI 配置服务
 * 封装 ConfigManager 为 WebUI 提供友好的配置管理接口
 */

import { ConfigManager, UserConfig, ConfigSource, ConfigSourceInfo, ConfigKeySource, EnterprisePolicyConfig, configManager as globalConfigManager } from '../../../config/index.js';
import type { McpServerConfig } from '../../../types/index.js';
import { webAuth } from '../web-auth.js';

// ============ 类型定义 ============

/**
 * API 配置
 */
export interface ApiConfig {
  apiKey?: string;
  model: 'claude-opus-4-6' | 'claude-opus-4-5-20251101' | 'claude-sonnet-4-5-20250929' | 'claude-haiku-4-5-20251001' | 'opus' | 'sonnet' | 'haiku';
  maxTokens: number;
  temperature: number;
  apiProvider?: 'anthropic' | 'bedrock' | 'vertex';
  useBedrock: boolean;
  useVertex: boolean;
  oauthToken?: string;
  maxRetries: number;
  requestTimeout: number;
  // 自定义 API 配置
  apiBaseUrl?: string;
  customModelName?: string;
  authPriority?: 'apiKey' | 'oauth' | 'auto';
}

/**
 * 权限配置
 */
export interface PermissionsConfig {
  defaultMode?: 'default' | 'bypassPermissions' | 'dontAsk' | 'acceptEdits' | 'plan' | 'delegate';
  defaultLevel?: 'accept' | 'reject' | 'ask';
  autoApprove?: string[];
  allow?: string[];
  deny?: string[];
  ask?: string[];
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  paths?: {
    allow?: string[];
    deny?: string[];
  };
  commands?: {
    allow?: string[];
    deny?: string[];
  };
  network?: {
    allow?: string[];
    deny?: string[];
  };
  additionalDirectories?: string[];
  audit?: {
    enabled?: boolean;
    logFile?: string;
    maxSize?: number;
  };
}

/**
 * Hooks 配置
 */
export interface HooksConfig {
  preToolExecution?: string;
  postToolExecution?: string;
  onSessionStart?: string;
  onSessionEnd?: string;
}

/**
 * 日志配置
 */
export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  logPath?: string;
  maxSize?: number;
  maxFiles?: number;
}

/**
 * 代理配置
 */
export interface ProxyConfig {
  http?: string;
  https?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

/**
 * 安全配置
 */
export interface SecurityConfig {
  sensitiveFiles?: string[];
  dangerousCommands?: string[];
  allowSandboxEscape?: boolean;
}

/**
 * 终端配置
 */
export interface TerminalConfig {
  type?: 'auto' | 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'ghostty' | 'wezterm' | 'kitty' | 'alacritty' | 'warp';
  statusLine?: {
    type?: 'command' | 'text' | 'disabled';
    command?: string;
    text?: string;
  };
  keybindings?: Record<string, string>;
}

/**
 * UI 配置
 */
export interface UIConfig {
  theme: 'dark' | 'light' | 'auto';
  verbose: boolean;
  editMode: 'default' | 'vim' | 'emacs';
}

/**
 * Git 配置
 */
export interface GitConfig {
  includeCoAuthoredBy: boolean;
  attribution?: {
    commit?: string;
    pr?: string;
  };
}

/**
 * 工具过滤配置
 */
export interface ToolFilterConfig {
  allowedTools?: string[];
  disallowedTools?: string[];
}

/**
 * 完整配置
 */
export interface FullConfig extends UserConfig {
  // 继承 UserConfig 的所有字段
}

/**
 * 备份信息
 */
export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
  type: 'user' | 'project' | 'local';
}

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * 配置导出选项
 */
export interface ConfigExportOptions {
  maskSecrets?: boolean;
  includeDefaults?: boolean;
  format?: 'json' | 'yaml';
}

// ============ WebConfigService 类 ============

/**
 * WebUI 配置服务类
 * 封装 ConfigManager，提供 WebUI 友好的接口
 */
export class WebConfigService {
  private configManager: ConfigManager;

  constructor(configManager?: ConfigManager) {
    // 如果没有传入 ConfigManager，使用全局单例
    // 注意：必须使用全局单例，否则与 webAuth 等模块的 configManager 实例不同步
    if (configManager) {
      this.configManager = configManager;
    } else {
      this.configManager = globalConfigManager;
    }
  }

  // ============ 获取配置 ============

  /**
   * 获取所有配置
   */
  async getAllConfig(): Promise<FullConfig> {
    try {
      return this.configManager.getAll();
    } catch (error) {
      console.error('[WebConfigService] Failed to get all config:', error);
      throw new Error(`获取配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取 API 配置
   * apiKey 从 WebAuthProvider 获取，不走 configManager.getAll() 的环境变量合并
   */
  async getApiConfig(): Promise<ApiConfig> {
    try {
      const config = this.configManager.getAll();
      const creds = webAuth.getCredentials();

      return {
        apiKey: webAuth.getMaskedApiKey() || '',  // 只返回掩码版本，不泄露明文
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        apiProvider: config.apiProvider,
        useBedrock: config.useBedrock,
        useVertex: config.useVertex,
        oauthToken: creds.authToken,
        maxRetries: config.maxRetries,
        requestTimeout: config.requestTimeout,
        apiBaseUrl: creds.baseUrl,
        customModelName: webAuth.getCustomModelName(),
        authPriority: (config as any).authPriority || 'auto',
      };
    } catch (error) {
      console.error('[WebConfigService] Failed to get API config:', error);
      throw new Error(`获取 API 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取权限配置
   */
  async getPermissionsConfig(): Promise<PermissionsConfig> {
    try {
      const config = this.configManager.getAll();
      return config.permissions || {};
    } catch (error) {
      console.error('[WebConfigService] Failed to get permissions config:', error);
      throw new Error(`获取权限配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取 Hooks 配置
   * 注意: ConfigManager 中没有直接的 hooks 字段，这里返回空对象
   */
  async getHooksConfig(): Promise<HooksConfig> {
    try {
      // ConfigManager 不直接存储 hooks，返回空配置
      return {};
    } catch (error) {
      console.error('[WebConfigService] Failed to get hooks config:', error);
      throw new Error(`获取 Hooks 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取日志配置
   */
  async getLoggingConfig(): Promise<LoggingConfig> {
    try {
      const config = this.configManager.getAll();
      return config.logging || {
        level: 'info',
      };
    } catch (error) {
      console.error('[WebConfigService] Failed to get logging config:', error);
      throw new Error(`获取日志配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取代理配置
   */
  async getProxyConfig(): Promise<ProxyConfig> {
    try {
      const config = this.configManager.getAll();
      return config.proxy || {};
    } catch (error) {
      console.error('[WebConfigService] Failed to get proxy config:', error);
      throw new Error(`获取代理配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * 获取安全配置
   */
  async getSecurityConfig(): Promise<SecurityConfig> {
    try {
      const config = this.configManager.getAll();
      return config.security || { allowSandboxEscape: false };
    } catch (error) {
      console.error('[WebConfigService] Failed to get security config:', error);
      throw new Error(`获取安全配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取终端配置
   */
  async getTerminalConfig(): Promise<TerminalConfig> {
    try {
      const config = this.configManager.getAll();
      return config.terminal || {};
    } catch (error) {
      console.error('[WebConfigService] Failed to get terminal config:', error);
      throw new Error(`获取终端配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取 UI 配置
   */
  async getUIConfig(): Promise<UIConfig> {
    try {
      const config = this.configManager.getAll();
      return {
        theme: config.theme,
        verbose: config.verbose,
        editMode: config.editMode,
      };
    } catch (error) {
      console.error('[WebConfigService] Failed to get UI config:', error);
      throw new Error(`获取 UI 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取 Git 配置
   */
  async getGitConfig(): Promise<GitConfig> {
    try {
      const config = this.configManager.getAll();
      return {
        includeCoAuthoredBy: config.includeCoAuthoredBy,
        attribution: config.attribution,
      };
    } catch (error) {
      console.error('[WebConfigService] Failed to get Git config:', error);
      throw new Error(`获取 Git 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取工具过滤配置
   */
  async getToolFilterConfig(): Promise<ToolFilterConfig> {
    try {
      const config = this.configManager.getAll();
      return {
        allowedTools: config.allowedTools,
        disallowedTools: config.disallowedTools,
      };
    } catch (error) {
      console.error('[WebConfigService] Failed to get tool filter config:', error);
      throw new Error(`获取工具过滤配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ============ 更新配置 ============

  /**
   * 更新 API 配置
   */
  async updateApiConfig(config: Partial<ApiConfig>): Promise<boolean> {
    try {
      const updates = { ...config };

      // apiKey 特殊处理：空值或掩码值不覆盖已有 key
      if ('apiKey' in updates) {
        const val = updates.apiKey?.trim() || '';
        if (!val || val.includes('...') || val.includes('***')) {
          // 空值或掩码值 → 不修改已有 apiKey
          delete (updates as any).apiKey;
        } else {
          // 用户输入了新的真实 key → 通过 webAuth 写入
          webAuth.setApiKey(val);
          delete (updates as any).apiKey; // 已通过 webAuth 写入，不需要 configManager 再写
        }
      }

      // 保存其余配置
      if (Object.keys(updates).length > 0) {
        this.configManager.save(updates);
      }
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update API config:', error);
      return false;
    }
  }

  /**
   * 更新权限配置
   */
  async updatePermissionsConfig(config: Partial<PermissionsConfig>): Promise<boolean> {
    try {
      this.configManager.save({ permissions: config });
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update permissions config:', error);
      return false;
    }
  }

  /**
   * 更新 Hooks 配置
   */
  async updateHooksConfig(config: Partial<HooksConfig>): Promise<boolean> {
    try {
      // ConfigManager 不直接支持 hooks，需要扩展或通过其他方式处理
      console.warn('[WebConfigService] Hooks config update not supported yet');
      return false;
    } catch (error) {
      console.error('[WebConfigService] Failed to update hooks config:', error);
      return false;
    }
  }

  /**
   * 更新日志配置
   */
  async updateLoggingConfig(config: Partial<LoggingConfig>): Promise<boolean> {
    try {
      this.configManager.save({ logging: config });
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update logging config:', error);
      return false;
    }
  }

  /**
   * 更新代理配置
   */
  async updateProxyConfig(config: Partial<ProxyConfig>): Promise<boolean> {
    try {
      this.configManager.save({ proxy: config });
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update proxy config:', error);
      return false;
    }
  }

  /**
   * 更新安全配置
   */
  async updateSecurityConfig(config: Partial<SecurityConfig>): Promise<boolean> {
    try {
      this.configManager.save({ security: config });
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update security config:', error);
      return false;
    }
  }

  /**
   * 更新终端配置
   */
  async updateTerminalConfig(config: Partial<TerminalConfig>): Promise<boolean> {
    try {
      this.configManager.save({ terminal: config });
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update terminal config:', error);
      return false;
    }
  }

  /**
   * 更新 UI 配置
   */
  async updateUIConfig(config: Partial<UIConfig>): Promise<boolean> {
    try {
      this.configManager.save(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update UI config:', error);
      return false;
    }
  }

  /**
   * 更新 Git 配置
   */
  async updateGitConfig(config: Partial<GitConfig>): Promise<boolean> {
    try {
      this.configManager.save(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update Git config:', error);
      return false;
    }
  }

  /**
   * 更新工具过滤配置
   */
  async updateToolFilterConfig(config: Partial<ToolFilterConfig>): Promise<boolean> {
    try {
      this.configManager.save(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to update tool filter config:', error);
      return false;
    }
  }

  // ============ 配置管理 ============

  /**
   * 导出配置为 JSON
   */
  async exportConfig(options: ConfigExportOptions = {}): Promise<string> {
    try {
      const maskSecrets = options.maskSecrets ?? true;
      return this.configManager.export(maskSecrets);
    } catch (error) {
      console.error('[WebConfigService] Failed to export config:', error);
      throw new Error(`导出配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 导入配置
   */
  async importConfig(jsonStr: string): Promise<boolean> {
    try {
      return this.configManager.import(jsonStr);
    } catch (error) {
      console.error('[WebConfigService] Failed to import config:', error);
      return false;
    }
  }

  /**
   * 验证配置
   */
  async validateConfig(config?: any): Promise<ConfigValidationResult> {
    try {
      if (config) {
        // 验证传入的配置
        this.configManager.import(JSON.stringify(config));
      }

      const result = this.configManager.validate();

      if (result.valid) {
        return { valid: true };
      } else {
        const errors = result.errors?.errors.map(err => `${err.path.join('.')}: ${err.message}`) || [];
        return { valid: false, errors };
      }
    } catch (error) {
      console.error('[WebConfigService] Failed to validate config:', error);
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * 重置配置为默认值
   */
  async resetConfig(): Promise<boolean> {
    try {
      this.configManager.reset();
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to reset config:', error);
      return false;
    }
  }

  // ============ 配置来源和历史 ============

  /**
   * 获取配置项的来源
   */
  async getConfigSource(key: string): Promise<ConfigSource | undefined> {
    try {
      return this.configManager.getConfigSource(key as keyof UserConfig);
    } catch (error) {
      console.error('[WebConfigService] Failed to get config source:', error);
      return undefined;
    }
  }

  /**
   * 获取所有配置来源
   */
  async getAllConfigSources(): Promise<Record<string, ConfigSource>> {
    try {
      const sources = this.configManager.getAllConfigSources();
      const result: Record<string, ConfigSource> = {};
      sources.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    } catch (error) {
      console.error('[WebConfigService] Failed to get all config sources:', error);
      return {};
    }
  }

  /**
   * 获取配置来源信息
   */
  async getConfigSourceInfo(): Promise<ConfigSourceInfo[]> {
    try {
      return this.configManager.getConfigSourceInfo();
    } catch (error) {
      console.error('[WebConfigService] Failed to get config source info:', error);
      return [];
    }
  }

  /**
   * 获取所有可能的配置来源
   */
  async getAllPossibleSources(): Promise<ConfigSourceInfo[]> {
    try {
      return this.configManager.getAllPossibleSources();
    } catch (error) {
      console.error('[WebConfigService] Failed to get all possible config sources:', error);
      return [];
    }
  }

  /**
   * 获取配置项的详细信息（包括来源）
   */
  async getAllConfigDetails(): Promise<ConfigKeySource[]> {
    try {
      return this.configManager.getAllConfigDetails();
    } catch (error) {
      console.error('[WebConfigService] Failed to get config details:', error);
      return [];
    }
  }

  /**
   * 获取配置项的覆盖历史
   */
  async getConfigHistory(key: string): Promise<ConfigKeySource[]> {
    try {
      return this.configManager.getConfigHistory(key);
    } catch (error) {
      console.error('[WebConfigService] Failed to get config history:', error);
      return [];
    }
  }

  // ============ 备份和恢复 ============

  /**
   * 列出所有备份
   */
  async listBackups(type: 'user' | 'project' | 'local' = 'user'): Promise<BackupInfo[]> {
    try {
      const filenames = this.configManager.listBackups(type);
      const configPaths = this.configManager.getConfigPaths();

      const backupDir = type === 'user' ? configPaths.userSettings :
                        type === 'project' ? configPaths.projectSettings :
                        configPaths.localSettings;

      const backupPath = backupDir.replace(/[^/\\]+$/, '.backups');

      return filenames.map(filename => {
        const fullPath = `${backupPath}/${filename}`;
        // 从文件名解析时间戳
        const match = filename.match(/\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        const timestamp = match ? new Date(match[1].replace(/-/g, ':').replace('T', ' ')) : new Date();

        return {
          filename,
          path: fullPath,
          timestamp,
          size: 0, // ConfigManager 不提供大小信息
          type,
        };
      });
    } catch (error) {
      console.error('[WebConfigService] Failed to list backups:', error);
      return [];
    }
  }

  /**
   * 从备份恢复配置
   */
  async restoreFromBackup(filename: string, type: 'user' | 'project' | 'local' = 'user'): Promise<boolean> {
    try {
      return this.configManager.restoreFromBackup(filename, type);
    } catch (error) {
      console.error('[WebConfigService] Failed to restore backup:', error);
      return false;
    }
  }

  // ============ MCP 服务器管理 ============

  /**
   * 获取所有 MCP 服务器配置
   */
  async getMcpServers(): Promise<Record<string, McpServerConfig>> {
    try {
      return this.configManager.getMcpServers();
    } catch (error) {
      console.error('[WebConfigService] Failed to get MCP server config:', error);
      return {};
    }
  }

  /**
   * 添加 MCP 服务器
   */
  async addMcpServer(name: string, config: McpServerConfig): Promise<boolean> {
    try {
      this.configManager.addMcpServer(name, config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to add MCP server:', error);
      return false;
    }
  }

  /**
   * 删除 MCP 服务器
   */
  async removeMcpServer(name: string): Promise<boolean> {
    try {
      return this.configManager.removeMcpServer(name);
    } catch (error) {
      console.error('[WebConfigService] Failed to remove MCP server:', error);
      return false;
    }
  }

  /**
   * 更新 MCP 服务器配置
   */
  async updateMcpServer(name: string, config: Partial<McpServerConfig>): Promise<boolean> {
    try {
      return this.configManager.updateMcpServer(name, config);
    } catch (error) {
      console.error('[WebConfigService] Failed to update MCP server:', error);
      return false;
    }
  }

  // ============ 企业策略 ============

  /**
   * 获取企业策略
   */
  async getEnterprisePolicy(): Promise<EnterprisePolicyConfig | undefined> {
    try {
      return this.configManager.getEnterprisePolicy();
    } catch (error) {
      console.error('[WebConfigService] Failed to get enterprise policy:', error);
      return undefined;
    }
  }

  /**
   * 检查配置项是否被企业策略强制
   */
  async isEnforcedByPolicy(key: string): Promise<boolean> {
    try {
      return this.configManager.isEnforcedByPolicy(key);
    } catch (error) {
      console.error('[WebConfigService] Failed to check enterprise policy:', error);
      return false;
    }
  }

  /**
   * 检查功能是否被企业策略禁用
   */
  async isFeatureDisabled(feature: string): Promise<boolean> {
    try {
      return this.configManager.isFeatureDisabled(feature);
    } catch (error) {
      console.error('[WebConfigService] Failed to check feature disabled status:', error);
      return false;
    }
  }

  // ============ 配置文件路径 ============

  /**
   * 获取配置文件路径
   */
  async getConfigPaths(): Promise<Record<string, string>> {
    try {
      return this.configManager.getConfigPaths();
    } catch (error) {
      console.error('[WebConfigService] Failed to get config paths:', error);
      return {};
    }
  }

  // ============ 配置热重载 ============

  /**
   * 重新加载配置
   */
  async reloadConfig(): Promise<boolean> {
    try {
      this.configManager.reload();
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to reload config:', error);
      return false;
    }
  }

  /**
   * 监听配置变化
   */
  watchConfig(callback: (config: UserConfig) => void): void {
    try {
      this.configManager.watch(callback);
    } catch (error) {
      console.error('[WebConfigService] Failed to watch config:', error);
    }
  }

  /**
   * 停止监听配置变化
   */
  unwatchConfig(): void {
    try {
      this.configManager.unwatch();
    } catch (error) {
      console.error('[WebConfigService] Failed to unwatch config:', error);
    }
  }

  // ============ 配置保存 ============

  /**
   * 保存到用户配置文件
   */
  async saveUserConfig(config: Partial<UserConfig>): Promise<boolean> {
    try {
      this.configManager.save(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to save user config:', error);
      return false;
    }
  }

  /**
   * 保存到项目配置文件
   */
  async saveProjectConfig(config: Partial<UserConfig>): Promise<boolean> {
    try {
      this.configManager.saveProject(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to save project config:', error);
      return false;
    }
  }

  /**
   * 保存到本地配置文件（机器特定）
   */
  async saveLocalConfig(config: Partial<UserConfig>): Promise<boolean> {
    try {
      this.configManager.saveLocal(config);
      return true;
    } catch (error) {
      console.error('[WebConfigService] Failed to save local config:', error);
      return false;
    }
  }
}

// ============ 单例导出 ============

/**
 * WebUI 配置服务单例实例
 *
 * 使用示例:
 * ```typescript
 * import { webConfigService } from './services/config-service.js';
 *
 * // 获取配置
 * const apiConfig = await webConfigService.getApiConfig();
 *
 * // 更新配置
 * await webConfigService.updateApiConfig({ model: 'opus' });
 *
 * // 导出配置
 * const json = await webConfigService.exportConfig({ maskSecrets: true });
 * ```
 */
export const webConfigService = new WebConfigService();
