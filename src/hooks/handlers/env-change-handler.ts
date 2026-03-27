/**
 * Environment Change Hook Handlers
 * CwdChanged - 当前工作目录改变时触发
 * FileChanged - 文件变更时触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * CwdChanged Handler 配置
 */
export interface CwdChangedHandlerConfig extends HandlerConfig {
  /** 是否记录目录变化 */
  logChange?: boolean;
  /** 是否加载 direnv */
  loadDirenv?: boolean;
}

/**
 * CwdChanged Hook Handler
 * 处理当前工作目录改变事件（用于目录相关的环境设置）
 */
export class CwdChangedHandler extends BaseHookHandler {
  constructor(config: CwdChangedHandlerConfig = {}) {
    super({
      name: 'CwdChangedHandler',
      timeout: 10000, // 10 seconds
      silent: true,
      ...config,
    });
  }

  async execute(input: HookInput): Promise<HookResult> {
    // Cast config to access extended properties
    const cfg = this.config as unknown as CwdChangedHandlerConfig;

    // 验证必要字段
    if (!input.newCwd) {
      return {
        success: false,
        error: 'CwdChanged requires newCwd',
      };
    }

    if (cfg.logChange !== false) {
      // 记录目录变化
    }

    // 尝试加载 direnv（如果启用）
    if (cfg.loadDirenv) {
      try {
        // 这里可以调用 direnv 加载环境
        // 示例：exec('direnv allow .');
      } catch (err) {
        console.warn('Failed to load direnv:', err);
      }
    }

    return {
      success: true,
      output: JSON.stringify({
        action: 'cwd_changed',
        previous_cwd: input.previousCwd || 'unknown',
        new_cwd: input.newCwd,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

/**
 * FileChanged Handler 配置
 */
export interface FileChangedHandlerConfig extends HandlerConfig {
  /** 是否记录文件变化 */
  logChange?: boolean;
  /** 是否对配置文件进行 hot reload */
  hotReloadConfig?: boolean;
  /** 监视的文件模式 */
  patterns?: string[];
}

/**
 * FileChanged Hook Handler
 * 处理文件变更事件（用于配置热重载等）
 */
export class FileChangedHandler extends BaseHookHandler {
  constructor(config: FileChangedHandlerConfig = {}) {
    super({
      name: 'FileChangedHandler',
      timeout: 10000, // 10 seconds
      silent: true,
      ...config,
    });
  }

  async execute(input: HookInput): Promise<HookResult> {
    // Cast config to access extended properties
    const cfg = this.config as unknown as FileChangedHandlerConfig;

    // 验证必要字段
    if (!input.filePath) {
      return {
        success: false,
        error: 'FileChanged requires filePath',
      };
    }

    // 检查是否应该监视此文件
    if (cfg.patterns && !this.matchesPattern(input.filePath)) {
      return {
        success: true,
        output: 'File does not match monitored patterns',
      };
    }

    if (cfg.logChange !== false) {
      // 记录文件变化
    }

    // 对配置文件进行 hot reload
    if (cfg.hotReloadConfig && this.isConfigFile(input.filePath)) {
      try {
        // 这里可以实现配置文件的热重载逻辑
      } catch (err) {
        console.warn('Failed to hot reload config:', err);
      }
    }

    return {
      success: true,
      output: JSON.stringify({
        action: 'file_changed',
        file_path: input.filePath,
        change_type: input.changeType || 'modified',
        file_size: input.fileSize || 0,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * 检查文件路径是否匹配监视模式
   */
  private matchesPattern(filePath: string): boolean {
    const cfg = this.config as unknown as FileChangedHandlerConfig;

    if (!cfg.patterns || cfg.patterns.length === 0) {
      return true;
    }

    return cfg.patterns.some((pattern) =>
      new RegExp(this.globToRegex(pattern)).test(filePath)
    );
  }

  /**
   * 检查是否是配置文件
   */
  private isConfigFile(filePath: string): boolean {
    const configPatterns = [
      /\.env/,
      /config\./,
      /settings\./,
      /\.axon\/settings\.json/,
      /\.axon\/hooks\//,
    ];

    return configPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * 简单的 glob 模式转正则
   */
  private globToRegex(pattern: string): string {
    return pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
  }
}
