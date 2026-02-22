/**
 * MCP 配置管理模块
 * 负责 MCP 服务器配置的加载、验证、管理和持久化
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { execSync } from 'child_process';

// ============ Zod Schema 定义 ============

/**
 * MCP 服务器配置 Schema (基础对象)
 */
const baseMcpServerConfigSchema = z.object({
  type: z.enum(['stdio', 'sse', 'http']).describe('服务器类型'),
  command: z.string().optional().describe('命令路径 (stdio)'),
  args: z.array(z.string()).optional().describe('命令参数'),
  env: z.record(z.string()).optional().describe('环境变量'),
  url: z.string().url().optional().describe('服务器 URL (sse/http)'),
  headers: z.record(z.string()).optional().describe('HTTP 请求头'),
  // v2.1.30: OAuth client credentials for servers that don't support Dynamic Client Registration
  oauth: z.object({
    clientId: z.string().describe('OAuth client ID'),
    callbackPort: z.number().optional().describe('Fixed port for OAuth callback redirect URI'),
  }).optional().describe('OAuth 配置'),
  clientSecret: z.string().optional().describe('OAuth client secret'),
});

/**
 * MCP 服务器配置 Schema (与 types/index.ts 保持一致)
 */
export const McpServerConfigSchema = baseMcpServerConfigSchema.refine(
  (data) => {
    // stdio 类型必须有 command
    if (data.type === 'stdio' && !data.command) {
      return false;
    }
    // http/sse 类型必须有 url
    if ((data.type === 'http' || data.type === 'sse') && !data.url) {
      return false;
    }
    return true;
  },
  {
    message: 'stdio 类型需要 command 字段, http/sse 类型需要 url 字段',
  }
);

/**
 * 扩展的 MCP 服务器配置 Schema (包含管理字段)
 */
export const ExtendedMcpServerConfigSchema = baseMcpServerConfigSchema
  .extend({
    enabled: z.boolean().optional().default(true).describe('是否启用'),
    timeout: z.number().int().positive().optional().default(30000).describe('超时时间(ms)'),
    retries: z.number().int().min(0).max(10).optional().default(3).describe('重试次数'),
  })
  .refine(
    (data) => {
      // stdio 类型必须有 command
      if (data.type === 'stdio' && !data.command) {
        return false;
      }
      // http/sse 类型必须有 url
      if ((data.type === 'http' || data.type === 'sse') && !data.url) {
        return false;
      }
      return true;
    },
    {
      message: 'stdio 类型需要 command 字段, http/sse 类型需要 url 字段',
    }
  );

/**
 * MCP 配置集合 Schema
 */
export const McpConfigSchema = z.record(McpServerConfigSchema);

/**
 * 扩展的 MCP 配置集合 Schema
 */
export const ExtendedMcpConfigSchema = z.record(ExtendedMcpServerConfigSchema);

// 类型定义
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ExtendedMcpServerConfig = z.infer<typeof ExtendedMcpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type ExtendedMcpConfig = z.infer<typeof ExtendedMcpConfigSchema>;

// ============ 验证结果类型 ============

export interface ValidationResult {
  valid: boolean;
  errors?: z.ZodError;
  warnings?: string[];
}

export interface ServerValidationResult extends ValidationResult {
  serverName: string;
  commandExists?: boolean;
  urlReachable?: boolean;
}

// ============ 配置变更回调 ============

export type ConfigChangeCallback = (config: McpConfig, changedServer?: string) => void;

// ============ MCP 配置管理器选项 ============

export interface McpConfigOptions {
  globalConfigPath?: string;
  projectConfigPath?: string;
  autoSave?: boolean;
  validateCommands?: boolean;
}

// ============ MCP 配置管理器 ============

export class McpConfigManager {
  private globalConfigPath: string;
  private projectConfigPath: string;
  private autoSave: boolean;
  private validateCommands: boolean;
  private globalConfig: ExtendedMcpConfig = {};
  private projectConfig: ExtendedMcpConfig = {};
  private mergedConfig: ExtendedMcpConfig = {};
  private changeCallbacks: ConfigChangeCallback[] = [];
  private watchers: fs.FSWatcher[] = [];

  constructor(options: McpConfigOptions = {}) {
    // 设置配置路径
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const globalDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

    this.globalConfigPath = options.globalConfigPath || path.join(globalDir, 'settings.json');
    this.projectConfigPath = options.projectConfigPath || path.join(process.cwd(), '.claude', 'settings.json');
    this.autoSave = options.autoSave ?? true;
    this.validateCommands = options.validateCommands ?? true;

    // 初始加载
    this.loadSync();
  }

  // ============ 配置加载 ============

  /**
   * 同步加载配置
   */
  private loadSync(): void {
    this.globalConfig = this.loadConfigFromFile(this.globalConfigPath);
    this.projectConfig = this.loadConfigFromFile(this.projectConfigPath);
    this.mergeConfigs();
  }

  /**
   * 异步加载配置
   */
  async load(): Promise<void> {
    this.globalConfig = await this.loadConfigFromFileAsync(this.globalConfigPath);
    this.projectConfig = await this.loadConfigFromFileAsync(this.projectConfigPath);
    this.mergeConfigs();
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    await this.load();
    this.notifyChange();
  }

  /**
   * 从文件加载配置 (同步)
   */
  private loadConfigFromFile(filePath: string): ExtendedMcpConfig {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        return this.extractMcpServers(data);
      }
    } catch (error) {
      console.warn(`加载 MCP 配置失败: ${filePath}`, error);
    }
    return {};
  }

  /**
   * 从文件加载配置 (异步)
   */
  private async loadConfigFromFileAsync(filePath: string): Promise<ExtendedMcpConfig> {
    try {
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        return this.extractMcpServers(data);
      }
    } catch (error) {
      console.warn(`加载 MCP 配置失败: ${filePath}`, error);
    }
    return {};
  }

  /**
   * 从完整配置中提取 MCP 服务器配置
   */
  private extractMcpServers(data: any): ExtendedMcpConfig {
    if (data && typeof data === 'object' && data.mcpServers) {
      try {
        return ExtendedMcpConfigSchema.parse(data.mcpServers);
      } catch (error) {
        console.warn('MCP 配置验证失败', error);
        return data.mcpServers || {};
      }
    }
    return {};
  }

  /**
   * 合并配置 (项目配置覆盖全局配置)
   */
  private mergeConfigs(): void {
    this.mergedConfig = mergeConfigs(this.globalConfig, this.projectConfig);
  }

  // ============ 服务器管理 ============

  /**
   * 获取所有服务器配置
   */
  getServers(): Record<string, ExtendedMcpServerConfig> {
    return { ...this.mergedConfig };
  }

  /**
   * 获取单个服务器配置
   */
  getServer(name: string): ExtendedMcpServerConfig | null {
    return this.mergedConfig[name] || null;
  }

  /**
   * 添加服务器
   */
  async addServer(name: string, config: McpServerConfig | ExtendedMcpServerConfig): Promise<void> {
    // 验证配置
    const validation = this.validateServerConfig(config);
    if (!validation.valid) {
      throw new Error(`无效的服务器配置: ${validation.errors?.message}`);
    }

    // 添加到项目配置
    this.projectConfig[name] = config;
    this.mergeConfigs();

    if (this.autoSave) {
      await this.save('project');
    }

    this.notifyChange(name);
  }

  /**
   * 更新服务器配置
   */
  async updateServer(name: string, config: Partial<ExtendedMcpServerConfig>): Promise<void> {
    const existing = this.getServer(name);
    if (!existing) {
      throw new Error(`服务器不存在: ${name}`);
    }

    const updated = { ...existing, ...config };
    const validation = this.validateServerConfig(updated);
    if (!validation.valid) {
      throw new Error(`无效的服务器配置: ${validation.errors?.message}`);
    }

    // 更新到项目配置
    this.projectConfig[name] = updated;
    this.mergeConfigs();

    if (this.autoSave) {
      await this.save('project');
    }

    this.notifyChange(name);
  }

  /**
   * 删除服务器
   */
  async removeServer(name: string): Promise<boolean> {
    if (!this.mergedConfig[name]) {
      return false;
    }

    // 从全局和项目配置中删除
    delete this.globalConfig[name];
    delete this.projectConfig[name];
    this.mergeConfigs();

    if (this.autoSave) {
      await this.save('global');
      await this.save('project');
    }

    this.notifyChange(name);
    return true;
  }

  /**
   * 启用服务器
   */
  async enableServer(name: string): Promise<void> {
    await this.updateServer(name, { enabled: true });
  }

  /**
   * 禁用服务器
   */
  async disableServer(name: string): Promise<void> {
    await this.updateServer(name, { enabled: false });
  }

  /**
   * 获取已启用的服务器
   */
  getEnabledServers(): Record<string, ExtendedMcpServerConfig> {
    const result: Record<string, ExtendedMcpServerConfig> = {};
    for (const [name, config] of Object.entries(this.mergedConfig)) {
      if (config.enabled !== false) {
        result[name] = config;
      }
    }
    return result;
  }

  // ============ 验证 ============

  /**
   * 验证服务器配置
   */
  validate(config: McpServerConfig): ValidationResult {
    return this.validateServerConfig(config);
  }

  /**
   * 验证所有服务器配置
   */
  validateAll(): ServerValidationResult[] {
    const results: ServerValidationResult[] = [];

    for (const [name, config] of Object.entries(this.mergedConfig)) {
      const result = this.validateServerConfigDetailed(name, config);
      results.push(result);
    }

    return results;
  }

  /**
   * 验证服务器配置 (基础)
   */
  private validateServerConfig(config: any): ValidationResult {
    try {
      McpServerConfigSchema.parse(config);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, errors: error };
      }
      return { valid: false };
    }
  }

  /**
   * 验证服务器配置 (详细)
   */
  private validateServerConfigDetailed(
    serverName: string,
    config: ExtendedMcpServerConfig
  ): ServerValidationResult {
    const result: ServerValidationResult = {
      serverName,
      valid: true,
      warnings: [],
    };

    // Schema 验证
    const schemaValidation = this.validateServerConfig(config);
    if (!schemaValidation.valid) {
      return {
        ...result,
        valid: false,
        errors: schemaValidation.errors,
      };
    }

    // 命令存在性检查 (仅 stdio 类型)
    if (this.validateCommands && config.type === 'stdio' && config.command) {
      result.commandExists = this.checkCommandExists(config.command);
      if (!result.commandExists) {
        result.warnings?.push(`命令不存在或不可执行: ${config.command}`);
      }
    }

    // 环境变量验证
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (!value) {
          result.warnings?.push(`环境变量 ${key} 为空`);
        }
      }
    }

    return result;
  }

  /**
   * 检查命令是否存在
   */
  private checkCommandExists(command: string): boolean {
    try {
      if (process.platform === 'win32') {
        execSync(`where "${command}"`, { stdio: 'ignore', windowsHide: true });
      } else {
        execSync(`command -v "${command}"`, { stdio: 'ignore' });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ============ 持久化 ============

  /**
   * 保存配置
   */
  async save(scope: 'global' | 'project' = 'project'): Promise<void> {
    if (scope === 'global') {
      await this.saveToFile(this.globalConfigPath, this.globalConfig);
    } else {
      await this.saveToFile(this.projectConfigPath, this.projectConfig);
    }
  }

  /**
   * 保存到文件
   */
  private async saveToFile(filePath: string, mcpConfig: ExtendedMcpConfig): Promise<void> {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // 读取现有配置
      let existingData: any = {};
      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        existingData = JSON.parse(content);
      }

      // 更新 mcpServers 字段
      existingData.mcpServers = mcpConfig;

      // 写入文件
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(existingData, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new Error(`保存配置失败: ${filePath} - ${error}`);
    }
  }

  /**
   * 备份配置
   */
  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.projectConfigPath}.backup.${timestamp}`;

    try {
      if (fs.existsSync(this.projectConfigPath)) {
        await fs.promises.copyFile(this.projectConfigPath, backupPath);
      }
      return backupPath;
    } catch (error) {
      throw new Error(`备份配置失败: ${error}`);
    }
  }

  /**
   * 恢复配置
   */
  async restore(backupPath: string): Promise<void> {
    try {
      if (!fs.existsSync(backupPath)) {
        throw new Error(`备份文件不存在: ${backupPath}`);
      }

      await fs.promises.copyFile(backupPath, this.projectConfigPath);
      await this.reload();
    } catch (error) {
      throw new Error(`恢复配置失败: ${error}`);
    }
  }

  // ============ 事件 ============

  /**
   * 监听配置变化
   */
  onChange(callback: ConfigChangeCallback): () => void {
    this.changeCallbacks.push(callback);

    // 返回取消订阅函数
    return () => {
      const index = this.changeCallbacks.indexOf(callback);
      if (index > -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 通知配置变化
   */
  private notifyChange(changedServer?: string): void {
    for (const callback of this.changeCallbacks) {
      callback(this.mergedConfig, changedServer);
    }
  }

  /**
   * 监听文件变化
   */
  watch(): void {
    // 监听全局配置
    if (fs.existsSync(this.globalConfigPath)) {
      const globalWatcher = fs.watch(this.globalConfigPath, async () => {
        await this.reload();
      });
      this.watchers.push(globalWatcher);
    }

    // 监听项目配置
    if (fs.existsSync(this.projectConfigPath)) {
      const projectWatcher = fs.watch(this.projectConfigPath, async () => {
        await this.reload();
      });
      this.watchers.push(projectWatcher);
    }
  }

  /**
   * 停止监听
   */
  unwatch(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  // ============ 导出/导入 ============

  /**
   * 导出配置
   */
  export(maskSecrets = true): string {
    const config = { ...this.mergedConfig };

    if (maskSecrets) {
      for (const [name, server] of Object.entries(config)) {
        if (server.env) {
          const maskedEnv: Record<string, string> = {};
          for (const [key, value] of Object.entries(server.env)) {
            if (typeof value === 'string') {
              if (this.isSensitiveKey(key)) {
                maskedEnv[key] = this.maskSecret(value);
              } else {
                maskedEnv[key] = value;
              }
            }
          }
          config[name] = { ...server, env: maskedEnv };
        }

        if (server.headers) {
          const maskedHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(server.headers)) {
            if (typeof value === 'string') {
              if (this.isSensitiveKey(key)) {
                maskedHeaders[key] = this.maskSecret(value);
              } else {
                maskedHeaders[key] = value;
              }
            }
          }
          config[name] = { ...server, headers: maskedHeaders };
        }
      }
    }

    return JSON.stringify(config, null, 2);
  }

  /**
   * 导入配置
   */
  async import(configJson: string, scope: 'global' | 'project' = 'project'): Promise<void> {
    try {
      const config = JSON.parse(configJson);
      const validated = ExtendedMcpConfigSchema.parse(config);

      if (scope === 'global') {
        this.globalConfig = validated;
      } else {
        this.projectConfig = validated;
      }

      this.mergeConfigs();

      if (this.autoSave) {
        await this.save(scope);
      }

      this.notifyChange();
    } catch (error) {
      throw new Error(`导入配置失败: ${error}`);
    }
  }

  /**
   * 判断是否为敏感键名
   */
  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return (
      lowerKey.includes('key') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('auth')
    );
  }

  /**
   * 掩码敏感信息
   */
  private maskSecret(value: string): string {
    if (value.length <= 8) {
      return '***';
    }
    return value.slice(0, 4) + '***' + value.slice(-4);
  }

  // ============ 工具方法 ============

  /**
   * 获取配置统计信息
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    byType: Record<string, number>;
  } {
    const stats = {
      total: 0,
      enabled: 0,
      disabled: 0,
      byType: {} as Record<string, number>,
    };

    for (const config of Object.values(this.mergedConfig)) {
      stats.total++;

      if (config.enabled !== false) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      stats.byType[config.type] = (stats.byType[config.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * 清理所有配置
   */
  async clear(scope: 'global' | 'project' | 'both' = 'project'): Promise<void> {
    if (scope === 'global' || scope === 'both') {
      this.globalConfig = {};
    }
    if (scope === 'project' || scope === 'both') {
      this.projectConfig = {};
    }

    this.mergeConfigs();

    if (this.autoSave) {
      if (scope === 'global' || scope === 'both') {
        await this.save('global');
      }
      if (scope === 'project' || scope === 'both') {
        await this.save('project');
      }
    }

    this.notifyChange();
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.unwatch();
    this.changeCallbacks = [];
  }
}

// ============ 辅助函数 ============

/**
 * 合并两个 MCP 配置 (右侧覆盖左侧)
 */
export function mergeConfigs(global: ExtendedMcpConfig, project: ExtendedMcpConfig): ExtendedMcpConfig {
  const merged = { ...global };

  for (const [name, config] of Object.entries(project)) {
    if (merged[name]) {
      // 合并配置
      merged[name] = {
        ...merged[name],
        ...config,
        // 合并 env 和 headers
        env: {
          ...merged[name].env,
          ...config.env,
        },
        headers: {
          ...merged[name].headers,
          ...config.headers,
        },
      };
    } else {
      merged[name] = config;
    }
  }

  return merged;
}

/**
 * 验证服务器配置 (类型守卫)
 */
export function validateServerConfig(config: unknown): config is McpServerConfig {
  try {
    McpServerConfigSchema.parse(config);
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建默认 stdio 服务器配置
 */
export function createStdioServerConfig(
  command: string,
  args: string[] = [],
  env: Record<string, string> = {}
): ExtendedMcpServerConfig {
  return {
    type: 'stdio',
    command,
    args,
    env,
    enabled: true,
    timeout: 30000,
    retries: 3,
  };
}

/**
 * 创建默认 HTTP 服务器配置
 */
export function createHttpServerConfig(
  url: string,
  headers: Record<string, string> = {}
): ExtendedMcpServerConfig {
  return {
    type: 'http',
    url,
    headers,
    enabled: true,
    timeout: 30000,
    retries: 3,
  };
}

/**
 * 创建默认 SSE 服务器配置
 */
export function createSseServerConfig(
  url: string,
  headers: Record<string, string> = {}
): ExtendedMcpServerConfig {
  return {
    type: 'sse',
    url,
    headers,
    enabled: true,
    timeout: 30000,
    retries: 3,
  };
}

// ============ 导出 ============

export default McpConfigManager;
